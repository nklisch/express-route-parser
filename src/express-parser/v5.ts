import type { RouteMetaData, RouteMetaDataMulti, Parameter, ParseOptions } from '../types';
import { ORIGINAL_PATH } from './instrument';

/**
 * Parser for Express 5 / `router@^2.x` apps.
 *
 * Strategy: walk the router tree, joining captured mount paths
 * (recorded by the `instrument` patch) with each `route.path`. Path-parameter
 * extraction uses path-to-regexp v8's `parse()`, which exposes the structural
 * AST (`Text | Parameter | Wildcard | Group`). We walk the AST per layer and
 * accumulate parameters across nested mounts so the leaf route reports its
 * full ancestor chain, matching v4 behavior.
 */
export const parseV5 = (router: V5RouterStack, options: ParseOptions): RouteMetaData[] | RouteMetaDataMulti[] => {
  const out: (RouteMetaData | RouteMetaDataMulti)[] = [];
  walkStack(router.stack, '', [], out, options.multipleMetadata === true);
  return out;
};

const walkStack = (
  stack: V5Layer[],
  parent: string,
  parentParams: Parameter[],
  out: (RouteMetaData | RouteMetaDataMulti)[],
  multipleMetadata: boolean,
): void => {
  for (const layer of stack) {
    if (layer.route) {
      emitRoute(layer, parent, parentParams, out, multipleMetadata);
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
      const newParent = mountPath !== undefined ? joinPath(parent, mountPathToString(mountPath)) : parent;
      // Only string mount paths can carry path-to-regexp params. Regex and
      // array mount forms have no named segments — skip them silently.
      const segmentParams = typeof mountPath === 'string' ? extractParameters(mountPath) : [];
      walkStack(
        (layer.handle as V5RouterStack).stack,
        newParent,
        [...parentParams, ...segmentParams],
        out,
        multipleMetadata,
      );
    }
    // else: bare middleware — skipped
  }
};

const emitRoute = (
  layer: V5Layer,
  parent: string,
  parentParams: Parameter[],
  out: (RouteMetaData | RouteMetaDataMulti)[],
  multipleMetadata: boolean,
): void => {
  if (!layer.route) return; // narrow

  const routePathRaw = layer.route.path;
  const finalPath = joinPath(parent, routePathRaw);

  const pathParams = [...parentParams, ...extractParameters(routePathRaw)];

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
 * path-to-regexp v8's structural `parse()`. Returns an empty array for paths
 * with no parameters or for non-string (regex / array) paths — those aren't
 * parsed for params.
 *
 * Optionality is structural: a `:name` or `*name` token is reported with
 * `required: false` iff it appears inside a `{...}` group in the path AST.
 * Wildcards are always reported `required: false` (they match zero or more
 * segments by definition).
 */
const extractParameters = (path: string | RegExp | (string | RegExp)[]): Parameter[] => {
  if (typeof path !== 'string') return [];

  // Lazy-require so we don't load path-to-regexp on Express 4-only deployments.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const { parse } = require('path-to-regexp') as typeof import('path-to-regexp');

  let data: import('path-to-regexp').TokenData;
  try {
    data = parse(path);
  } catch {
    // path-to-regexp v8 throws on syntactically invalid paths. Fall back to
    // empty params; the user's paths are their problem.
    return [];
  }

  const out: Parameter[] = [];
  walkTokens(data.tokens, false, out);
  return out;
};

const walkTokens = (tokens: import('path-to-regexp').Token[], inGroup: boolean, out: Parameter[]): void => {
  for (const t of tokens) {
    if (t.type === 'param' || t.type === 'wildcard') {
      out.push({
        name: t.name,
        in: 'path',
        required: !inGroup && t.type !== 'wildcard',
        type: t.type,
      });
    } else if (t.type === 'group') {
      walkTokens(t.tokens, true, out);
    }
    // 'text' tokens carry no params
  }
};

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
