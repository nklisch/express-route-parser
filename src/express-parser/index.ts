/* eslint-disable no-underscore-dangle */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */

import { Express, Router } from 'express';
import { RouteMetaData, RouteMetaDataMulti, ParseOptions, ExpressRegex, Key, Layer, Parameter, Route } from '../types';

/**
 * Parses an Express app and generates a list of routes with metadata.
 *
 * @param app The Express app reference. Must be used after all routes have been attached.
 * @param options Optional parse options. Pass `{ multipleMetadata: true }` to allow multiple
 * metadata-bearing middlewares per route (returned as `metadata: any[]`).
 * By default the parser throws if it encounters more than one metadata middleware
 * on a route, matching v1.x behavior.
 * @returns List of routes with metadata, in declaration order.
 */
export function parseExpressApp(app: Express, options?: { multipleMetadata?: false }): RouteMetaData[];
export function parseExpressApp(app: Express, options: { multipleMetadata: true }): RouteMetaDataMulti[];
export function parseExpressApp(app: Express, options: ParseOptions = {}): RouteMetaData[] | RouteMetaDataMulti[] {
  const parser = new ExpressPathParser(app, options);
  return parser.appPaths;
}

class ExpressPathParser {
  private readonly _appPaths: (RouteMetaData | RouteMetaDataMulti)[];
  private readonly _multipleMetadata: boolean;

  public get appPaths(): RouteMetaData[] & RouteMetaDataMulti[] {
    // The actual element shape matches whichever mode was selected; the
    // overloads on parseExpressApp narrow it for callers.
    return this._appPaths as RouteMetaData[] & RouteMetaDataMulti[];
  }

  constructor(app: Express, options: ParseOptions = {}) {
    this._multipleMetadata = options.multipleMetadata === true;
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
    this._appPaths.push(...this.parseRouteLayer(layer, keys, path));
  };
  /**
   * Parses a route object. Route objects are the leafs of an express router tree.
   * Emits one RouteMetaData per distinct HTTP method registered on the route
   * (e.g. `router.route('/x').post(...).get(...)` yields two entries).
   *
   * @param layer The layer of this route object - represents the stack of middleware and other meta data
   * @param keys The full set of keys for this particular route
   * @param basePath The base path as it was initial declared for this route
   * @returns A list of ExpressPath objects holding the meta data for each method on the route
   */
  private parseRouteLayer = (layer: Layer, keys: Key[], basePath: string): (RouteMetaData | RouteMetaDataMulti)[] => {
    const pathParams: Parameter[] = keys.map((key) => {
      return { name: key.name, in: 'path', required: !key.optional };
    });
    const path = (basePath + layer.route.path).replace(/\/{2,}/gi, '/');

    // Group route stack entries by HTTP method. Express creates one stack entry
    // per `.method(handler)` invocation, so multi-handler calls like
    // `app.get('/x', mw, h)` produce multiple entries that share a method, while
    // chained calls like `.post(...).get(...)` produce entries with different
    // methods. `.all()` produces entries with method=undefined, which we skip.
    const methodGroups = new Map<string, Layer[]>();
    for (const entry of layer.route.stack) {
      if (!entry.method) continue;
      const group = methodGroups.get(entry.method);
      if (group) {
        group.push(entry);
      } else {
        methodGroups.set(entry.method, [entry]);
      }
    }

    const results: (RouteMetaData | RouteMetaDataMulti)[] = [];
    for (const [method, entries] of methodGroups) {
      const metaEntries = entries.filter((element) => (element?.handle as Route)?.metadata);

      if (this._multipleMetadata) {
        // Multi mode: always emit `metadata: any[]` (possibly empty).
        const metadata = metaEntries.map((e) => (e.handle as Route).metadata);
        results.push({ path, pathParams, method, metadata });
      } else {
        // Single mode: existing v1.x behavior, with a friendlier error message.
        if (metaEntries.length > 1) {
          throw new Error(
            'Only one metadata middleware is allowed per route. ' +
              'Pass { multipleMetadata: true } to parseExpressApp() to allow multiple.',
          );
        }
        if (metaEntries.length === 0) {
          results.push({ path, pathParams, method });
        } else {
          results.push({
            path,
            pathParams,
            method,
            metadata: (metaEntries[0].handle as Route).metadata,
          });
        }
      }
    }
    return results;
  };
}

/** Parses an express layer's regex and converts it to the original format seen in code.
 *
 * @param layerRegexPath The layer's regex pattern
 * @param keys The keys that represent the layer's path parameters
 * @returns The path string for that layer
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
 * @returns The regex for a path variable converted to original string on the express route
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
