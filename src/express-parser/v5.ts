import type { RouteMetaData, RouteMetaDataMulti, Parameter, ParseOptions } from '../types';
import { ORIGINAL_PATH } from './instrument';

/**
 * Parser for Express 5 / `router@^2.x` apps.
 *
 * Strategy: walk the router tree, joining captured mount paths
 * (recorded by the `instrument` patch) with each `route.path`. Path-parameter
 * extraction uses path-to-regexp v8's `pathToRegexp(path).keys`, which gives
 * us `{ type: 'param' | 'wildcard', name: string }` directly — no regex
 * source parsing.
 */
export const parseV5 = (
  router: V5RouterStack,
  options: ParseOptions,
): RouteMetaData[] | RouteMetaDataMulti[] => {
  const out: (RouteMetaData | RouteMetaDataMulti)[] = [];
  walkStack(router.stack, '', out, options.multipleMetadata === true);
  return out;
};

const walkStack = (
  stack: V5Layer[],
  parent: string,
  out: (RouteMetaData | RouteMetaDataMulti)[],
  multipleMetadata: boolean,
): void => {
  for (const layer of stack) {
    if (layer.route) {
      emitRoute(layer, parent, out, multipleMetadata);
    } else if (layer.handle && Array.isArray((layer.handle as V5RouterStack).stack)) {
      const mountPath = layer[ORIGINAL_PATH];
      if (mountPath === undefined && layer.name === 'router') {
        // The patch wasn't installed before this router was constructed.
        // Surface a clear error so users can fix the import order.
        throw new Error(
          'express-route-parser: Express 5 sub-router was constructed before instrumentation. ' +
            'Import `express-route-parser` (or call `instrumentExpress5Router()`) before creating any routers.',
        );
      }
      const newParent =
        mountPath !== undefined ? joinPath(parent, mountPathToString(mountPath)) : parent;
      walkStack((layer.handle as V5RouterStack).stack, newParent, out, multipleMetadata);
    }
    // else: bare middleware — skipped
  }
};

const emitRoute = (
  layer: V5Layer,
  parent: string,
  out: (RouteMetaData | RouteMetaDataMulti)[],
  multipleMetadata: boolean,
): void => {
  if (!layer.route) return; // narrow

  const routePathRaw = layer.route.path;
  const finalPath = joinPath(parent, routePathRaw);

  const pathParams = extractParameters(routePathRaw);

  // Group by HTTP method (issue #7 fix logic — same shape in v5)
  const methodGroups = new Map<string, V5RouteEntry[]>();
  for (const entry of layer.route.stack) {
    if (!entry.method) continue;
    const group = methodGroups.get(entry.method);
    if (group) group.push(entry);
    else methodGroups.set(entry.method, [entry]);
  }

  for (const [method, entries] of methodGroups) {
    const metaEntries = entries.filter((e) => e?.handle?.metadata !== undefined);

    if (multipleMetadata) {
      const metadata = metaEntries.map((e) => e.handle?.metadata);
      out.push({ path: finalPath, pathParams, method, metadata });
    } else {
      if (metaEntries.length > 1) {
        throw new Error(
          'Only one metadata middleware is allowed per route. ' +
            'Pass { multipleMetadata: true } to parseExpressApp() to allow multiple.',
        );
      }
      if (metaEntries.length === 0) {
        out.push({ path: finalPath, pathParams, method });
      } else {
        out.push({
          path: finalPath,
          pathParams,
          method,
          metadata: metaEntries[0].handle?.metadata,
        });
      }
    }
  }
};

/**
 * Extract path parameters from an Express 5 route path string using
 * path-to-regexp v8. Returns an empty array for paths with no parameters
 * or for non-string (regex / array) paths — those aren't parsed for params.
 */
const extractParameters = (path: string | RegExp | (string | RegExp)[]): Parameter[] => {
  if (typeof path !== 'string') return [];

  // Lazy-require so we don't load path-to-regexp on Express 4-only deployments.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
  const { pathToRegexp } = require('path-to-regexp');
  const p2r = pathToRegexp as (
    s: string,
  ) => { regexp: RegExp; keys: { type: 'param' | 'wildcard'; name: string }[] };

  let parsed: { keys: { type: 'param' | 'wildcard'; name: string }[] };
  try {
    parsed = p2r(path);
  } catch {
    // Path-to-regexp v8 throws on syntactically invalid paths. Fall back to
    // empty params; the user's paths are their problem.
    return [];
  }

  return parsed.keys.map((k) => ({
    name: k.name,
    in: 'path',
    // path-to-regexp v8 doesn't model "optional" as a flag on the key; an
    // optional segment in the path source produces a param with the same shape
    // but the segment is wrapped in `{...}`. Detecting that requires a second
    // pass on the raw source. For v1 of this design: report `required: true`
    // for non-wildcard params unless we can detect optional (see implementation note).
    required: k.type !== 'wildcard' && !isOptional(path, k.name),
    type: k.type,
  }));
};

/**
 * Heuristic: detect if a named segment appears inside `{...}` in the path
 * source. path-to-regexp v8 expresses optional segments via `{...}` wrappers
 * around the segment; the segment's `key.name` is preserved.
 *
 * Examples:
 *
 * - `/users/:id` — id NOT optional
 * - `/users/{:id}` — id optional
 * - `/users{/:id}` — id optional with leading slash
 * - `/files/*splat` — splat (separately classified as wildcard)
 * - `/files/{*splat}` — wildcard, also optional in zero-match sense
 */
const isOptional = (rawPath: string, name: string): boolean => {
  // Find a `{...}` group containing `:name` or `*name`.
  const re = new RegExp('\\{[^}]*[:*]' + escapeRegex(name) + '[^a-zA-Z0-9_]', 'g');
  const altRe = new RegExp('\\{[^}]*[:*]' + escapeRegex(name) + '\\}', 'g');
  return re.test(rawPath) || altRe.test(rawPath);
};

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const joinPath = (parent: string, child: string): string => {
  if (!parent) return child || '/';
  if (!child || child === '/') return parent;
  return (parent + child).replace(/\/{2,}/g, '/');
};

const mountPathToString = (p: string | RegExp | (string | RegExp)[]): string => {
  if (typeof p === 'string') return p;
  if (p instanceof RegExp) return p.toString();
  // Array form: match v4 parser's existing behavior — join with comma.
  return p.map((x) => (typeof x === 'string' ? x : x.toString())).join(',');
};

// ---- Local duck-typed shapes for v5 / router@2 layers ----

interface V5RouterStack {
  stack: V5Layer[];
}

type V5HandleFn = (...args: any[]) => unknown;

interface V5Layer {
  name: string;
  handle?: V5HandleFn | V5RouterStack;
  route?: {
    path: string;
    stack: V5RouteEntry[];
  };
  [ORIGINAL_PATH]?: string | RegExp | (string | RegExp)[];
}

interface V5RouteEntry {
  method?: string;
  handle?: {
    metadata?: unknown;
  };
}
