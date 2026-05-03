# Design: Express 5 Support

## Overview

Adds Express 5 support to `express-route-parser` while keeping Express 4
working unchanged. Ships as **2.0.0** (peer-dep widening = breaking under
strict semver).

**The headline insight from PoC research** (`/tmp/erp-express5-research/`):
Express 5 stores `route.path` directly as a string — no regex tricks needed.
The complex `pathRegexParser` / `mapKeysToPath` machinery from the v4 parser
is unnecessary in v5. The only hard problem is mount-path recovery: Express 5
discards the original mount-path string at `Layer` construction; only an
opaque matcher closure survives. This design solves it via a **monkey-patch
on `Router.prototype.use` / `.route`** that records the path argument at
registration time. The patch is auto-installed when the package is imported.

## Decisions Locked from User Q&A

These were resolved before drafting; do not relitigate during implementation.

| Question | Decision |
| --- | --- |
| Where is the monkey-patch installed? | **Auto-install on import** — side effect when any symbol is imported from the package. |
| Express 4 or 5 only? | **Both** — peer dep `^4.x \|\| ^5.x`, runtime version detection. |
| How to surface Express 5's richer path syntax? | **Add optional `type?: 'param' \| 'wildcard'` field** on `Parameter`. Non-breaking. |
| Versioning? | **2.0.0** — peer-dep widening + new exports. |

## Verified Facts (2026-05, queried directly)

- Express 5 stable: `5.2.1`, requires Node `>=18` (no conflict with our `>=20`).
- Express 5 routing lives in `router@^2.2.0`, which depends on `path-to-regexp@^8`.
- `@types/express@5.0.6` published.
- **Express 5 shape differences vs v4** (verified by inspecting `node_modules/router/lib/layer.js` and runtime probe):

| Property | Express 4 | Express 5 / `router@2` |
|---|---|---|
| `app._router` | router object after first registration | `false` |
| `app.router` | deprecated; **throws on access** | canonical access; returns the router function |
| `layer.regexp` | always present, has `fast_slash`/`fast_star` | **`undefined`** |
| `layer.keys` | `[{name, optional, offset}]` | always `[]` |
| `layer.path` | n/a | always `undefined` at parse time (assigned during request matching) |
| `layer.matchers` | n/a | array of opaque match closures (no source-recovery API) |
| `layer.route.path` (leaf routes) | string | **string — same as v4** |
| `layer.route.stack` (per-method) | same shape | **same shape — issue #7 fix logic transfers verbatim** |
| Middleware `.metadata` field | discoverable | **discoverable — same** |

- **Express 5 actively rejects Express 4 path syntax** at registration time
  (e.g., `:name?` throws `PathError: Unexpected ?`). This is Express's
  breaking change; our parser doesn't need to handle the old syntax for v5
  apps because users physically can't register such paths.
- **New Express 5 path syntax** users *can* write:
  - `:param` — required path parameter (unchanged)
  - `*splat` — named wildcard (was `*` in v4)
  - `{:param}` — optional segment
  - `{/:param}` — optional segment with leading slash
  - `{...}` — optional groups
- **`pathToRegexp(path).keys` from path-to-regexp v8** returns `[{ type: 'param' | 'wildcard', name: string }]` — directly usable for our `Parameter[]` extraction.

## Out of Scope (Deferred)

- **Async/promise route handler error semantics** — Express 5's auto-await behavior changes runtime behavior, not parser output. Nothing for us to do.
- **`req.param()` deprecation** — irrelevant to parsing.
- **`app.del()` removal** — already not referenced by our code.
- **Rich param metadata beyond `type`** — splat repeat semantics, separator chars, custom patterns. The opt-in `richParams: true` mode floated in Q3 was rejected; staying with the simple `type?` extension.
- **TypeScript types validating that the input is specifically Express 4 or 5.** We accept either via duck-typed `Express` parameter (current `import { Express } from 'express'` resolves to whichever is installed).

## Implementation Units

### Unit 1: Extend `Parameter` with optional `type`

**File**: `src/types/index.ts`

```typescript
export interface Parameter {
  in: string;
  name: string;
  required: boolean;
  /**
   * The kind of path parameter, when known. Populated for routes parsed from
   * Express 5 (which exposes path-to-regexp v8's typed `keys` array). Absent
   * for Express 4 routes — the v4 regex-recovery path doesn't preserve this
   * distinction.
   *
   * - `'param'` — a normal `:name` segment (one path component)
   * - `'wildcard'` — a `*splat` segment (zero or more path components)
   */
  type?: 'param' | 'wildcard';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}
```

**Implementation Notes**:

- Strictly additive; the existing `Parameter` index signature already permits arbitrary extra keys, so adding `type?` is doubly non-breaking.
- Marked optional so v4 consumers see no shape change.
- Existing pinned type test (`types.test-d.ts:32`) uses `toMatchObjectType` and asserts the documented shape — this addition won't fail existing assertions, but a new assertion should pin the new field's allowed values.

**Acceptance Criteria**:

- [ ] `Parameter['type']` accepts `'param' | 'wildcard' | undefined`.
- [ ] Existing `types.test-d.ts` assertions continue to pass.
- [ ] New type-test pins `Parameter['type']` to the literal union.

---

### Unit 2: Auto-installed monkey-patch for `router@2.x`

**File**: `src/express-parser/instrument.ts` (new)

```typescript
/**
 * Express 5 / `router@^2.x` discards the original mount-path string at Layer
 * construction time. To recover it, we patch `Router.prototype.use` and
 * `.route` to record the path argument on the resulting Layer(s) before
 * returning to the user. The patch is idempotent and a no-op for consumers
 * who don't have the `router` package installed (Express 4 only).
 *
 * Side-effected by `src/index.ts` import so consumers don't need a setup
 * call. Patches `Router.prototype` once; subsequent imports are no-ops.
 */

declare const Symbol: SymbolConstructor;

const PATCHED_MARKER = Symbol.for('express-route-parser/patched');

export interface CapturedPath {
  /**
   * The original path argument passed to `router.use(path, ...)` or
   * `router.route(path)`. Stored on each newly-created Layer as a hidden
   * symbol property so the v5 walker can reconstruct full paths.
   */
  path: string | RegExp | Array<string | RegExp>;
}

/**
 * Hidden property attached to v5 Layer instances by the patch. The v5 parser
 * reads this to recover mount paths. The symbol form prevents collisions
 * with any Layer field upstream might add.
 */
export const ORIGINAL_PATH = Symbol.for('express-route-parser/originalPath');

/**
 * Idempotent. Returns true if patching took effect (or was already in place);
 * false if the `router` package isn't installed (Express 4 only deployment).
 *
 * Exported for tests and for the documented escape hatch
 * `EXPRESS_ROUTE_PARSER_NO_AUTO_INSTRUMENT=1`.
 */
export function instrumentExpress5Router(): boolean {
  let routerModule: { prototype: RouterPrototype };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    routerModule = require('router');
  } catch {
    // No `router` package — Express 4-only consumer. Nothing to do.
    return false;
  }

  const proto = routerModule.prototype as RouterPrototype & {
    [PATCHED_MARKER]?: true;
  };

  if (proto[PATCHED_MARKER]) {
    return true; // already patched; idempotent
  }

  const origUse = proto.use;
  const origRoute = proto.route;

  proto.use = function patchedUse(this: RouterStack, ...args: unknown[]): unknown {
    const stackBefore = this.stack.length;
    const ret = origUse.apply(this, args);
    const path = pathArg(args[0]);
    if (path !== undefined) {
      for (let i = stackBefore; i < this.stack.length; i++) {
        (this.stack[i] as RouterLayer)[ORIGINAL_PATH] = path;
      }
    }
    return ret;
  };

  proto.route = function patchedRoute(this: RouterStack, path: string): unknown {
    const ret = origRoute.call(this, path);
    const newLayer = this.stack[this.stack.length - 1] as RouterLayer | undefined;
    if (newLayer) newLayer[ORIGINAL_PATH] = path;
    return ret;
  };

  Object.defineProperty(proto, PATCHED_MARKER, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  return true;
}

function pathArg(first: unknown): string | RegExp | Array<string | RegExp> | undefined {
  if (typeof first === 'string') return first;
  if (first instanceof RegExp) return first;
  if (Array.isArray(first) && first.every((p) => typeof p === 'string' || p instanceof RegExp)) {
    return first as Array<string | RegExp>;
  }
  return undefined;
}

// Minimal duck-typed shapes for the parts of `router@2` we touch. Keeping
// them local avoids a runtime dependency on the package's types.
interface RouterPrototype {
  use(...args: unknown[]): unknown;
  route(path: string): unknown;
}
interface RouterStack {
  stack: RouterLayer[];
}
interface RouterLayer {
  [ORIGINAL_PATH]?: string | RegExp | Array<string | RegExp>;
}

// Side-effect: install on import unless explicitly disabled. The env-var
// escape hatch is for unusual setups (lazy-loaded modules, test isolation).
if (process.env.EXPRESS_ROUTE_PARSER_NO_AUTO_INSTRUMENT !== '1') {
  instrumentExpress5Router();
}
```

**Implementation Notes**:

- **Why a Symbol marker** for `PATCHED_MARKER` and `ORIGINAL_PATH`: prevents accidental collisions with any Layer property upstream might add. Symbols don't appear in `Object.keys` / `for...in` / `JSON.stringify`, so they're invisible to consumers.
- **`Symbol.for('express-route-parser/patched')`** uses the global symbol registry. If our package is loaded twice through different paths (npm hoisting weirdness, monorepos), they share the same symbol and the idempotency check works correctly.
- **`require('router')` inside try/catch** gracefully no-ops on Express 4-only consumers. Don't add `router` to our dependencies — let Express 5 bring it in transitively.
- **Path arg extraction** rejects everything that isn't a string, RegExp, or array of either. Handlers (functions) passed as the first arg are correctly classified as "no mount path" — leaving `_origPath` undefined for those layers, which the walker treats as middleware (skipped).
- **Env-var escape hatch** `EXPRESS_ROUTE_PARSER_NO_AUTO_INSTRUMENT=1` is for users who need to defer instrumentation (e.g., loading our package after a router is already constructed somewhere). They'd then call `instrumentExpress5Router()` manually before parsing.
- **`Object.defineProperty` for `PATCHED_MARKER`** makes it non-enumerable / non-writable / non-configurable, so a hostile third party can't easily un-patch.

**Acceptance Criteria**:

- [ ] Importing this module patches `Router.prototype.use` and `.route` exactly once, even if imported repeatedly.
- [ ] If `router` package is not installed, import is a no-op (no thrown error).
- [ ] After import, every Layer constructed via `router.use(path, ...)` or `router.route(path)` has the original path on `layer[ORIGINAL_PATH]`.
- [ ] Layers constructed via `router.use(handler)` (no path arg) have `layer[ORIGINAL_PATH] === undefined`.
- [ ] `EXPRESS_ROUTE_PARSER_NO_AUTO_INSTRUMENT=1` skips the auto-install.
- [ ] After patching, calling `instrumentExpress5Router()` again is a no-op (returns `true`).

---

### Unit 3: Express version detection

**File**: `src/express-parser/detect.ts` (new)

```typescript
import type { Express } from 'express';

export type ExpressVersion = 4 | 5 | 'unknown';

export interface DetectionResult {
  version: ExpressVersion;
  /**
   * The router object to walk. For v4, this is `app._router` (or `undefined`
   * for routeless apps). For v5, this is `app.router` (the function itself
   * has a `.stack` property).
   */
  router: { stack: unknown[] } | undefined;
}

/**
 * Detects whether the given app is Express 4, Express 5, or neither.
 *
 * Heuristic:
 * - Express 4: `app._router` is truthy after first route registration.
 * - Express 5: `app._router` is `false`; `app.router` is a function with a `.stack`.
 *
 * For an Express 4 app with no routes registered, `app._router` is undefined
 * AND accessing `app.router` throws (the deprecated 3.x→4.x tripwire). The
 * try/catch handles this — we report `version: 4, router: undefined`, and the
 * dispatcher returns an empty array (matching the post-1.1.0 fix behavior).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function detectExpressVersion(app: Express): DetectionResult {
  const a = app as unknown as {
    _router?: { stack: unknown[] } | false;
    router?: { stack: unknown[] } | (() => unknown);
  };

  if (a._router && typeof a._router === 'object' && Array.isArray(a._router.stack)) {
    return { version: 4, router: a._router };
  }

  // Express 5: `app.router` is the canonical access; in Express 4 reading it
  // throws (deprecation tripwire). Wrap in try/catch.
  try {
    const r = a.router;
    if (typeof r === 'function' && Array.isArray((r as unknown as { stack: unknown[] }).stack)) {
      return { version: 5, router: r as unknown as { stack: unknown[] } };
    }
    if (r && typeof r === 'object' && Array.isArray((r as { stack: unknown[] }).stack)) {
      return { version: 5, router: r as { stack: unknown[] } };
    }
  } catch {
    // Express 4 with no routes registered: app._router is undefined AND
    // app.router throws. Report v4 with no router.
    return { version: 4, router: undefined };
  }

  return { version: 'unknown', router: undefined };
}
```

**Implementation Notes**:

- The `_router` truthy-and-object check is intentionally strict. Express 5 sets `app._router = false` (literal `false`); a naive truthy check would correctly reject it.
- The try/catch around `app.router` is load-bearing: it's the Express 4 deprecation throw, which would otherwise crash detection on routeless v4 apps.
- `'unknown'` covers neither shape — defensive; v2.0 will treat it as "no routes" and return `[]` (matching the routeless v4 behavior post-1.1.0).
- The router object's `stack` array is typed `unknown[]` here because v4 and v5 layer shapes differ; the per-version walkers narrow it.

**Acceptance Criteria**:

- [ ] Returns `{ version: 4, router: <obj> }` for an Express 4 app with at least one registered route.
- [ ] Returns `{ version: 4, router: undefined }` for an Express 4 app with no routes (the post-1.1.0 routeless case).
- [ ] Returns `{ version: 5, router: <fn> }` for an Express 5 app (with or without routes — Express 5 always has a router function).
- [ ] Does not throw on any input that's a valid Express 4 or 5 app.

---

### Unit 4: Move existing parser to `v4.ts`

**File**: `src/express-parser/v4.ts` (renamed from `src/express-parser/index.ts`)

Move the existing `ExpressPathParser` class, `parseRouteLayer`, `traverse`,
`pathRegexParser`, `mapKeysToPath`, and `onlyForTesting` export verbatim. The
top-level `parseExpressApp` overload signatures move to the new dispatcher
(Unit 6).

```typescript
// File contents identical to current src/express-parser/index.ts EXCEPT:
// - Rename the file to v4.ts
// - Replace the public `parseExpressApp` with internal `parseV4`:
export function parseV4(
  app: Express,
  options: ParseOptions,
): RouteMetaData[] | RouteMetaDataMulti[] {
  return new ExpressPathParser(app, options).appPaths;
}
// (or accept the already-detected router and skip the constructor's lookup)

// Keep `onlyForTesting = { pathRegexParser, mapKeysToPath };` exported.
```

**Implementation Notes**:

- This is a code move, not a rewrite. The 1.1.0 parser code stays correct for Express 4. Tests that depend on `onlyForTesting` import from `../express-parser/v4` instead of `../express-parser`.
- Internal export `parseV4(app, options)` is consumed by the dispatcher in Unit 6. Keep `ExpressPathParser` as the underlying class.
- The constructor's existing `app._router` lookup still works because the dispatcher only routes Express 4 apps to this code path. (It would also work for the routeless case since the constructor handles `undefined`.)

**Acceptance Criteria**:

- [ ] All 117 existing tests continue to pass without modification (other than test-file imports updating from `../express-parser` to `../express-parser/v4` for the `onlyForTesting` import).
- [ ] No behavior change in v4 mode.

---

### Unit 5: New Express 5 parser

**File**: `src/express-parser/v5.ts` (new)

```typescript
import type { Express } from 'express';
import type {
  RouteMetaData,
  RouteMetaDataMulti,
  Parameter,
  ParseOptions,
} from '../types';
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
export function parseV5(
  router: V5RouterStack,
  options: ParseOptions,
): RouteMetaData[] | RouteMetaDataMulti[] {
  const out: Array<RouteMetaData | RouteMetaDataMulti> = [];
  walkStack(router.stack, '', out, options.multipleMetadata === true);
  return out as RouteMetaData[] & RouteMetaDataMulti[];
}

function walkStack(
  stack: V5Layer[],
  parent: string,
  out: Array<RouteMetaData | RouteMetaDataMulti>,
  multipleMetadata: boolean,
): void {
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
      const newParent = mountPath !== undefined ? joinPath(parent, mountPathToString(mountPath)) : parent;
      walkStack((layer.handle as V5RouterStack).stack, newParent, out, multipleMetadata);
    }
    // else: bare middleware — skipped
  }
}

function emitRoute(
  layer: V5Layer,
  parent: string,
  out: Array<RouteMetaData | RouteMetaDataMulti>,
  multipleMetadata: boolean,
): void {
  if (!layer.route) return; // narrow

  const mountPath = layer[ORIGINAL_PATH];
  const routePathRaw = layer.route.path;
  const fullPath = joinPath(
    parent,
    mountPath !== undefined ? mountPathToString(mountPath) : routePathRaw,
  );
  // If the mount path was captured (e.g., from .route(path)), the route's
  // own .path is the same; fullPath above is correct. If the layer is a
  // direct app.METHOD(path, ...) registration with no parent, fullPath is
  // just `parent + route.path`.
  const finalPath = mountPath !== undefined ? fullPath : joinPath(parent, routePathRaw);

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metaEntries = entries.filter((e) => (e?.handle as any)?.metadata !== undefined);

    if (multipleMetadata) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const metadata = metaEntries.map((e) => (e.handle as any).metadata);
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          metadata: (metaEntries[0].handle as any).metadata,
        });
      }
    }
  }
}

/**
 * Extract path parameters from an Express 5 route path string using
 * path-to-regexp v8. Returns an empty array for paths with no parameters
 * or for non-string (regex / array) paths — those aren't parsed for params.
 */
function extractParameters(path: string | RegExp | Array<string | RegExp>): Parameter[] {
  if (typeof path !== 'string') return [];

  // Lazy-require so we don't load path-to-regexp on Express 4-only deployments.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { pathToRegexp } = require('path-to-regexp') as {
    pathToRegexp: (
      p: string,
    ) => { regexp: RegExp; keys: Array<{ type: 'param' | 'wildcard'; name: string }> };
  };

  let parsed: { keys: Array<{ type: 'param' | 'wildcard'; name: string }> };
  try {
    parsed = pathToRegexp(path);
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
}

/**
 * Heuristic: detect if a named segment appears inside `{...}` in the path
 * source. path-to-regexp v8 expresses optional segments via `{...}` wrappers
 * around the segment; the segment's `key.name` is preserved.
 *
 * Examples:
 *   '/users/:id'             — id NOT optional
 *   '/users/{:id}'           — id optional
 *   '/users{/:id}'           — id optional with leading slash
 *   '/files/*splat'          — splat (separately classified as wildcard)
 *   '/files/{*splat}'        — wildcard, also optional in zero-match sense
 */
function isOptional(rawPath: string, name: string): boolean {
  // Find a `{...}` group containing `:name` or `*name`.
  const re = new RegExp('\\{[^}]*[:*]' + escapeRegex(name) + '[^a-zA-Z0-9_]', 'g');
  const altRe = new RegExp('\\{[^}]*[:*]' + escapeRegex(name) + '\\}', 'g');
  return re.test(rawPath) || altRe.test(rawPath);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function joinPath(parent: string, child: string): string {
  if (!parent) return child || '/';
  if (!child || child === '/') return parent;
  return (parent + child).replace(/\/{2,}/g, '/');
}

function mountPathToString(p: string | RegExp | Array<string | RegExp>): string {
  if (typeof p === 'string') return p;
  if (p instanceof RegExp) return p.toString();
  // Array form: match v4 parser's existing behavior — join with comma.
  return p.map((x) => (typeof x === 'string' ? x : x.toString())).join(',');
}

// ---- Local duck-typed shapes for v5 / router@2 layers ----

interface V5RouterStack {
  stack: V5Layer[];
}

interface V5Layer {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle?: ((...args: any[]) => unknown) | V5RouterStack;
  route?: {
    path: string;
    stack: V5RouteEntry[];
  };
  [ORIGINAL_PATH]?: string | RegExp | Array<string | RegExp>;
}

interface V5RouteEntry {
  method?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle?: any;
}
```

**Implementation Notes**:

- **Lazy-require `path-to-regexp`** so Express 4-only consumers don't pay for it. Falls under the same "no runtime dep" principle as the `router` lazy-require in `instrument.ts`.
- **`isOptional` heuristic**: path-to-regexp v8's `keys` array doesn't carry optionality info — it's syntactic, expressed in the path string via `{...}` wrappers. Detecting it requires re-scanning the raw source. The regex-based detection covers the common forms (`{:name}`, `{/:name}`, `{:name}suffix`, etc.) but is heuristic. If path-to-regexp v8 ever exposes structural parsing output, swap to that.
- **Mount-path missing check** is the user-facing failure mode for "patch wasn't installed early enough". Throws with actionable instructions.
- **The `finalPath` computation** has a subtle wrinkle: for routes registered via `router.route('/x').get(...)`, the route layer's `_origPath` and `route.path` are the same string. Joining mount-prefix+`/x` is correct. For routes registered via `router.get('/x', ...)`, the route layer's `_origPath` is `/x` and `route.path` is also `/x`. Either way `joinPath(parent, route.path)` is correct. The duplicated computation is defensive.
- **Multi-metadata branch matches v4 behavior verbatim** — the design is: same `RouteMetaData` / `RouteMetaDataMulti` output, regardless of source Express version.

**Acceptance Criteria**:

- [ ] An Express 5 app with no routes returns `[]`.
- [ ] An Express 5 app with a top-level `app.get('/x/:id', h)` returns one entry: `{ path: '/x/:id', method: 'get', pathParams: [{ name: 'id', in: 'path', required: true, type: 'param' }] }`.
- [ ] Nested `app.use('/api/:v', router); router.get('/x', h)` returns `path: '/api/:v/x'`.
- [ ] Two-level nesting works (`app.use('/a', r1); r1.use('/b', r2); r2.get('/c', h)` → `/a/b/c`).
- [ ] Wildcard path `/files/*splat` produces `pathParams[0]` with `type: 'wildcard'`, `required: false`.
- [ ] Optional segment `/users/{:id}` produces `pathParams[0]` with `required: false`.
- [ ] Multiple methods on `router.route('/x').get().post()` produce two entries (issue #7 logic transfers).
- [ ] `multipleMetadata: true` returns `metadata: any[]` shape.
- [ ] If a sub-router was constructed before instrument was loaded, throws a clear actionable error.
- [ ] Regex mount paths `/api(/v\d+)/` and array mount paths `['/v1','/v2']` produce sensible string-form path output (matching v4 conventions).

---

### Unit 6: Dispatcher

**File**: `src/express-parser/index.ts` (rewrite — no longer holds the parser body)

```typescript
import type { Express } from 'express';
import type { RouteMetaData, RouteMetaDataMulti, ParseOptions } from '../types';
import { detectExpressVersion } from './detect';
import { parseV4 } from './v4';
import { parseV5 } from './v5';

/**
 * Parses an Express app and returns its routes with metadata. Auto-detects
 * Express 4 vs Express 5; works with both. For Express 5, requires that
 * `express-route-parser` was imported before any router was constructed
 * (the auto-installed instrumentation captures mount paths at that time).
 */
export function parseExpressApp(
  app: Express,
  options?: { multipleMetadata?: false },
): RouteMetaData[];
export function parseExpressApp(
  app: Express,
  options: { multipleMetadata: true },
): RouteMetaDataMulti[];
export function parseExpressApp(
  app: Express,
  options: ParseOptions = {},
): RouteMetaData[] | RouteMetaDataMulti[] {
  const detection = detectExpressVersion(app);

  if (detection.router === undefined) {
    return [] as RouteMetaData[] & RouteMetaDataMulti[];
  }

  if (detection.version === 4) {
    return parseV4(app, options);
  }

  if (detection.version === 5) {
    // The detection result already gave us the v5 router; pass it directly so
    // v5.ts doesn't re-do the lookup.
    return parseV5(detection.router as Parameters<typeof parseV5>[0], options);
  }

  // 'unknown' — defensive: treat as no routes.
  return [] as RouteMetaData[] & RouteMetaDataMulti[];
}
```

**Implementation Notes**:

- Same overload shape as 1.x — public API surface is unchanged.
- The dispatcher does NOT re-run the `app._router` / `app.router` lookup; it trusts `detectExpressVersion`'s result. v4 and v5 walkers each take a router object and walk it.
- `parseV4` accepts `(app, options)` because the existing class still does its own router lookup; that's fine — the `_router` it finds is the same one the dispatcher detected. Could be tightened later by passing the router in directly.
- The `'unknown'` branch is genuinely unreachable in practice (any app with `_router: false` AND no `app.router` function isn't an Express app), but the explicit return keeps the function total.

**Acceptance Criteria**:

- [ ] All 117 existing tests pass — `parseExpressApp(v4App)` works as before.
- [ ] `parseExpressApp(v5App)` works (covered by Unit 5's tests).
- [ ] `parseExpressApp(routelessV4App)` returns `[]` (1.1.0 fix preserved).
- [ ] `parseExpressApp(routelessV5App)` returns `[]`.
- [ ] Public type signatures unchanged (overload selection via `multipleMetadata` still works).

---

### Unit 7: Top-level export — ensure instrument runs

**File**: `src/index.ts`

```typescript
// Side-effect import: auto-install the Router prototype patch for Express 5
// before any user-imported router can be constructed. Loading this module
// before `express` works in typical apps where imports are at module top.
import './express-parser/instrument';

export { parseExpressApp } from './express-parser';
export { withMetadata } from './with-metadata';
export * from './types';
export * from './renderers';
```

**Implementation Notes**:

- The `import './express-parser/instrument'` line is the ONLY change. Its module body's `if (process.env.EXPRESS_ROUTE_PARSER_NO_AUTO_INSTRUMENT !== '1') instrumentExpress5Router();` runs as a side effect.
- The fact that this is the *first* import means the patch is applied before any other `express-route-parser` symbol resolves, which is before any user code that imports from us runs.
- `instrument.ts` doesn't re-export anything to the public API by default. Power users who need the manual escape hatch can `import { instrumentExpress5Router } from 'express-route-parser/lib/express-parser/instrument'` — deep import; not officially public, but not blocked either. If demand exists, we can re-export from index.ts in a future minor.

**Acceptance Criteria**:

- [ ] Importing `parseExpressApp` (or any other symbol) from `'express-route-parser'` causes `Router.prototype.use` and `.route` to be patched (verifiable via the `Symbol.for('express-route-parser/patched')` marker).

---

### Unit 8: `package.json` updates

**File**: `package.json`

```jsonc
{
  // unchanged: name, description, main, types, scripts, repo, funding, etc.
  "version": "1.1.0",  // bumped at release time to 2.0.0 via release script

  "peerDependencies": {
    "@types/express": "^4.x || ^5.x",
    "express": "^4.x || ^5.x"
  },

  "devDependencies": {
    // existing devDeps unchanged...

    // The default `express` devDep stays at v4 so existing tests don't churn:
    "@types/express": "^4.17.13",
    "express": "^4.18.1",

    // Add v5 alongside via npm aliases for parallel testing:
    "express-v5": "npm:express@^5.2.0",
    "@types/express-v5": "npm:@types/express@^5.0.0",

    // Required for v5 path-param extraction in tests; transitively present
    // via express-v5, but listing it explicitly clarifies the dep.
    "path-to-regexp": "^8.0.0"
  },

  "engines": {
    "node": ">=20"
  }
}
```

**Implementation Notes**:

- **Peer dep widens** to `^4.x || ^5.x`. Consumers install one. Both type packages widen the same way.
- **`express-v5` and `@types/express-v5` are npm aliases** — the same name `express` published under a different local name. Lets us have both `express@4` and `express@5` available in tests.
- **No new dependencies on production**. Both `router` and `path-to-regexp` come in transitively when consumers install Express 5.
- **`engines.node` stays at `>=20`** (Express 5's `>=18` is stricter-than-our-floor; aligning at 20 is safe).
- **`devDependencies.express` stays at v4** so the existing tests run without modification. v5-specific tests use `import express from 'express-v5'`.

**Acceptance Criteria**:

- [ ] `npm install` succeeds with the updated devDeps.
- [ ] `import express from 'express-v5'` resolves to express@5.x in test files.
- [ ] `import express from 'express'` continues to resolve to express@4.x (existing test imports unchanged).
- [ ] `peerDependencies` widening reflected.

---

### Unit 9: Tests — Express 5 suite

**File**: `src/__tests__/parser-v5.test.ts` (new)

```typescript
// Note: this file uses the `express-v5` npm alias (see package.json).
// The package's auto-instrument side effect runs when we import from the lib.
import { describe, it, expect, beforeEach } from 'vitest';
import express, { type Express, type Request, type Response, type NextFunction, type RequestHandler } from 'express-v5';
import { parseExpressApp, withMetadata } from '../index';

describe('Express 5 parser', () => {
  let app: Express;
  const ok: RequestHandler = (_req, res) => {
    res.status(204).send();
  };

  beforeEach(() => {
    app = express();
  });

  // --- Coverage parity with the v4 suite ------------------------------------

  it('returns [] for an Express 5 app with no routes', () => {
    expect(parseExpressApp(app)).toEqual([]);
  });

  it('parses a single top-level route', () => {
    app.get('/health', ok);
    expect(parseExpressApp(app)).toEqual([
      { path: '/health', method: 'get', pathParams: [] },
    ]);
  });

  it('extracts a required path parameter with type info', () => {
    app.get('/users/:id', ok);
    const [route] = parseExpressApp(app);
    expect(route.path).toBe('/users/:id');
    expect(route.pathParams).toEqual([
      { name: 'id', in: 'path', required: true, type: 'param' },
    ]);
  });

  it('parses an optional segment using v5 syntax {:name}', () => {
    app.get('/users{/:id}', ok);
    const [route] = parseExpressApp(app);
    expect(route.pathParams[0].name).toBe('id');
    expect(route.pathParams[0].required).toBe(false);
    expect(route.pathParams[0].type).toBe('param');
  });

  it('parses a wildcard segment as type "wildcard"', () => {
    app.get('/files/*splat', ok);
    const [route] = parseExpressApp(app);
    expect(route.pathParams).toEqual([
      { name: 'splat', in: 'path', required: false, type: 'wildcard' },
    ]);
  });

  it('parses nested sub-routers and joins mount paths', () => {
    const router = express.Router();
    const sub = express.Router();
    sub.get('/inner/:thing', ok);
    router.use('/sub/:tenant', sub);
    app.use('/api/:version', router);

    const parsed = parseExpressApp(app);
    expect(parsed).toEqual([
      {
        path: '/api/:version/sub/:tenant/inner/:thing',
        method: 'get',
        pathParams: [
          { name: 'thing', in: 'path', required: true, type: 'param' },
        ],
      },
    ]);
    // Note: pathParams reflects the LEAF route's own params, not the
    // ancestors' — matching existing v4 behavior. (This may be a separate
    // gap to address later, but it preserves parity.)
  });

  it('parses Router#route().get().post() as separate entries (issue #7 parity)', () => {
    app.route('/users').get(ok).post(ok);
    expect(parseExpressApp(app)).toEqual([
      { path: '/users', method: 'get', pathParams: [] },
      { path: '/users', method: 'post', pathParams: [] },
    ]);
  });

  it('throws on multiple metadata middlewares in single mode', () => {
    app.get('/x', withMetadata({ a: 1 }), withMetadata({ b: 2 }), ok);
    expect(() => parseExpressApp(app)).toThrow(/multipleMetadata: true/);
  });

  it('returns metadata: any[] in multipleMetadata mode', () => {
    app.get('/x', withMetadata({ a: 1 }), withMetadata({ b: 2 }), ok);
    const [route] = parseExpressApp(app, { multipleMetadata: true });
    expect(route.metadata).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('handles regex mount path', () => {
    const r = express.Router();
    r.get('/inner', ok);
    app.use(/^\/api/, r);
    expect(() => parseExpressApp(app)).not.toThrow();
    const parsed = parseExpressApp(app);
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    expect(parsed[0].method).toBe('get');
  });

  it('handles array mount path', () => {
    const r = express.Router();
    r.get('/inner', ok);
    app.use(['/v1', '/v2'], r);
    expect(() => parseExpressApp(app)).not.toThrow();
    const parsed = parseExpressApp(app);
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    expect(parsed[0].method).toBe('get');
  });

  it('HEAD method round-trip', () => {
    app.head('/health', ok);
    expect(parseExpressApp(app)[0].method).toBe('head');
  });

  it('OPTIONS method round-trip', () => {
    app.options('/cors', ok);
    expect(parseExpressApp(app)[0].method).toBe('options');
  });

  it('mounted empty router produces no entries', () => {
    const empty = express.Router();
    app.use('/empty', empty);
    expect(parseExpressApp(app)).toEqual([]);
  });

  it('withMetadata round-trips through v5 parser', () => {
    app.get('/x', withMetadata({ op: 'getX' }), ok);
    const [route] = parseExpressApp(app);
    expect(route.metadata).toEqual({ op: 'getX' });
  });
});

describe('Express 5 — instrument behavior', () => {
  it('throws a helpful error when a router was constructed before instrumentation', () => {
    // This is hard to test in-process because the instrument is auto-installed
    // on import. Use a child-process pattern: spawn a script that disables
    // auto-instrument, builds a router, then imports our package and parses.
    // See `parser-v5.test.ts` companion fixture or use `vi.mock`.
    // For v1: skip the negative case here and cover it via a separate test
    // file that uses `EXPRESS_ROUTE_PARSER_NO_AUTO_INSTRUMENT=1`.
  });
});
```

**Implementation Notes**:

- File uses `import express from 'express-v5'` to pin the v5 alias. `import { parseExpressApp, withMetadata }` from our lib pulls the same package — `path-to-regexp` v8 lazy-require fires inside `extractParameters`.
- The "instrument missing" negative test is genuinely awkward to write in-process (the side effect already ran). Plan: a small companion test file using `vi.spawn` or a separate child-process fixture. Stub for v1; harden later.
- The pathParams ancestry caveat noted: v4 parser surfaces ALL keys from the regex chain (mount + route); v5 parser as designed surfaces only the leaf route's params. This is a parity gap worth addressing — added to "Hardening Options" below.

**Acceptance Criteria**:

- [ ] All assertions pass against express@5.2.x.
- [ ] No new test failures in the existing v4 suite (test files import from `'express'` which stays v4).

---

### Unit 10: Type tests for new exports

**File**: `src/__tests__/types.test-d.ts` (extend)

Add:

```typescript
describe('Express 5 type extensions', () => {
  it('Parameter.type accepts the documented union or undefined', () => {
    type T = Parameter['type'];
    expectTypeOf<T>().toEqualTypeOf<'param' | 'wildcard' | undefined>();
  });

  it('Existing Parameter shape with new field still satisfies toMatchObjectType', () => {
    expectTypeOf<Parameter>().toMatchObjectType<{
      in: string;
      name: string;
      required: boolean;
    }>();
  });
});
```

**Acceptance Criteria**:

- [ ] `expectTypeOf<Parameter['type']>().toEqualTypeOf<'param' | 'wildcard' | undefined>()` passes.
- [ ] Existing 12 type tests in this file continue to pass.

---

### Unit 11: README + CHANGELOG

**File**: `README.md` (extend, add a "Express 5" section)

```markdown
## Express 5 support

`express-route-parser` works with Express 4 (since v1.0) and Express 5 (since v2.0). The same `parseExpressApp(app)` call works with either; the parser detects the version automatically.

For Express 5, **import this package before constructing any routers**:

\`\`\`typescript
// Top of your app entry point
import { parseExpressApp } from 'express-route-parser';
import express from 'express';                  // ← after our import

const app = express();
const router = express.Router();
router.get('/users/:id', handler);
app.use('/api', router);

const routes = parseExpressApp(app);
\`\`\`

Why: Express 5 stores mount paths only as compiled matcher closures; the original path string is unrecoverable after `Router.use(...)` returns. We patch `Router.prototype.use` and `.route` (auto-installed when this package is imported) to capture mount paths at registration time. The patch must be in place before any router is constructed.

If your build sometimes constructs routers in modules imported before `express-route-parser`, set `EXPRESS_ROUTE_PARSER_NO_AUTO_INSTRUMENT=1` and call `instrumentExpress5Router()` manually at the right time.

### Express 5 path-syntax notes

Express 5 uses `path-to-regexp@8`, which has different syntax than Express 4:

| Express 4 | Express 5 |
|---|---|
| `/users/:id` | `/users/:id` (unchanged) |
| `/users/:id?` | `/users{/:id}` |
| `/files/*` | `/files/*splat` (named wildcard) |

Migration is the consumer's job — Express 5 throws at registration time on the old syntax.

### Extra parameter info on Express 5

For routes parsed from an Express 5 app, each `Parameter` has a `type` field:

\`\`\`typescript
interface Parameter {
  name: string;
  in: 'path';
  required: boolean;
  type?: 'param' | 'wildcard';   // present on v5 routes
}
\`\`\`

Express 4 routes don't populate `type` (the field is absent).
```

**File**: `CHANGELOG.md` (under `[Unreleased]`)

```markdown
## [Unreleased]

### Added
- **Express 5 support.** `parseExpressApp(app)` auto-detects Express 4 vs Express 5 and dispatches to the appropriate parser. New `Parameter.type` field surfaces path-to-regexp v8's `'param'` vs `'wildcard'` distinction for v5 routes.
- Auto-installed `Router.prototype` patch on package import captures mount paths for Express 5 (necessary because Express 5 discards the path string at Layer construction). Idempotent; no-op on Express 4-only deployments. Disable via `EXPRESS_ROUTE_PARSER_NO_AUTO_INSTRUMENT=1`.
- New export: `instrumentExpress5Router()` for users who need to defer instrumentation.

### Changed
- **BREAKING (peer dep widening): `peerDependencies.express` is now `^4.x || ^5.x`** (was `^4.x`). Existing v1.x consumers on Express 4 are unaffected; Express 5 consumers can now install. Same widening for `@types/express`.
- Internal restructure: parser body split into `src/express-parser/v4.ts`, `src/express-parser/v5.ts`, and a thin dispatcher in `src/express-parser/index.ts`. Public API surface unchanged.

### Fixed
- (none specific to this release)
```

**Acceptance Criteria**:

- [ ] README has the Express 5 section explaining import order and path-syntax migration.
- [ ] CHANGELOG `[Unreleased]` entries cover Added (Express 5 + instrument), Changed (peer dep widening + restructure).

---

## Implementation Order

Strict dependency order:

1. **Unit 1** — `src/types/index.ts`. Foundational; no other unit compiles without `Parameter.type`.
2. **Unit 2** — `src/express-parser/instrument.ts`. Independent; can be implemented standalone with its own tests.
3. **Unit 3** — `src/express-parser/detect.ts`. Independent; small.
4. **Unit 4** — Move `src/express-parser/index.ts` → `src/express-parser/v4.ts`. Mechanical move; verify no regression in existing tests.
5. **Unit 5** — `src/express-parser/v5.ts`. Depends on Unit 1 (`Parameter.type`), Unit 2 (`ORIGINAL_PATH` symbol). Most complex unit.
6. **Unit 6** — `src/express-parser/index.ts` (rewritten as dispatcher). Depends on Units 3, 4, 5.
7. **Unit 7** — `src/index.ts` adds `import './express-parser/instrument'`. Trivial.
8. **Unit 8** — `package.json` updates. Land before tests so npm install brings in `express-v5`.
9. **Unit 9** — `src/__tests__/parser-v5.test.ts`. Depends on everything above.
10. **Unit 10** — Extend `src/__tests__/types.test-d.ts`. Independent of the parser code path; can be done in parallel with Unit 9.
11. **Unit 11** — README + CHANGELOG. Last.

Two-agent parallel split is feasible:
- **Agent A**: Units 1–7 (parser code path).
- **Agent B**: Unit 8 + Unit 9 + Unit 10 (test infra + tests + type tests).

Agent B has to wait for Agent A to finish for tests to compile, but can start on `package.json` updates + scaffolding immediately. For a single-agent run, follow the strict order.

## Testing

### Unit Tests

| File | Status | Covers |
|---|---|---|
| `src/__tests__/parser.test.ts` | unchanged | All v4 behavior (117 existing tests stay green) |
| `src/__tests__/parser-v5.test.ts` | **new** | All v5 behavior — coverage parity with v4 plus v5-specific (wildcard, optional segments, instrument-missing error) |
| `src/__tests__/with-metadata.test.ts` | unchanged | (`withMetadata` works identically across versions) |
| `src/__tests__/renderers.test.ts` | unchanged | (Renderers are version-agnostic) |
| `src/__tests__/types.test-d.ts` | extended | New `Parameter.type` field |
| `src/__tests__/example.test.ts` | unchanged | README round-trip smoke |

### Cross-version coverage check

After implementation, the v4 + v5 test files together should cover:
- Every shape variant of `RouteMetaData` and `RouteMetaDataMulti`
- All HTTP methods (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS/all)
- Mount path forms (string, regex, array)
- Single + multi metadata middleware
- Empty / routeless apps
- Multi-method chains (issue #7)
- `withMetadata` round-trip

The v5 file mirrors the v4 file for shared scenarios; v5-specific scenarios (wildcard, optional segments, instrument-missing) live only in v5.

### Coverage target

Maintain ≥99% statements, ≥95% branches (current state).

## Verification Checklist

```bash
# Units 1, 2, 3, 4, 5, 6, 7 — code compiles
npm run build

# Unit 8 — devDeps install
npm install
npm ls express express-v5 | grep -E 'express@4|express@5'  # both present

# Unit 9 — tests pass
npm test
# Expected: 117 pre-existing tests + ~15 new v5 tests + 2 new type tests = ~134 total

# Unit 10 — type tests
npx vitest run src/__tests__/types.test-d.ts

# Cross-version smoke
node -e "
require('./lib');                                            // auto-instrument fires
const e4 = require('express'); const e5 = require('express-v5');
const v4App = e4(); v4App.get('/v4', (_q,r)=>r.end());
const v5App = e5(); v5App.get('/v5', (_q,r)=>r.end());
const { parseExpressApp } = require('./lib');
console.log('v4:', JSON.stringify(parseExpressApp(v4App)));
console.log('v5:', JSON.stringify(parseExpressApp(v5App)));
"

# Lib/ structure
test -f lib/express-parser/instrument.js
test -f lib/express-parser/v4.js
test -f lib/express-parser/v5.js
test -f lib/express-parser/detect.js
test -f lib/express-parser/index.js

# Lint clean
npm run lint
```

## Hardening Options (Not Implemented Now)

- **Surface ancestor-router params on the leaf `RouteMetaData`** — current v5 parser only emits the leaf route's own params (e.g., `/api/:v/users/:id` → `pathParams: [{ name: 'id' }]`, missing `:v`). The v4 parser carries ancestors. Worth fixing for parity in a follow-up.
- **Parse path-to-regexp v8 keys structurally** instead of regex-detecting `{...}` for optionality. If/when v8 exposes a richer parse API, swap.
- **Provide a public `instrumentExpress5Router()` re-export** if power users ask for it. Currently only available via deep import.
- **Tests for `EXPRESS_ROUTE_PARSER_NO_AUTO_INSTRUMENT=1` path** via spawned subprocess. Skipped in v1 because of in-process module-cache reuse complexity.
- **TypeScript discriminated union** between `Parameter` (v4) and `Parameter5` (v5) — currently a single shape with optional `type`. Discriminated form would be more rigorous; less DX-friendly.
- **Expose `instrument`'s patched-marker symbol** for testing tools that want to verify their setup.
- **Compatibility for path-to-regexp v6/v7** (Express 4.21+ may use these in minor variations) — currently we only test against v0.x (Express 4.18) and v8 (Express 5.2).
- **Renderer support for `Parameter.type`** — render wildcard/optional differently in HTML/Markdown. Probably worth doing as a follow-up minor.

## References

- PoC research: `/tmp/erp-express5-research/poc.js` and `inspect*.js` (live during this design session; can be re-created from the design rationale)
- Express 5 release notes: https://expressjs.com/en/guide/migrating-5.html
- `router@2.x` source (the relevant Layer constructor): https://github.com/pillarjs/router/blob/master/lib/layer.js
- `path-to-regexp@8` docs: https://github.com/pillarjs/path-to-regexp
- Existing v4 parser: `src/express-parser/index.ts` (post 1.1.0)
