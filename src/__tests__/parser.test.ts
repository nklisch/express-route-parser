/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/naming-convention */

import express, { Express, NextFunction, Request, Response, Router, RequestHandler } from 'express';
import { onlyForTesting } from '../express-parser';
import { parseExpressApp } from '../index';
import { ExpressRegex } from '../types';

const staticPath = /^\/sub-route2\/?(?=\/|$)/i as ExpressRegex;
const oneDynamicPath = () => {
  return {
    regex: /^\/sub-route\/(?:([^\/]+?))\/?(?=\/|$)/i as ExpressRegex,
    keys: [
      {
        name: 'test1',
        optional: false,
        offset: 12,
      },
    ],
  };
};
const twoDynamicPaths = () => {
  return {
    regex: /^\/sub-sub-route\/(?:([^\/]+?))\/(?:([^\/]+?))\/?(?=\/|$)/i as ExpressRegex,
    keys: [
      {
        name: 'test2',
        optional: false,
        offset: 16,
      },
      {
        name: 'test3',
        optional: false,
        offset: 31,
      },
    ],
  };
};

const operationObject = {
  description: 'Returns pets based on ID',
  summary: 'Find pets by ID',
  operationId: 'getPetsById',
  responses: {
    '200': {
      description: 'pet response',
      content: {
        '*/*': {
          schema: {
            type: 'array',
            items: {
              $ref: '#/components/schemas/Pet',
            },
          },
        },
      },
    },
    default: {
      description: 'error payload',
      content: {
        'text/html': {
          schema: {
            $ref: '#/components/schemas/ErrorModel',
          },
        },
      },
    },
  },
};

const middleware = (metadata: any): RequestHandler => {
  const m = (req: Request, res: Response, next: NextFunction) => {
    next();
  };
  m.metadata = metadata;
  return m;
};

describe('mapKeysToPath: maps keys to path', () => {
  it('handles one dynamic path parameter', () => {
    expect(onlyForTesting.mapKeysToPath(oneDynamicPath().regex, oneDynamicPath().keys)).toBe('/sub-route/:test1');
  });
  it('handles two dynamic path parameters', () => {
    expect(onlyForTesting.mapKeysToPath(twoDynamicPaths().regex, twoDynamicPaths().keys)).toBe(
      '/sub-sub-route/:test2/:test3',
    );
  });
  it('handles empty keys', () => {
    expect(() => onlyForTesting.mapKeysToPath(staticPath, [])).toThrow();
  });
  it('handles optional parameters', () => {
    const optional = twoDynamicPaths();
    optional.regex = /^\/sub-sub-route(?:\/([^\/]+?))?\/(?:([^\/]+?))\/?(?=\/|$)/i as ExpressRegex;
    optional.keys[0].optional = true;
    expect(onlyForTesting.mapKeysToPath(optional.regex, optional.keys)).toBe('/sub-sub-route/:test2?/:test3');
  });
});

describe('pathRegexParser: converts regex to path', () => {
  it('handles static regex route', () => {
    expect(onlyForTesting.pathRegexParser(staticPath, [])).toBe('sub-route2');
  });
  it('handles one dynamic path parameters', () => {
    expect(onlyForTesting.pathRegexParser(oneDynamicPath().regex, oneDynamicPath().keys)).toBe('sub-route/:test1');
  });
  it('handles two dynamic path parameters', () => {
    expect(onlyForTesting.pathRegexParser(twoDynamicPaths().regex, twoDynamicPaths().keys)).toBe(
      'sub-sub-route/:test2/:test3',
    );
  });
  it('handles normal string', () => {
    expect(onlyForTesting.pathRegexParser('testing/test', [])).toBe('testing/test');
  });
  it('handles fast slash', () => {
    const fastSlash: any = /test/;
    fastSlash.fast_slash = true;
    fastSlash.fast_star = false;
    expect(onlyForTesting.pathRegexParser(fastSlash, [])).toBe('');
  });
  it('handles fast star', () => {
    const fastStar: any = /test/;
    fastStar.fast_slash = false;
    fastStar.fast_star = true;
    expect(onlyForTesting.pathRegexParser(fastStar, [])).toBe('*');
  });
  it('handles custom regex path', () => {
    expect(onlyForTesting.pathRegexParser(/test/ as ExpressRegex, [])).toBe('/test/');
  });
});

describe('it parses an express app with', () => {
  let app: Express;
  const successResponse: RequestHandler = (req: Request, res: Response) => {
    res.status(204).send();
  };
  beforeEach(() => {
    app = express();
  });

  it('a route', () => {
    app.get('/test/the/endpoint', successResponse);
    const parsed = parseExpressApp(app);
    const { path, method, pathParams } = parsed[0];
    expect(path).toBe('/test/the/endpoint');
    expect(method).toBe('get');
    expect(pathParams).toEqual([]);
  });

  it('a path parameter', () => {
    app.delete('/test/:id/endpoint', successResponse);
    const parsed = parseExpressApp(app);
    const { path, method, pathParams } = parsed[0];
    expect(path).toBe('/test/:id/endpoint');
    expect(method).toBe('delete');
    expect(pathParams).toEqual([{ name: 'id', in: 'path', required: true }]);
  });

  it('a optional path parameter', () => {
    app.patch('/test/:id?/endpoint', successResponse);
    const parsed = parseExpressApp(app);
    const { path, method, pathParams } = parsed[0];
    expect(path).toBe('/test/:id?/endpoint');
    expect(method).toBe('patch');
    expect(pathParams).toEqual([{ name: 'id', in: 'path', required: false }]);
  });

  it('multiple path parameters', () => {
    app.post('/test/:name/:id/:day', successResponse);
    app.get('/test/:id?/:test?/:cid?', successResponse);
    const parsed = parseExpressApp(app);
    let { path, method, pathParams } = parsed[0];
    expect(path).toBe('/test/:name/:id/:day');
    expect(method).toBe('post');
    expect(pathParams).toEqual([
      { name: 'name', in: 'path', required: true },
      { name: 'id', in: 'path', required: true },
      { name: 'day', in: 'path', required: true },
    ]);
    ({ path, method, pathParams } = parsed[1]);
    expect(path).toBe('/test/:id?/:test?/:cid?');
    expect(method).toBe('get');
    expect(pathParams).toEqual([
      { name: 'id', in: 'path', required: false },
      { name: 'test', in: 'path', required: false },
      { name: 'cid', in: 'path', required: false },
    ]);
  });

  it('regex path parameters', () => {
    app.post(/\/abc|\/xyz/, successResponse);
    const parsed = parseExpressApp(app);
    const { path, method, pathParams } = parsed[0];
    expect(path).toBe('/\\/abc|\\/xyz/');
    expect(method).toBe('post');
    expect(pathParams).toEqual([]);
  });

  it('array of path parameters', () => {
    app.get(['/abcd', '/xyza', /\/lmn|\/pqr/], successResponse);
    const parsed = parseExpressApp(app);
    const { path, method, pathParams } = parsed[0];
    expect(path).toBe('/abcd,/xyza,/\\/lmn|\\/pqr/');
    expect(method).toBe('get');
    expect(pathParams).toEqual([]);
  });

  it('paths with *,? and +', () => {
    app.get('/abc?d', successResponse);
    app.get('/ab*cd', successResponse);
    app.get('/a(bc)?d', successResponse);
    const parsed = parseExpressApp(app);
    let { path, method, pathParams } = parsed[0];
    expect(path).toBe('/abc?d');
    expect(method).toBe('get');
    expect(pathParams).toEqual([]);
    ({ path, method, pathParams } = parsed[1]);
    expect(path).toBe('/ab*cd');
    expect(method).toBe('get');
    expect(pathParams).toEqual([{ in: 'path', name: 0, required: true }]);
    ({ path, method, pathParams } = parsed[2]);
    expect(path).toBe('/a(bc)?d');
    expect(method).toBe('get');
    expect(pathParams).toEqual([{ in: 'path', name: 0, required: true }]);
  });

  it('route pattern', () => {
    app
      .route('/test')
      .all((req, res, next) => next())
      .get(successResponse);
    const parsed = parseExpressApp(app);
    const { path, method, pathParams } = parsed[0];
    expect(path).toBe('/test');
    expect(method).toBe('get');
    expect(pathParams).toEqual([]);
  });

  it('path with middleware', () => {
    app.use((req, res, next) => next());
    app.get('/test', (req, res, next) => next(), successResponse);
    const parsed = parseExpressApp(app);
    const { path, method, pathParams } = parsed[0];
    expect(path).toBe('/test');
    expect(method).toBe('get');
    expect(pathParams).toEqual([]);
  });

  it('an openApiPath middleware path doc extraction', () => {
    app.get('/test', middleware({ operationId: 'test', operationObject }), successResponse);
    const parsed = parseExpressApp(app);
    const { path, method, pathParams, metadata } = parsed[0];
    expect(path).toBe('/test');
    expect(method).toBe('get');
    expect(pathParams).toEqual([]);
    expect(metadata).toEqual({ operationId: 'test', operationObject });
  });

  it('to handled multiple metadata middlewares on a route', () => {
    app.get(
      '/test',
      middleware({ operationId: 'test', operationObject }),
      middleware({ operationId: 'test', operationObject }),
      successResponse,
    );
    expect(() => parseExpressApp(app)[0].metadata).toThrow();
  });

  it('it doesnt pick up middleware on use routes', () => {
    app.use(middleware({ operationId: 'test', operationObject }));
    app.get('/test', middleware({ operationId: 'test', operationObject }), successResponse);
    expect(parseExpressApp(app)[0].metadata).toEqual({ operationId: 'test', operationObject });
  });
});

describe('parses an express app with ', () => {
  let app: Express;
  let router: Router;
  let subrouter: Router;
  const successResponse: RequestHandler = (req: Request, res: Response) => {
    res.status(204).send();
  };
  beforeEach(() => {
    app = express();
    router = express.Router();
    subrouter = express.Router();
  });

  it('sub-routes', () => {
    subrouter.get('/endpoint', successResponse);
    router.use('/sub-route', subrouter);
    app.use('/test', router);
    const parsed = parseExpressApp(app);
    const { path, method, pathParams } = parsed[0];
    expect(path).toBe('/test/sub-route/endpoint');
    expect(method).toBe('get');
    expect(pathParams).toEqual([]);
  });

  it('sub-routes with openApiMiddleware', () => {
    subrouter.get(
      '/endpoint',
      middleware({ operationId: 'test', operationObject, location: 'route' }),
      successResponse,
    );
    router.use('/sub-route', subrouter);
    app.use('/test', router);
    const parsed = parseExpressApp(app);
    const { path, method, pathParams, metadata } = parsed[0];
    expect(path).toBe('/test/sub-route/endpoint');
    expect(method).toBe('get');
    expect(pathParams).toEqual([]);
    expect(metadata).toEqual({ operationId: 'test', operationObject, location: 'route' });
  });

  it('nested sub-routes with a path parameters Router', () => {
    const router2 = express.Router();
    const subrouter2 = express.Router();

    subrouter.get('/endpoint', successResponse);
    subrouter.post('/endpoint2', successResponse);

    app.use('/sub-route/:test1', router);
    router.use('/sub-sub-route/:test2/:test3', subrouter);
    app.use('/sub-route2', router2);
    router2.use('/:test/qualifier', subrouter2);
    subrouter2.put('/:name/endpoint2/:id', successResponse);

    const parsed = parseExpressApp(app);
    let { path, method, pathParams } = parsed[0];
    expect(path).toBe('/sub-route/:test1/sub-sub-route/:test2/:test3/endpoint');
    expect(pathParams).toEqual([
      { name: 'test1', in: 'path', required: true },
      { name: 'test2', in: 'path', required: true },
      { name: 'test3', in: 'path', required: true },
    ]);
    expect(method).toBe('get');
    ({ path, method, pathParams } = parsed[1]);
    expect(path).toBe('/sub-route/:test1/sub-sub-route/:test2/:test3/endpoint2');
    expect(pathParams).toEqual([
      { name: 'test1', in: 'path', required: true },
      { name: 'test2', in: 'path', required: true },
      { name: 'test3', in: 'path', required: true },
    ]);
    expect(method).toBe('post');
    ({ path, method, pathParams } = parsed[2]);
    expect(path).toBe('/sub-route2/:test/qualifier/:name/endpoint2/:id');
    expect(pathParams).toEqual([
      { name: 'test', in: 'path', required: true },
      { name: 'name', in: 'path', required: true },
      { name: 'id', in: 'path', required: true },
    ]);
    expect(method).toBe('put');
  });
});
