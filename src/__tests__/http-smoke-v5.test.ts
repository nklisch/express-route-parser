// G6 — Live HTTP smoke test for v5.
//
// Boots a real Express 5 server on a random port, parses it, then fetches
// every parsed route with a concrete URL. A 404 means the parser produced
// a path Express doesn't actually serve — that's a parser bug.
//
// Substitution rules for concrete URLs:
// :name    → 'sample'
// *splat   → 'a/b/c'  (wildcards require at least one segment in ptR v8)
// {/:opt}  → omitted (optional segment — hit the absent form)

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express-v5';
import type { RequestHandler } from 'express-v5';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { parseExpressApp } from '../index';
import type { RouteMetaData, RouteMetaDataMulti } from '../types';

const ok: RequestHandler = (_req, res) => {
  res.status(204).send();
};

let server: Server;
let baseUrl: string;
let routes: RouteMetaData[] | RouteMetaDataMulti[];

beforeAll(async () => {
  const app = express();

  app.get('/health', ok);
  app.get('/users/:id', ok);
  app.get('/files/*splat', ok);
  app.post('/items', ok);

  const router = express.Router();
  router.get('/x', ok);
  app.use('/api/:tenant', router);

  app.route('/multi').get(ok).post(ok);

  routes = parseExpressApp(app);

  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

/**
 * Substitute path parameters with concrete values so we can make real HTTP
 * requests. Returns null for paths that cannot be automatically substituted
 * (e.g., RegExp mounts).
 */
const concreteUrl = (path: RouteMetaData['path']): string | null => {
  if (typeof path !== 'string') return null;
  return (
    path
      // wildcard segment: *splat → a/b/c
      .replace(/\*\w+/g, 'a/b/c')
      // required param: :name → sample
      .replace(/:(\w+)/g, 'sample')
      // optional group: {/...} — drop the entire optional segment
      .replace(/\{[^}]*\}/g, '')
      // clean up any double slashes from dropped optional segments
      .replace(/\/{2,}/g, '/')
  );
};

describe('G6: HTTP smoke — every parsed route responds 2xx on its substituted URL', () => {
  it('has at least one parsed route to smoke', () => {
    expect(routes.length).toBeGreaterThan(0);
  });

  it('each parsed route responds with a 2xx status on its concrete URL', async () => {
    for (const route of routes) {
      const urlPath = concreteUrl(route.path);
      if (urlPath === null) continue; // skip regex/array paths

      const url = `${baseUrl}${urlPath}`;
      const method = route.method.toUpperCase();

      // HEAD and OPTIONS are auto-handled by Express; skip if not explicitly
      // registered in this smoke app (avoid false negatives from auto-responses)
      if (method === 'HEAD' || method === 'OPTIONS') continue;

      const res = await fetch(url, { method });
      expect(res.status, `Expected 2xx for ${method} ${urlPath} but got ${res.status}`).toBeGreaterThanOrEqual(200);
      expect(res.status, `Expected 2xx for ${method} ${urlPath} but got ${res.status}`).toBeLessThan(300);
    }
  });
});
