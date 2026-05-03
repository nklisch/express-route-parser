import { describe, it, expect, vi } from 'vitest';
import express, { Express, RequestHandler, Request, Response } from 'express';
import { withMetadata } from '../with-metadata';
import { parseExpressApp } from '../index';

describe('withMetadata', () => {
  it('attaches metadata to the returned handler', () => {
    const h = withMetadata({ tag: 'users' });
    expect(h.metadata).toEqual({ tag: 'users' });
  });

  it('returns a function that calls next() with no error', () => {
    const h = withMetadata({});
    const next = vi.fn();
    h({} as Request, {} as Response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledWith();
  });

  it('attaches the exact metadata reference', () => {
    const meta = { operationId: 'test', tags: ['a', 'b'] };
    const h = withMetadata(meta);
    expect(h.metadata).toBe(meta);
  });

  it('works with primitive metadata values', () => {
    expect(withMetadata('hello').metadata).toBe('hello');
    expect(withMetadata(42).metadata).toBe(42);
    expect(withMetadata(null).metadata).toBeNull();
  });

  it('round-trips through the parser', () => {
    const app: Express = express();
    const successResponse: RequestHandler = (_req: Request, res: Response) => res.status(204).send();
    app.get('/x', withMetadata({ op: 'x' }), successResponse);
    const parsed = parseExpressApp(app);
    expect(parsed[0].metadata).toEqual({ op: 'x' });
  });

  it('round-trips complex metadata through the parser', () => {
    const app: Express = express();
    const successResponse: RequestHandler = (_req: Request, res: Response) => res.status(204).send();
    const meta = { operationId: 'getUser', tags: ['users'], deprecated: false };
    app.get('/users/:id', withMetadata(meta), successResponse);
    const parsed = parseExpressApp(app);
    expect(parsed[0].metadata).toEqual(meta);
    expect(parsed[0].path).toBe('/users/:id');
  });
});
