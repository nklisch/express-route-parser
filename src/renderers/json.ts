import type { AnyRouteMetaData } from './serialize';

export interface JsonRenderOptions {
  /**
   * Number of spaces per indent level.
   * @default 2
   */
  indent?: number;
}

/**
 * JSON.stringify replacer that converts RegExp values to their `.toString()`
 * form. Other values pass through unchanged.
 */
const regexReplacer = (_key: string, value: unknown): unknown => {
  if (value instanceof RegExp) {
    return value.toString();
  }
  return value;
};

/**
 * Renders a parsed route list as pretty-printed JSON.
 *
 * Handles the special case of `RouteMetaData['path']` being a `RegExp`
 * (which would otherwise serialize as `{}`) by converting it to its string
 * form via `RegExp.prototype.toString()`.
 */
export const renderRoutesAsJson = (routes: AnyRouteMetaData[], options: JsonRenderOptions = {}): string => {
  const indent = options.indent ?? 2;
  return JSON.stringify(routes, regexReplacer, indent);
};
