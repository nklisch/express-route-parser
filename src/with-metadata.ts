import type { Request, Response, NextFunction } from 'express';
import type { MetadataHandler } from './types';

/**
 * Returns a no-op Express middleware with `metadata` attached. Intended for
 * the documentation-via-metadata pattern shown in the README.
 *
 * The parser detects the `metadata` property on middleware in a route's stack
 * and surfaces its value on the corresponding {@link RouteMetaData} entry.
 *
 * @example
 * ```ts
 * import { parseExpressApp, withMetadata } from 'express-route-parser';
 *
 * app.get(
 *   '/users/:id',
 *   withMetadata({ operationId: 'getUser', tags: ['users'] }),
 *   realHandler,
 * );
 * ```
 *
 * @typeParam M - the shape of the metadata being attached. If you have a
 * project-wide convention, define a type alias and pass it explicitly:
 * `withMetadata<MyMetadata>({ ... })`.
 */
export const withMetadata = <M>(metadata: M): MetadataHandler<M> => {
  const handler = (_req: Request, _res: Response, next: NextFunction): void => {
    next();
  };
  (handler as MetadataHandler<M>).metadata = metadata;
  return handler as MetadataHandler<M>;
};
