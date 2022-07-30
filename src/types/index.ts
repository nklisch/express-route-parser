import { Router } from 'express';
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
  path: string;
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
