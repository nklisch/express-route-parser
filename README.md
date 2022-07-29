# express-route-parser
This package parses an express project, generating a list of all routes, converted to the syntax used in a express route.

## Features
Can Parse:
- Nested Routers and Complex Express Projects
- Optional parameters e.g. `/:name?`
- Complex Matching routes e.g. `/ma*tch`, `/ex(ab)?mple`
- Regex routes e.g. `/\/abc|\/xyz/`
- Array of paths e.g. `app.get(['/abc', '/xyz']) -> /abc,xyz/`

Outputs list of relevant data with the option to attach arbitrary meta-data to a route:
 ```javascript
    // Example output for a single route
    [{
            path: '/dashboard/:entity/:resourceId',
            pathParams: [
                { name: 'entity', in: 'path', required: true },
                { name: 'resourceId', in: 'path', required: true },
            ],
            method: 'get',
            // metadata can be anything the designer chooses
            metadata: { 
                operationId: 'getResourceByEntity', 
                hidden: true, 
                schema: {/* some schema */} 
                },
        }]
 ```
## Installation
```
npm i express-route-parser
```

## Usage
```javascript
import { parseExpressApp } from 'express-route-parser';
import express, { RequestHandler, Request, Response, NextFunction } from 'express';
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
    
    // You must parse your express app after you have added any and all routes in your app
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

```

**Output**
```javascript
parsedApp = 
    [
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
    ]
```

