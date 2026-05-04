// Integration test: real v5-parsed routes fed into all three renderers.
// Distinct from renderers.test.ts (which uses synthetic fixtures).
// The goal is to ensure type:'wildcard' and other v5-specific shapes
// don't break rendering and that parser output round-trips cleanly.
import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express-v5';
import type { RequestHandler } from 'express-v5';
import { parseExpressApp } from '../index';
import { renderRoutesAsHtml, renderRoutesAsMarkdown, renderRoutesAsJson } from '../renderers';
import type { RouteMetaData, RouteMetaDataMulti } from '../types';

const ok: RequestHandler = (_req, res) => {
  res.status(204).send();
};

let routes: RouteMetaData[] | RouteMetaDataMulti[];
let routesMulti: RouteMetaData[] | RouteMetaDataMulti[];

beforeAll(() => {
  const app = express();
  const router = express.Router();

  app.get('/users/:id', ok);
  app.get('/users{/:id}', ok);
  app.get('/files/*splat', ok);
  router.get('/x', ok);
  app.use('/api/:tenant', router);
  app.route('/y').get(ok).post(ok);

  routes = parseExpressApp(app);

  const app2 = express();
  const router2 = express.Router();

  app2.get('/users/:id', ok);
  app2.get('/users{/:id}', ok);
  app2.get('/files/*splat', ok);
  router2.get('/x', ok);
  app2.use('/api/:tenant', router2);
  app2.route('/y').get(ok).post(ok);

  routesMulti = parseExpressApp(app2, { multipleMetadata: true });
});

describe('v5 parser output → HTML renderer', () => {
  it('returns a non-empty string without throwing', () => {
    const html = renderRoutesAsHtml(routes);
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });

  it('contains all parsed paths as substrings', () => {
    const html = renderRoutesAsHtml(routes);
    const paths = routes.map((r) => (typeof r.path === 'string' ? r.path : ''));
    for (const p of paths) {
      expect(html).toContain(p);
    }
  });

  it('handles type:"wildcard" without throwing or mangling output', () => {
    const html = renderRoutesAsHtml(routes);
    // /files/*splat must appear — type field must not break the renderer
    expect(html).toContain('/files/*splat');
  });

  it('works with multipleMetadata:true output', () => {
    const html = renderRoutesAsHtml(routesMulti);
    expect(html.length).toBeGreaterThan(0);
  });
});

describe('v5 parser output → Markdown renderer', () => {
  it('returns a non-empty string without throwing', () => {
    const md = renderRoutesAsMarkdown(routes);
    expect(typeof md).toBe('string');
    expect(md.length).toBeGreaterThan(0);
  });

  it('contains all parsed paths', () => {
    const md = renderRoutesAsMarkdown(routes);
    const paths = routes.map((r) => (typeof r.path === 'string' ? r.path : ''));
    for (const p of paths) {
      expect(md).toContain(p);
    }
  });

  it('contains all HTTP methods in uppercase', () => {
    const md = renderRoutesAsMarkdown(routes);
    const methods = [...new Set(routes.map((r) => r.method.toUpperCase()))];
    for (const m of methods) {
      expect(md).toContain(m);
    }
  });

  it('works with multipleMetadata:true output', () => {
    const md = renderRoutesAsMarkdown(routesMulti);
    expect(md.length).toBeGreaterThan(0);
  });
});

describe('v5 parser output → JSON renderer', () => {
  it('returns valid JSON without throwing', () => {
    const json = renderRoutesAsJson(routes);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('round-trips: parsed routes serialized then re-parsed equals the original', () => {
    const json = renderRoutesAsJson(routes);
    const parsed = JSON.parse(json) as RouteMetaData[];
    // Compare key fields — JSON round-trip must preserve path, method, pathParams
    expect(parsed).toHaveLength(routes.length);
    for (let i = 0; i < routes.length; i++) {
      expect(parsed[i].path).toEqual(routes[i].path);
      expect(parsed[i].method).toEqual(routes[i].method);
      expect(parsed[i].pathParams).toEqual(routes[i].pathParams);
    }
  });

  it('preserves type:"wildcard" on the wildcard param through JSON', () => {
    const json = renderRoutesAsJson(routes);
    const parsed = JSON.parse(json) as RouteMetaData[];
    const fileRoute = parsed.find((r) => typeof r.path === 'string' && r.path.includes('*splat'));
    expect(fileRoute).toBeDefined();
    expect(fileRoute!.pathParams[0].type).toBe('wildcard');
  });

  it('works with multipleMetadata:true output', () => {
    const json = renderRoutesAsJson(routesMulti);
    expect(() => JSON.parse(json)).not.toThrow();
  });
});
