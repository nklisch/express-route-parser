/* eslint-disable no-underscore-dangle */
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
 *
 * - Express 4: `app._router` is truthy after first route registration.
 * Express 4's `_router` is a function (Router extends Function) that also has a `.stack`.
 * - Express 5: `app._router` is undefined; `app.router` is a function with a `.stack`.
 *
 * For an Express 4 app with no routes registered, `app._router` is undefined
 * AND accessing `app.router` throws (the deprecated 3.x→4.x tripwire). The
 * try/catch handles this — we report `version: 4, router: undefined`, and the
 * dispatcher returns an empty array (matching the post-1.1.0 fix behavior).
 */
export const detectExpressVersion = (app: Express): DetectionResult => {
  const a = app as unknown as { _router?: { stack: unknown[] }; router?: { stack: unknown[] } };

  const router4 = a._router;
  if (router4 && Array.isArray(router4.stack)) {
    return { version: 4, router: router4 };
  }

  // Express 5: `app.router` is the canonical access; in Express 4 reading it
  // throws (deprecation tripwire). Wrap in try/catch.
  try {
    const r = a.router;
    if (r && Array.isArray(r.stack)) {
      return { version: 5, router: r };
    }
  } catch {
    // Express 4 with no routes registered: app._router is undefined AND
    // app.router throws. Report v4 with no router.
    return { version: 4, router: undefined };
  }

  return { version: 'unknown', router: undefined };
};
