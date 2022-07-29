/* eslint-disable @typescript-eslint/restrict-plus-operands */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable no-underscore-dangle */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { Express, Router } from 'express';
import { RouteMetaData, ExpressRegex, Key, Layer, Parameter, Route } from '../types';

/**
 *
 * @param app
 * @param middlewareWrapper
 * @returns List of routes for this express app with meta-data that has been picked up
 */
export const parseExpressApp = (app: Express): RouteMetaData[] => {
  return new ExpressPathParser(app).appPaths;
};

class ExpressPathParser {
  private readonly _appPaths: RouteMetaData[];
  public get appPaths() {
    return this._appPaths;
  }
  constructor(app: Express) {
    this._appPaths = [];
    const router: Router = app._router || app.router;
    if (router) {
      router.stack.forEach((layer: Layer) => {
        this.traverse('', layer, []);
      });
    }
  }
  /**
   * Recursive traversal method for the express router and middleware tree.
   *
   * @param path The current path segment that we have traversed so far
   * @param layer The current 'layer' of the router tree
   * @param keys The keys for the parameter's in the current path branch of the traversal
   * @returns void - base case saves result to internal object
   */
  private traverse = (path: string, layer: Layer, keys: Key[]): RouteMetaData | undefined => {
    keys = [...keys, ...layer.keys];
    if (layer.name === 'router' && layer.handle) {
      layer.handle.stack.forEach((l: Layer) => {
        path = path || '';
        this.traverse(`${path}/${pathRegexParser(layer.regexp, layer.keys)}`, l, keys);
      });
    }
    if (!layer.route || !layer.route.stack.length) {
      return;
    }
    this._appPaths.push(this.parseRouteLayer(layer, keys, path));
  };
  /**
   * Parses a route object. Route objects are the leafs of an express router tree
   *
   * @param layer The layer of this route object - represents the stack of middleware and other meta data
   * @param keys The full set of keys for this particular route
   * @param basePath The base path as it was initial declared for this route
   * @returns A ExpressPath object holding the meta data for a given route
   */
  private parseRouteLayer = (layer: Layer, keys: Key[], basePath: string): RouteMetaData => {
    const lastRequestHandler = layer.route.stack[layer.route.stack.length - 1];
    const pathParams: Parameter[] = keys.map((key) => {
      return { name: key.name, in: 'path', required: !key.optional };
    });
    const filtered = layer.route.stack.filter((element) => (element?.handle as Route)?.metadata);
    if (filtered.length > 1) {
      throw new Error('Only one metadata middleware is allowed per route');
    }
    if (filtered.length === 0) {
      return { path: basePath + layer.route.path, pathParams, method: lastRequestHandler.method };
    }
    return {
      path: basePath + layer.route.path,
      pathParams,
      method: lastRequestHandler.method,
      metadata: (filtered[0].handle as Route).metadata,
    };
  };
}

/** Parses an express layer's regex and converts it to the original format seen in code.
 *
 * @param layerRegexPath The layer's regex pattern
 * @param keys The keys that represent the layer's path parameters
 * @returns {string} The path string for that layer
 * Code inspired and modify from:
 * https://github.com/expressjs/express/issues/3308#issuecomment-300957572
 */
const pathRegexParser = (layerRegexPath: ExpressRegex | string, keys: Key[]): string => {
  if (typeof layerRegexPath === 'string') {
    return layerRegexPath;
  }
  if (layerRegexPath.fast_slash) {
    return '';
  }
  if (layerRegexPath.fast_star) {
    return '*';
  }
  let mappedPath = '';
  if (keys && keys.length) {
    mappedPath = mapKeysToPath(layerRegexPath, keys);
  }
  const match = layerRegexPath
    .toString()
    .replace('\\/?', '')
    .replace('(?=\\/|$)', '$')
    .match(/^\/\^((?:\\[.*+?^${}()|[\]\\/]|[^.*+?^${}()|[\]\\/])*)\$\//) as string[];

  if (match) {
    return match[1].replace(/\\(.)/g, '$1').slice(1);
  }
  if (mappedPath) {
    return mappedPath.slice(1);
  }
  return layerRegexPath.toString();
};

/**
 * Map's the keys/path variables to the regex inside a given path
 *
 * @param layerRegexPath The regex for a react router with path parameters
 * @param keys The keys that represent the path parameters
 * @returns {string} The regex for a path variable converted to original string on the express route
 */
const mapKeysToPath = (layerRegexPath: ExpressRegex, keys: Key[]): string => {
  if (!keys || keys.length === 0) {
    throw Error('must include atleast one key to map');
  }
  let convertedSubPath = layerRegexPath.toString();
  for (const key of keys) {
    if (key.optional) {
      convertedSubPath = convertedSubPath.replace('(?:\\/([^\\/]+?))?\\', `/:${key.name}?`);
    } else {
      convertedSubPath = convertedSubPath.replace('(?:([^\\/]+?))', `:${key.name}`);
    }
  }
  return convertedSubPath
    .replace('/?(?=\\/|$)/i', '')
    .replace('/^', '')
    .replace(/\\/gi, '')
    .replace(/\/{2,}/gi, '/');
};

export const onlyForTesting = { pathRegexParser, mapKeysToPath };
