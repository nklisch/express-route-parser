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

const PATCHED_MARKER = Symbol.for('express-route-parser/patched');

export interface CapturedPath {
  /**
   * The original path argument passed to `router.use(path, ...)` or
   * `router.route(path)`. Stored on each newly-created Layer as a hidden
   * symbol property so the v5 walker can reconstruct full paths.
   */
  path: string | RegExp | (string | RegExp)[];
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
export const instrumentExpress5Router = (): boolean => {
  let routerModule: unknown;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    routerModule = require('router');
  } catch {
    // No `router` package — Express 4-only consumer. Nothing to do.
    return false;
  }

  const rm = routerModule as { prototype: RouterPrototype & { [PATCHED_MARKER]?: true } };
  const proto = rm.prototype;

  if (proto[PATCHED_MARKER]) {
    return true; // already patched; idempotent
  }

  // eslint-disable-next-line @typescript-eslint/unbound-method
  const origUse = proto.use;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const origRoute = proto.route;

  proto.use = function patchedUse(this: RouterStack, ...args: unknown[]): unknown {
    const stackBefore = this.stack.length;
    const ret = origUse.apply(this, args);
    const mountPath = pathArg(args[0]);
    if (mountPath !== undefined) {
      for (let i = stackBefore; i < this.stack.length; i++) {
        this.stack[i][ORIGINAL_PATH] = mountPath;
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
};

const pathArg = (first: unknown): string | RegExp | (string | RegExp)[] | undefined => {
  if (typeof first === 'string') return first;
  if (first instanceof RegExp) return first;
  if (Array.isArray(first) && first.every((p) => typeof p === 'string' || p instanceof RegExp)) {
    return first;
  }
  return undefined;
};

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
  [ORIGINAL_PATH]?: string | RegExp | (string | RegExp)[];
}

// Side-effect: install on import unless explicitly disabled. The env-var
// escape hatch is for unusual setups (lazy-loaded modules, test isolation).
if (process.env.EXPRESS_ROUTE_PARSER_NO_AUTO_INSTRUMENT !== '1') {
  instrumentExpress5Router();
}
