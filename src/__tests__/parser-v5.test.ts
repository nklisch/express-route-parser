// Note: this file uses the `express-v5` npm alias (see package.json).
// The package's auto-instrument side effect runs when we import from the lib.
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express-v5';
import type { Express, RequestHandler } from 'express-v5';
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
