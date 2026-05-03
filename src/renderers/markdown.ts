import { AnyRouteMetaData, pathToString, metadataToString } from './serialize';

export interface MarkdownRenderOptions {
  /**
   * Top-level heading.
   * @default "Routes"
   */
  title?: string;
}

/**
 * Escape pipe characters so they don't break the markdown table column
 * separator. Newlines are converted to `<br>` since GFM tables don't allow
 * literal newlines in cells.
 */
const escapePipe = (s: string): string => s.replace(/\|/g, '\\|').replace(/\n/g, '<br>');

/**
 * Wrap multi-line metadata JSON in a `<details>` element so it doesn't
 * dominate the table. Single-line short metadata is rendered as inline code.
 */
const metaToCollapsible = (meta: string): string => {
  if (!meta.includes('\n') && meta.length < 60) {
    return `\`${escapePipe(meta)}\``;
  }
  // GFM accepts <details> in tables; markdown inside it must be HTML-style.
  // Use a <pre> block since fenced code blocks can't be nested in table cells.
  const escaped = meta.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<details><summary>show</summary><pre>${escaped}</pre></details>`;
};

/**
 * Renders a parsed route list as a Markdown table. Suitable for embedding
 * in a README, GitHub wiki, or generated documentation site.
 *
 * Metadata is rendered as a collapsible JSON code block via `<details>`,
 * which GitHub-flavored Markdown supports inline.
 */
export const renderRoutesAsMarkdown = (routes: AnyRouteMetaData[], options: MarkdownRenderOptions = {}): string => {
  const title = options.title ?? 'Routes';
  const lines: string[] = [];

  lines.push(`# ${title}`, '');
  lines.push(`${routes.length} route${routes.length === 1 ? '' : 's'}.`, '');

  if (routes.length === 0) return lines.join('\n');

  lines.push('| Method | Path | Path Params | Metadata |');
  lines.push('| --- | --- | --- | --- |');

  for (const route of routes) {
    const method = `\`${route.method.toUpperCase()}\``;
    const path = `\`${escapePipe(pathToString(route.path))}\``;
    const params = route.pathParams.length
      ? route.pathParams.map((p) => `\`${escapePipe(String(p.name))}${p.required ? '' : '?'}\``).join(', ')
      : '—';
    const meta = metadataToString(route);
    const metaCell = meta ? metaToCollapsible(meta) : '—';

    lines.push(`| ${method} | ${path} | ${params} | ${metaCell} |`);
  }

  return lines.join('\n');
};
