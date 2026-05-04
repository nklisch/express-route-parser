// Pins the v5 README example so documentation and behaviour stay in sync.
// Mirrors example.test.ts but uses express-v5 and asserts the type field
// that v5 always populates.
import { describe, it, expect } from 'vitest';
import express from 'express-v5';
import type { RequestHandler } from 'express-v5';
import { parseExpressApp, withMetadata } from '../index';

describe('README v5 example', () => {
  it('round-trips through the parser with correct paths, params, and metadata', () => {
    const app = express();
    const router = express.Router();
    const subrouter = express.Router();

    const ok: RequestHandler = (_req, res) => {
      res.status(204).send();
    };

    // Top-level route with metadata (mirrors the v4 example shape)
    app.get(
      '/resources/users/:id',
      withMetadata({ operationId: 'getUserById', notes: 'These are some notes' }),
      ok,
    );

    // Nested sub-router with metadata on the leaf route
    subrouter.get(
      '/:resourceId',
      withMetadata({ operationId: 'getResourceByEntity', hidden: true, schema: {} }),
      ok,
    );
    router.use('/:entity', subrouter);
    app.use('/dashboard', router);

    const parsed = parseExpressApp(app);

    expect(parsed).toEqual([
      {
        path: '/resources/users/:id',
        method: 'get',
        pathParams: [{ name: 'id', in: 'path', required: true, type: 'param' }],
        metadata: { operationId: 'getUserById', notes: 'These are some notes' },
      },
      {
        path: '/dashboard/:entity/:resourceId',
        method: 'get',
        pathParams: [
          { name: 'entity', in: 'path', required: true, type: 'param' },
          { name: 'resourceId', in: 'path', required: true, type: 'param' },
        ],
        metadata: { operationId: 'getResourceByEntity', hidden: true, schema: {} },
      },
    ]);
  });
});
