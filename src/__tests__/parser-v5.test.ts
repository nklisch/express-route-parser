// Note: this file uses the `express-v5` npm alias (see package.json).
// The package's auto-instrument side effect runs when we import from the lib.
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express-v5';
import type { Express, RequestHandler } from 'express-v5';
import { parseExpressApp, withMetadata, instrumentExpress5Router } from '../index';

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
    expect(parseExpressApp(app)).toEqual([{ path: '/health', method: 'get', pathParams: [] }]);
  });

  it('extracts a required path parameter with type info', () => {
    app.get('/users/:id', ok);
    const [route] = parseExpressApp(app);
    expect(route.path).toBe('/users/:id');
    expect(route.pathParams).toEqual([{ name: 'id', in: 'path', required: true, type: 'param' }]);
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
    expect(route.pathParams).toEqual([{ name: 'splat', in: 'path', required: false, type: 'wildcard' }]);
  });

  it('parses nested sub-routers, joins mount paths, accumulates ancestor params', () => {
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
          { name: 'version', in: 'path', required: true, type: 'param' },
          { name: 'tenant', in: 'path', required: true, type: 'param' },
          { name: 'thing', in: 'path', required: true, type: 'param' },
        ],
      },
    ]);
  });

  it('regex mount path: leaf params only, no throw', () => {
    const r = express.Router();
    r.get('/users/:id', ok);
    app.use(/^\/api/, r);
    const [route] = parseExpressApp(app);
    expect(route.method).toBe('get');
    expect(route.pathParams).toEqual([{ name: 'id', in: 'path', required: true, type: 'param' }]);
  });

  it('array mount path: leaf params only, no throw', () => {
    const r = express.Router();
    r.get('/users/:id', ok);
    app.use(['/v1', '/v2'], r);
    const [route] = parseExpressApp(app);
    expect(route.method).toBe('get');
    expect(route.pathParams).toEqual([{ name: 'id', in: 'path', required: true, type: 'param' }]);
  });

  it('three-level nested mount: all ancestor params are reported', () => {
    const router = express.Router();
    const sub = express.Router();
    sub.get('/c/:z', ok);
    router.use('/b/:y', sub);
    app.use('/a/:x', router);

    const [route] = parseExpressApp(app);
    expect(route.path).toBe('/a/:x/b/:y/c/:z');
    expect(route.pathParams).toEqual([
      { name: 'x', in: 'path', required: true, type: 'param' },
      { name: 'y', in: 'path', required: true, type: 'param' },
      { name: 'z', in: 'path', required: true, type: 'param' },
    ]);
  });

  it('optional ancestor segment is reported with required: false', () => {
    const r = express.Router();
    r.get('/x', ok);
    app.use('/api{/:v}', r);
    const [route] = parseExpressApp(app);
    expect(route.pathParams).toEqual([{ name: 'v', in: 'path', required: false, type: 'param' }]);
  });

  it('nested optional groups: inner param is structurally optional', () => {
    app.get('/a/{:b{/:c}}', ok);
    const [route] = parseExpressApp(app);
    expect(route.pathParams).toEqual([
      { name: 'b', in: 'path', required: false, type: 'param' },
      { name: 'c', in: 'path', required: false, type: 'param' },
    ]);
  });

  it('wildcard inside a group is still reported as wildcard / not required', () => {
    app.get('/{*splat}', ok);
    const [route] = parseExpressApp(app);
    expect(route.pathParams).toEqual([{ name: 'splat', in: 'path', required: false, type: 'wildcard' }]);
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

  // --- G3: PUT / PATCH / DELETE round-trip --------------------------------

  it('PUT round-trip', () => {
    app.put('/items/:id', ok);
    const [route] = parseExpressApp(app);
    expect(route.method).toBe('put');
    expect(route.path).toBe('/items/:id');
    expect(route.pathParams).toEqual([{ name: 'id', in: 'path', required: true, type: 'param' }]);
  });

  it('PATCH round-trip', () => {
    app.patch('/items/:id', ok);
    const [route] = parseExpressApp(app);
    expect(route.method).toBe('patch');
    expect(route.path).toBe('/items/:id');
  });

  it('DELETE round-trip', () => {
    app.delete('/items/:id', ok);
    const [route] = parseExpressApp(app);
    expect(route.method).toBe('delete');
    expect(route.path).toBe('/items/:id');
  });

  // --- G4: full chained .route() with all methods -------------------------

  it('.route().all().get().post().put().patch().delete().head().options() — all explicit methods emitted, .all() skipped', () => {
    app.route('/multi').all(ok).get(ok).post(ok).put(ok).patch(ok).delete(ok).head(ok).options(ok);

    const parsed = parseExpressApp(app);
    const methods = parsed.map((r) => r.method);

    // Every explicit method must appear
    expect(methods).toContain('get');
    expect(methods).toContain('post');
    expect(methods).toContain('put');
    expect(methods).toContain('patch');
    expect(methods).toContain('delete');
    expect(methods).toContain('head');
    expect(methods).toContain('options');

    // .all() must NOT produce a standalone entry (no method)
    expect(methods.every((m) => m !== undefined && m !== '')).toBe(true);

    // All share the same path
    expect(parsed.every((r) => r.path === '/multi')).toBe(true);
  });

  // --- G7: instrumentExpress5Router() idempotency -------------------------

  it('instrumentExpress5Router() called three times always returns true and parse still works', () => {
    expect(instrumentExpress5Router()).toBe(true);
    expect(instrumentExpress5Router()).toBe(true);
    expect(instrumentExpress5Router()).toBe(true);

    app.get('/health', ok);
    expect(parseExpressApp(app)).toEqual([{ path: '/health', method: 'get', pathParams: [] }]);
  });

  // --- A2: 4-arg error middleware silently skipped ------------------------

  it('4-arg error middleware in the stack is silently skipped', () => {
    app.get('/x', ok);
    // Must be exactly 4 args — Express detects error middleware by fn.length === 4
    app.use((_err: unknown, _req: unknown, _res: unknown, next: () => void) => next());
    const parsed = parseExpressApp(app);
    expect(parsed).toEqual([{ path: '/x', method: 'get', pathParams: [] }]);
  });

  // --- A3: 3-arg catchall / 404 handler silently skipped -----------------

  it('bare 3-arg fallthrough handler (404 catchall) is silently skipped', () => {
    app.get('/x', ok);
    app.use((_req: unknown, res: { status: (n: number) => { send: () => void } }) => res.status(404).send());
    const parsed = parseExpressApp(app);
    expect(parsed).toEqual([{ path: '/x', method: 'get', pathParams: [] }]);
  });

  // --- A4: bare middleware before route registration ----------------------

  it('bare app.use(fn) calls before a real route are silently skipped', () => {
    const mw: RequestHandler = (_req, _res, next) => next();
    app.use(mw);
    app.use(mw);
    app.get('/x', ok);
    expect(parseExpressApp(app)).toEqual([{ path: '/x', method: 'get', pathParams: [] }]);
  });

  // --- A5: router.param() handler is not a route -------------------------

  it('router.param() handler does not appear as a route', () => {
    const router = express.Router();
    router.param('id', (_req, _res, next) => next());
    router.get('/users/:id', ok);
    app.use('/', router);

    const parsed = parseExpressApp(app);
    expect(parsed).toEqual([
      {
        path: '/users/:id',
        method: 'get',
        pathParams: [{ name: 'id', in: 'path', required: true, type: 'param' }],
      },
    ]);
  });

  // --- A6: two sub-routers mounted at the same prefix --------------------

  it('two sub-routers at the same prefix both have their routes emitted', () => {
    const r1 = express.Router();
    r1.get('/a', ok);
    const r2 = express.Router();
    r2.post('/b', ok);

    app.use('/api', r1);
    app.use('/api', r2);

    const parsed = parseExpressApp(app);
    expect(parsed).toContainEqual({ path: '/api/a', method: 'get', pathParams: [] });
    expect(parsed).toContainEqual({ path: '/api/b', method: 'post', pathParams: [] });
    expect(parsed).toHaveLength(2);
  });

  // --- A8: .route().all() interleaved with explicit methods ---------------

  it('.route().all(mw).get(ok).post(ok) — .all() skipped, get+post emitted', () => {
    app.route('/multi').all(ok).get(ok).post(ok);

    const parsed = parseExpressApp(app);
    expect(parsed).toHaveLength(2);
    expect(parsed).toContainEqual({ path: '/multi', method: 'get', pathParams: [] });
    expect(parsed).toContainEqual({ path: '/multi', method: 'post', pathParams: [] });
  });
});
