import type { Express } from 'express';
import type { RouteMetaData, RouteMetaDataMulti, ParseOptions } from '../types';
import { detectExpressVersion } from './detect';
import { parseV4 } from './v4';
import { parseV5 } from './v5';

/**
 * Parses an Express app and returns its routes with metadata. Auto-detects
 * Express 4 vs Express 5; works with both. For Express 5, requires that
 * `express-route-parser` was imported before any router was constructed
 * (the auto-installed instrumentation captures mount paths at that time).
 */
export function parseExpressApp(app: Express, options?: { multipleMetadata?: false }): RouteMetaData[];
export function parseExpressApp(app: Express, options: { multipleMetadata: true }): RouteMetaDataMulti[];
export function parseExpressApp(app: Express, options: ParseOptions = {}): RouteMetaData[] | RouteMetaDataMulti[] {
  const detection = detectExpressVersion(app);

  if (detection.router === undefined) {
    return [] as RouteMetaData[] & RouteMetaDataMulti[];
  }

  if (detection.version === 4) {
    return parseV4(app, options);
  }

  if (detection.version === 5) {
    // The detection result already gave us the v5 router; pass it directly so
    // v5.ts doesn't re-do the lookup.
    return parseV5(detection.router as Parameters<typeof parseV5>[0], options);
  }

  // 'unknown' — defensive: treat as no routes.
  return [] as RouteMetaData[] & RouteMetaDataMulti[];
}

// Re-export for the existing parser.test.ts which imports onlyForTesting
// from '../express-parser'. This keeps the test file unchanged.
export { onlyForTesting } from './v4';
