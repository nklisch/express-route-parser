import { AnyRouteMetaData, pathToString, metadataToString } from './serialize';

export interface HtmlRenderOptions {
  /**
   * Document title and `<h1>` heading.
   * @default "Routes"
   */
  title?: string;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const routeRow = (route: AnyRouteMetaData): string => {
  const method = route.method.toUpperCase();
  const methodClass = `method method-${route.method.toLowerCase()}`;
  const path = escapeHtml(pathToString(route.path));
  const params = route.pathParams.length
    ? route.pathParams.map((p) => `<code>${escapeHtml(String(p.name))}${p.required ? '' : '?'}</code>`).join(' ')
    : '<span class="dim">—</span>';
  const meta = metadataToString(route);
  const metaCell = meta
    ? `<details><summary>show</summary><pre>${escapeHtml(meta)}</pre></details>`
    : '<span class="dim">—</span>';

  return [
    '<tr>',
    `<td><span class="${methodClass}">${method}</span></td>`,
    `<td><code>${path}</code></td>`,
    `<td>${params}</td>`,
    `<td>${metaCell}</td>`,
    '</tr>',
  ].join('');
};

const STYLES = `
  :root { color-scheme: light; }
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 1100px; margin: 2rem auto; padding: 0 1rem; color: #222; }
  h1 { margin: 0 0 0.25rem; }
  .meta { color: #777; margin: 0 0 1.5rem; font-size: 0.9em; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 0.5rem 0.75rem; vertical-align: top; border-bottom: 1px solid #eee; }
  th { background: #fafafa; font-weight: 600; font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.04em; color: #555; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em; background: #f5f5f5; padding: 0.1em 0.4em; border-radius: 3px; }
  pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85em; background: #f7f7f9; padding: 0.5rem 0.75rem; border-radius: 4px; overflow-x: auto; margin: 0.5rem 0 0; }
  details > summary { cursor: pointer; color: #06c; font-size: 0.9em; user-select: none; }
  .dim { color: #bbb; }
  .method { display: inline-block; padding: 0.1em 0.55em; border-radius: 3px; font-size: 0.78em; font-weight: 700; color: #fff; min-width: 3.5em; text-align: center; }
  .method-get { background: #2e7d32; }
  .method-post { background: #1565c0; }
  .method-put { background: #ef6c00; }
  .method-patch { background: #6a1b9a; }
  .method-delete { background: #c62828; }
  .method-head, .method-options { background: #607d8b; }
`.trim();

/**
 * Renders a parsed route list as a self-contained HTML document. The output
 * has no external dependencies (all CSS is inlined) and renders correctly
 * when saved to disk and opened directly in a browser.
 *
 * @example
 * ```ts
 * import fs from 'node:fs';
 * import { parseExpressApp, renderRoutesAsHtml } from 'express-route-parser';
 *
 * const html = renderRoutesAsHtml(parseExpressApp(app));
 * fs.writeFileSync('routes.html', html);
 * ```
 */
export const renderRoutesAsHtml = (routes: AnyRouteMetaData[], options: HtmlRenderOptions = {}): string => {
  const title = options.title ?? 'Routes';
  const rows = routes.map(routeRow).join('\n');

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${STYLES}</style>`,
    '</head>',
    '<body>',
    `<h1>${escapeHtml(title)}</h1>`,
    `<p class="meta">${routes.length} route${routes.length === 1 ? '' : 's'}</p>`,
    '<table>',
    '<thead><tr><th>Method</th><th>Path</th><th>Path Params</th><th>Metadata</th></tr></thead>',
    '<tbody>',
    rows,
    '</tbody>',
    '</table>',
    '</body>',
    '</html>',
  ].join('\n');
};
