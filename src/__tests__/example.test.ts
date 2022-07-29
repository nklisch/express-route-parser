/* eslint-disable no-console */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { parseExpressApp } from '../index';
import express, { RequestHandler, Request, Response, NextFunction } from 'express';

it('runs the example code', () => {
    const app = express();
    const router = express.Router();
    const subrouter = express.Router();
    // **Optional middleware construct**
    // Wrapper function to allow us to attach meta-data to a route in a re-usable way
    const middleware = (metadata: any): RequestHandler => {
        const m: any = (req: Request, res: Response, next: NextFunction) => {
            next(); // This can be anything - validation, something else. You can hook into your existing middlewares if you want
        };
        m.metadata = metadata;
        return m;
    };

    // place holder express response handler
    const successResponse: RequestHandler = (req: Request, res: Response) => {
        res.status(204).send();
    };

    app.get(
        '/resources/users/:id',
        middleware({ operationId: 'getUserById', notes: 'These are some notes' }),
        successResponse,
    );

    // The middleware MUST be placed on a final route layer (app.get, router.post, app.patch, router.route, ect...)
    subrouter.get(
        '/:resourceId',
        middleware({
            operationId: 'getResourceByEntity',
            hidden: true,
            schema: {
                /* some schema data */
            },
        }),
        successResponse,
    );
    // This parser can handle nested, complex router projects
    router.use('/:entity', subrouter);
    app.use('/dashboard', router);

    const parsed = parseExpressApp(app);
    console.log(parsed[0].pathParams);
    console.log(parsed[1].pathParams);
    expect(parsed).toEqual([
        {
            path: '/resources/users/:id',
            pathParams: [{ name: 'id', in: 'path', required: true }],
            method: 'get',
            metadata: { operationId: 'getUserById', notes: 'These are some notes' },
        },
        {
            path: '/dashboard/:entity/:resourceId',
            pathParams: [
                { name: 'entity', in: 'path', required: true },
                { name: 'resourceId', in: 'path', required: true },
            ],
            method: 'get',
            metadata: { operationId: 'getResourceByEntity', hidden: true, schema: {} },
        },
    ]);
});
