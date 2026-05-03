import type { RouteMetaData, RouteMetaDataMulti, ExpressRegex } from '../types';

/**
 * Renderers accept either single-metadata or multi-metadata route arrays —
 * use this union as the input type.
 */
export type AnyRouteMetaData = RouteMetaData | RouteMetaDataMulti;

/**
 * Convert a route's `path` field (which may be a string, string[], or RegExp)
 * to a display-safe string. Used by all renderers for consistent path display.
 */
export const pathToString = (path: string | string[] | ExpressRegex): string => {
  if (typeof path === 'string') return path;
  if (Array.isArray(path)) return path.join(', ');
  return path.toString();
};

/**
 * Stringify metadata for non-JSON renderers. Returns `undefined` if no
 * metadata is present (single-mode) or the array is empty (multi-mode).
 */
export const metadataToString = (route: AnyRouteMetaData): string | undefined => {
  // Both RouteMetaData (metadata?: any) and RouteMetaDataMulti (metadata: any[]) have
  // a `metadata` field; we read it uniformly here and branch on the runtime shape.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const meta = (route as { metadata?: any }).metadata;
  if (Array.isArray(meta)) {
    if (meta.length === 0) return undefined;
    return JSON.stringify(meta, null, 2);
  }
  if (meta === undefined) return undefined;
  return JSON.stringify(meta, null, 2);
};
