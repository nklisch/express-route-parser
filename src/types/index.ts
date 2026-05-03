import { Router } from 'express';
import type { RequestHandler } from 'express';
import * as ExpressInterfaces from 'express-serve-static-core';

export interface Route extends ExpressInterfaces.IRoute {
  stack: Layer[];
  metadata?: any;
  name: string;
}

export interface Layer {
  handle?: Route | Router;
  stack: Layer[];
  route: Route;
  name: string;
  params?: ExpressInterfaces.PathParams;
  path?: string;
  keys: Key[];
  regexp: ExpressRegex;
  method: string;
}

export interface ExpressRegex extends RegExp {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  fast_slash: boolean;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  fast_star: boolean;
}

export interface RouteMetaData {
  path: string | string[] | ExpressRegex;
  pathParams: Parameter[];
  method: string;
  metadata?: any;
}

export interface Parameter {
  in: string;
  name: string;
  required: boolean;
  [key: string]: any;
}

export interface Key {
  name: string;
  optional: boolean;
  offset: number;
}

/**
 * Options for {@link parseExpressApp}. Allows opting into behaviors that
 * would be breaking changes if applied unconditionally.
 */
export interface ParseOptions {
  /**
   * When true, routes with multiple metadata-bearing middlewares are returned
   * as {@link RouteMetaDataMulti} entries with `metadata: any[]` instead of
   * throwing.
   *
   * Default: `false` (preserves existing v1.x behavior).
   */
  multipleMetadata?: boolean;
}

/**
 * Like {@link RouteMetaData}, but with `metadata` always present as an array
 * (possibly empty). Returned by `parseExpressApp(app, { multipleMetadata: true })`.
 */
export interface RouteMetaDataMulti {
  path: string | string[] | ExpressRegex;
  pathParams: Parameter[];
  method: string;
  /**
   * All metadata middlewares attached to this route's method, in declaration
   * order. Empty array if no metadata middlewares are attached.
   */
  metadata: any[];
}

/**
 * A {@link RequestHandler} with a `metadata` field attached. Returned by
 * {@link withMetadata}. The parser detects the `metadata` field and surfaces
 * its value on the corresponding route.
 */
export type MetadataHandler<M = unknown> = RequestHandler & { metadata: M };
