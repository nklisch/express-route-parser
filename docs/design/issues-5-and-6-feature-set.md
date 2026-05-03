# Design: Issue #5 + #6 Feature Set

## Overview

This design covers both remaining open GitHub issues, shippable together as a
**single minor release** (proposed `1.2.0`, after `1.1.0` ships the devtools
modernization).

- **Issue #6** (Part A): opt-in support for multiple `metadata` middlewares per
  route, plus a typed `withMetadata(meta)` helper that eliminates the README's
  `const m: any = ...` cast.
- **Issue #5** (Part B): three pure-function renderers that turn a parsed route
  list into HTML, Markdown, or pretty-printed JSON.

Both parts are **additive and non-breaking**. Existing consumers see no
behavior change. The opt-in flag preserves the current "throws on multiple
metadata" behavior by default.

## Decisions Locked from User Q&A

These were resolved before drafting; do not relitigate during implementation.

| Question | Decision |
| --- | --- |
| Render scope (issue #5) | Three concrete renderers: HTML, Markdown, JSON. No plugin architecture. |
| Render API shape | Pure functions only. Each takes `RouteMetaData[]`, returns `string`. No file writers, no Express middleware. |
| Multiple-metadata semantics (issue #6) | Opt-in via `parseExpressApp(app, { multipleMetadata: true })`. Returns `metadata: any[]` when true. Default behavior unchanged (throws on multiple). |
| Type/helper shape (issue #6) | Handler-side wrapper `withMetadata<M>(meta) → MetadataHandler<M>`. No router-side helper, no opaque type alias. |

## Out of Scope (Deferred)

- **Router-side metadata helper** (`createMetadataRouter`) — not in this design;
  the user explicitly chose handler-side only. Could become a follow-up issue
  if router-level tagging is wanted later.
- **Renderer file writers / live middleware** — pure functions only. Caller
  decides what to do with the string.
- **Renderer customization beyond minimal `RenderOptions`** — no theming, no
  custom templates, no grouping. Keep the surface tight; revisit if requested.
- **Deep-merging multiple metadata into one object** — explicitly rejected by
  issue author. Array form only when opted in.
- **`metadata?: any[]` as the universal type** — would be a breaking change.
  We're keeping `metadata?: any` (single mode) and adding `RouteMetaDataMulti`
  with `metadata: any[]` (multi mode).

---

## Part A — Issue #6: Multiple Metadata + `withMetadata` Helper

### Unit A1: Add `ParseOptions`, `RouteMetaDataMulti`, `MetadataHandler` types

**File**: `src/types/index.ts` (extend existing)

Add to the existing types file:

```typescript
import type { RequestHandler } from 'express';

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
```

**Implementation Notes**:

- All three are net-new exports. The existing `RouteMetaData`, `Parameter`,
  `ExpressRegex`, `Key`, `Layer`, `Route` interfaces are unchanged.
- `RouteMetaDataMulti` does **not** extend `RouteMetaData` because the
  `metadata` field has a different type signature (`any[]` vs. `any`).
  Re-declaring is clearer than `Omit<RouteMetaData, 'metadata'> & { metadata: any[] }`.
- `MetadataHandler<M>` defaults to `unknown` rather than `any` — slightly
  safer default; users can specialize with their actual metadata shape.
- `RequestHandler` import goes at the **top** of `src/types/index.ts`,
  alongside the existing express-serve-static-core import.

**Acceptance Criteria**:

- [ ] `ParseOptions`, `RouteMetaDataMulti`, `MetadataHandler` are exported from `src/types/index.ts`.
- [ ] `import { ParseOptions, RouteMetaDataMulti, MetadataHandler } from 'express-route-parser'` resolves (via the barrel re-export in `src/index.ts`).
- [ ] Type tests in `src/__tests__/types.test-d.ts` pin the new exports' shapes.

---

### Unit A2: Add `withMetadata` helper

**File**: `src/with-metadata.ts` (new)

```typescript
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
 *   project-wide convention, define a type alias and pass it explicitly:
 *   `withMetadata<MyMetadata>({ ... })`.
 */
export function withMetadata<M>(metadata: M): MetadataHandler<M> {
  const handler = (_req: Request, _res: Response, next: NextFunction): void => {
    next();
  };
  (handler as MetadataHandler<M>).metadata = metadata;
  return handler as MetadataHandler<M>;
}
```

**Implementation Notes**:

- Single-arg API: takes only the metadata. Returns a no-op middleware that
  calls `next()`. Caller chains it before the real handler:
  `app.get('/x', withMetadata({...}), realHandler)`.
- Why no `withMetadata(meta, handler)` two-arg form? The chained-middleware
  pattern is already idiomatic Express and matches the existing README. A
  two-arg form would be a second way to do the same thing; pick one.
- The cast inside is unavoidable because Express's `RequestHandler` is a plain
  function type without arbitrary properties — we have to attach `metadata` as
  a side property and assert the result is `RequestHandler & { metadata: M }`.
  Hide that cast inside this helper so user code stays clean.
- Underscore-prefix unused params (`_req`, `_res`) to signal intent and avoid
  an `@typescript-eslint/no-unused-vars` lint error.

**Acceptance Criteria**:

- [ ] `withMetadata({ foo: 1 })` returns a function that calls `next()` when invoked.
- [ ] The returned function has `.metadata` deeply equal to the input.
- [ ] `withMetadata<MySchema>({ ... })` rejects an input that doesn't match `MySchema` at compile time.
- [ ] Used in a route, the parser surfaces the metadata on the corresponding `RouteMetaData` entry (round-trip test).

---

### Unit A3: Modify `parseExpressApp` for opt-in multiple metadata

**File**: `src/express-parser/index.ts` (extend existing)

```typescript
import { Express, Router } from 'express';
import {
  RouteMetaData,
  RouteMetaDataMulti,
  ParseOptions,
  ExpressRegex,
  Key,
  Layer,
  Parameter,
  Route,
} from '../types';

/**
 * Parses an Express app and generates a list of routes with metadata.
 *
 * @param app The Express app reference. Must be used after all routes have been attached.
 * @param options Optional parse options. Pass `{ multipleMetadata: true }` to allow
 *   multiple metadata-bearing middlewares per route (returned as `metadata: any[]`).
 *   By default the parser throws if it encounters more than one metadata middleware
 *   on a route, matching v1.x behavior.
 * @returns List of routes with metadata, in declaration order.
 */
export function parseExpressApp(
  app: Express,
  options?: { multipleMetadata?: false },
): RouteMetaData[];
export function parseExpressApp(
  app: Express,
  options: { multipleMetadata: true },
): RouteMetaDataMulti[];
export function parseExpressApp(
  app: Express,
  options: ParseOptions = {},
): RouteMetaData[] | RouteMetaDataMulti[] {
  const parser = new ExpressPathParser(app, options);
  return parser.appPaths;
}

class ExpressPathParser {
  private readonly _appPaths: Array<RouteMetaData | RouteMetaDataMulti>;
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

  // traverse() unchanged from current impl

  private parseRouteLayer = (
    layer: Layer,
    keys: Key[],
    basePath: string,
  ): Array<RouteMetaData | RouteMetaDataMulti> => {
    const pathParams: Parameter[] = keys.map((key) => ({
      name: key.name,
      in: 'path',
      required: !key.optional,
    }));
    const path = (basePath + layer.route.path).replace(/\/{2,}/gi, '/');

    const methodGroups = new Map<string, Layer[]>();
    for (const entry of layer.route.stack) {
      if (!entry.method) continue;
      const group = methodGroups.get(entry.method);
      if (group) group.push(entry);
      else methodGroups.set(entry.method, [entry]);
    }

    const results: Array<RouteMetaData | RouteMetaDataMulti> = [];
    for (const [method, entries] of methodGroups) {
      const metaEntries = entries.filter(
        (element) => (element?.handle as Route)?.metadata,
      );

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
```

**Implementation Notes**:

- The `parseExpressApp` arrow-function form is replaced by a `function`
  declaration with three signatures (two overloads + the implementation
  signature). TypeScript doesn't support overloads on arrow functions.
  This is the only structural change to the public API surface.
- The third overload signature (`options: ParseOptions = {}` returning the
  union) is the implementation; it isn't visible to consumers, who see only
  the two narrower public overloads. This is the standard TS overload pattern.
- The first public overload uses `options?: { multipleMetadata?: false }`
  rather than just `options?: undefined` — this makes
  `parseExpressApp(app, {})` and `parseExpressApp(app, { multipleMetadata: false })`
  resolve to the single-metadata return type cleanly.
- The single-mode error message now mentions the opt-in. UX nudge for users
  who hit the throw — they immediately know the workaround.
- Internally `_appPaths` holds a union; the cast in `appPaths` is the
  boundary where we trust that the mode flag is consistent. Pragmatic, not
  unsafe — the parser populates one shape per instance.
- The `traverse` method needs **no changes**. Only `parseRouteLayer` branches.

**Acceptance Criteria**:

- [ ] `parseExpressApp(app)` returns `RouteMetaData[]` (existing behavior, throws on multiple metadata).
- [ ] `parseExpressApp(app, { multipleMetadata: true })` returns `RouteMetaDataMulti[]` and does not throw.
- [ ] In multi mode, a route with 0 metadata middlewares has `metadata: []`.
- [ ] In multi mode, a route with 2 metadata middlewares has `metadata: [first, second]` in declaration order.
- [ ] The error message in single mode contains "multipleMetadata: true" so users can find the opt-in.
- [ ] All 30+ existing parser tests continue to pass without modification (overloads preserve the default-arg signature).

---

### Unit A4: Re-export new public surface from `src/index.ts`

**File**: `src/index.ts`

Current content:

```typescript
export { parseExpressApp } from './express-parser';
export * from './types';
```

New content:

```typescript
export { parseExpressApp } from './express-parser';
export { withMetadata } from './with-metadata';
export * from './types';
// (renderer exports added in Part B Unit B5)
```

**Acceptance Criteria**:

- [ ] `import { withMetadata } from 'express-route-parser'` resolves.
- [ ] `import { parseExpressApp, ParseOptions, RouteMetaDataMulti, MetadataHandler } from 'express-route-parser'` resolves.
- [ ] No regression in existing imports.

---

## Part B — Issue #5: HTML/Markdown/JSON Renderers

### Unit B1: Shared serialization helper

**File**: `src/renderers/serialize.ts` (new)

```typescript
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
export function pathToString(path: string | string[] | ExpressRegex): string {
  if (typeof path === 'string') return path;
  if (Array.isArray(path)) return path.join(', ');
  return path.toString();
}

/**
 * Stringify metadata for non-JSON renderers. Returns `undefined` if no
 * metadata is present (single-mode) or the array is empty (multi-mode).
 */
export function metadataToString(route: AnyRouteMetaData): string | undefined {
  const meta = (route as RouteMetaData).metadata;
  if (Array.isArray(meta)) {
    if (meta.length === 0) return undefined;
    return JSON.stringify(meta, null, 2);
  }
  if (meta === undefined) return undefined;
  return JSON.stringify(meta, null, 2);
}
```

**Implementation Notes**:

- Single source of truth for "how do we render a route's path/metadata as a
  string". Used by HTML and Markdown renderers; JSON has its own path because
  it serializes the whole object.
- `AnyRouteMetaData` is the input type for all three renderers — they accept
  output from either single-mode or multi-mode parses.
- `pathToString` handles all three `path` shapes the parser can produce.
- `metadataToString` returns `undefined` (not empty string) so renderers can
  conditionally skip the metadata column/section.

**Acceptance Criteria**:

- [ ] `pathToString('/users/:id')` returns `'/users/:id'`.
- [ ] `pathToString(['/a', '/b'])` returns `'/a, /b'`.
- [ ] `pathToString(/^\/foo$/)` returns `'/^\\/foo$/'`.
- [ ] `metadataToString({ metadata: undefined })` returns `undefined`.
- [ ] `metadataToString({ metadata: [] })` returns `undefined`.
- [ ] `metadataToString({ metadata: { x: 1 } })` returns pretty-printed JSON.

---

### Unit B2: HTML renderer

**File**: `src/renderers/html.ts` (new)

```typescript
import { AnyRouteMetaData, pathToString, metadataToString } from './serialize';

export interface HtmlRenderOptions {
  /**
   * Document title and `<h1>` heading.
   * @default "Routes"
   */
  title?: string;
}

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
export function renderRoutesAsHtml(
  routes: AnyRouteMetaData[],
  options: HtmlRenderOptions = {},
): string {
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
}

function routeRow(route: AnyRouteMetaData): string {
  const method = route.method.toUpperCase();
  const methodClass = `method method-${route.method.toLowerCase()}`;
  const path = escapeHtml(pathToString(route.path));
  const params = route.pathParams.length
    ? route.pathParams
        .map((p) => `<code>${escapeHtml(p.name)}${p.required ? '' : '?'}</code>`)
        .join(' ')
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
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
```

**Implementation Notes**:

- **Self-contained**: all CSS inlined, no external CDN. The output file works
  offline and at `file://` URLs without network.
- **No HTML-escape gaps**: the `escapeHtml` helper is applied to *every* user-
  derived string (paths, param names, metadata JSON, title). Inline styles
  and method names are static, no escape needed.
- **Method colors** follow the common API-doc convention (green/blue/orange/
  purple/red). Unknown methods get gray. No external icon font.
- **Metadata is collapsed** behind `<details>` so long JSON doesn't dominate
  the table. Default-closed; user clicks "show".
- **No JS at all** in the output. `<details>` is HTML-native.
- **`route.method.toLowerCase()` for the CSS class** — guards against e.g.
  `'GET'` vs `'get'` casing differences (the parser produces lowercase, but
  the renderer shouldn't assume).

**Acceptance Criteria**:

- [ ] Output starts with `<!DOCTYPE html>` and contains a single `<html>` element.
- [ ] Each route in the input produces exactly one `<tr>` in `<tbody>`.
- [ ] User-provided strings (paths, param names, metadata) are HTML-escaped — verified by passing `<script>` in a path or metadata field and confirming no raw `<script>` appears in output.
- [ ] An empty `routes` array produces a valid HTML document with an empty `<tbody>` and "0 routes" caption.
- [ ] Output is parseable by a strict HTML validator (verified manually or via `jsdom`).

---

### Unit B3: Markdown renderer

**File**: `src/renderers/markdown.ts` (new)

```typescript
import { AnyRouteMetaData, pathToString, metadataToString } from './serialize';

export interface MarkdownRenderOptions {
  /**
   * Top-level heading.
   * @default "Routes"
   */
  title?: string;
}

/**
 * Renders a parsed route list as a Markdown table. Suitable for embedding
 * in a README, GitHub wiki, or generated documentation site.
 *
 * Metadata is rendered as a collapsible JSON code block via `<details>`,
 * which GitHub-flavored Markdown supports inline.
 */
export function renderRoutesAsMarkdown(
  routes: AnyRouteMetaData[],
  options: MarkdownRenderOptions = {},
): string {
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
      ? route.pathParams
          .map((p) => `\`${escapePipe(p.name)}${p.required ? '' : '?'}\``)
          .join(', ')
      : '—';
    const meta = metadataToString(route);
    const metaCell = meta ? metaToCollapsible(meta) : '—';

    lines.push(`| ${method} | ${path} | ${params} | ${metaCell} |`);
  }

  return lines.join('\n');
}

/**
 * Escape pipe characters so they don't break the markdown table column
 * separator. Newlines are converted to `<br>` since GFM tables don't allow
 * literal newlines in cells.
 */
function escapePipe(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

/**
 * Wrap multi-line metadata JSON in a `<details>` element so it doesn't
 * dominate the table. Single-line short metadata is rendered as inline code.
 */
function metaToCollapsible(meta: string): string {
  if (!meta.includes('\n') && meta.length < 60) {
    return `\`${escapePipe(meta)}\``;
  }
  // GFM accepts <details> in tables; markdown inside it must be HTML-style.
  // Use a <pre> block since fenced code blocks can't be nested in table cells.
  const escaped = meta.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<details><summary>show</summary><pre>${escaped}</pre></details>`;
}
```

**Implementation Notes**:

- **Table format only** (not section-per-route). Compact, embeds well in
  existing docs. Section format could be added later as an option.
- **`<details>` in tables is GitHub-flavored Markdown specific**, but it
  degrades gracefully on plain Markdown renderers (shows the raw HTML, still
  readable).
- **Pipe-escape every cell**: paths can contain `|` in regex form; param
  names can't, but escaping uniformly is cheaper than auditing per-field.
- **Newline-to-`<br>`**: GFM tables don't allow literal newlines in cells;
  multi-line metadata gets the `<details>` treatment instead, but path
  arrays joined with `, ` shouldn't have newlines.
- **Short single-line metadata** stays inline as `code` for compactness.
  Threshold of 60 chars is heuristic; tune if it looks bad.

**Acceptance Criteria**:

- [ ] Output starts with `# <title>` followed by a blank line and a count line.
- [ ] Empty routes array produces just the heading + count line ("0 routes."), no table.
- [ ] Pipe characters in paths or param names are escaped (`\\|`).
- [ ] Short single-line metadata renders as inline code; multi-line or long metadata gets a `<details>` block.
- [ ] Output renders correctly when pasted into a GitHub PR/issue (manual check).

---

### Unit B4: JSON renderer

**File**: `src/renderers/json.ts` (new)

```typescript
import type { AnyRouteMetaData } from './serialize';

export interface JsonRenderOptions {
  /**
   * Number of spaces per indent level.
   * @default 2
   */
  indent?: number;
}

/**
 * Renders a parsed route list as pretty-printed JSON.
 *
 * Handles the special case of `RouteMetaData['path']` being a `RegExp`
 * (which would otherwise serialize as `{}`) by converting it to its string
 * form via `RegExp.prototype.toString()`.
 */
export function renderRoutesAsJson(
  routes: AnyRouteMetaData[],
  options: JsonRenderOptions = {},
): string {
  const indent = options.indent ?? 2;
  return JSON.stringify(routes, regexReplacer, indent);
}

/**
 * JSON.stringify replacer that converts RegExp values to their `.toString()`
 * form. Other values pass through unchanged.
 */
function regexReplacer(_key: string, value: unknown): unknown {
  if (value instanceof RegExp) {
    return value.toString();
  }
  return value;
}
```

**Implementation Notes**:

- The only non-trivial bit is the regex handling. Without the replacer,
  `JSON.stringify(/foo/)` returns `'{}'`, which is useless. The replacer
  converts to `'/foo/'`, which round-trips with `new RegExp(...)` if needed.
- `indent` option in case someone wants tighter (`0`) or wider (`4`) output;
  default `2` matches conventional pretty-print.
- No HTML escaping; this is JSON, not HTML.

**Acceptance Criteria**:

- [ ] Output is valid JSON (parses with `JSON.parse`).
- [ ] An array of routes round-trips: parsed routes serialized then JSON-parsed equals the input (modulo regex paths becoming strings).
- [ ] A route with a `RegExp` path serializes its string form (e.g. `'/^\\/foo$/'`), not `{}`.
- [ ] `indent: 0` produces single-line output.

---

### Unit B5: Renderer barrel + top-level re-export

**Files**: `src/renderers/index.ts` (new) + `src/index.ts` (extend)

```typescript
// src/renderers/index.ts
export { renderRoutesAsHtml } from './html';
export type { HtmlRenderOptions } from './html';
export { renderRoutesAsMarkdown } from './markdown';
export type { MarkdownRenderOptions } from './markdown';
export { renderRoutesAsJson } from './json';
export type { JsonRenderOptions } from './json';
```

```typescript
// src/index.ts (final shape after Parts A and B)
export { parseExpressApp } from './express-parser';
export { withMetadata } from './with-metadata';
export * from './types';
export * from './renderers';
```

**Acceptance Criteria**:

- [ ] `import { renderRoutesAsHtml, renderRoutesAsMarkdown, renderRoutesAsJson } from 'express-route-parser'` resolves.
- [ ] `import type { HtmlRenderOptions, MarkdownRenderOptions, JsonRenderOptions } from 'express-route-parser'` resolves.

---

### Unit B6: README addition (renderer usage)

**File**: `README.md` (extend, near the "Output" section)

Add a new section after the existing "Output" example:

```markdown
## Rendering routes

Parsed routes can be rendered to HTML, Markdown, or pretty-printed JSON
without any additional dependencies:

\`\`\`typescript
import {
  parseExpressApp,
  renderRoutesAsHtml,
  renderRoutesAsMarkdown,
  renderRoutesAsJson,
} from 'express-route-parser';

const routes = parseExpressApp(app);

const html = renderRoutesAsHtml(routes, { title: 'My API' });
const md = renderRoutesAsMarkdown(routes);
const json = renderRoutesAsJson(routes);
\`\`\`

Each renderer accepts a `RouteMetaData[]` (single-metadata mode) or
`RouteMetaDataMulti[]` (multi-metadata mode — see below).

## Multiple metadata middlewares per route

By default, the parser throws if a route has more than one metadata-bearing
middleware. To allow multiple, pass `multipleMetadata: true`:

\`\`\`typescript
const routes = parseExpressApp(app, { multipleMetadata: true });
// → metadata is now `any[]` (possibly empty) on each route
\`\`\`

The `withMetadata()` helper provides a typed alternative to the
inline `const m: any = ...` pattern shown earlier:

\`\`\`typescript
import { withMetadata } from 'express-route-parser';

app.get(
  '/users/:id',
  withMetadata({ operationId: 'getUser', tags: ['users'] }),
  realHandler,
);
\`\`\`
```

**Acceptance Criteria**:

- [ ] README has a "Rendering routes" section with a working code example.
- [ ] README has a "Multiple metadata middlewares per route" section explaining the opt-in.
- [ ] README's existing examples remain intact and accurate.

---

## Implementation Order

Strict dependency order:

1. **Unit A1** — Add `ParseOptions`, `RouteMetaDataMulti`, `MetadataHandler` to `src/types/index.ts`. No other unit compiles without these.
2. **Unit A2** — `withMetadata` helper. Depends only on A1.
3. **Unit A3** — `parseExpressApp` overloads + multi-metadata branch. Depends on A1.
4. **Unit A4** — Re-export `withMetadata` from `src/index.ts`.
5. **Unit B1** — Shared serialization helpers. Independent of Part A but renderers depend on it.
6. **Unit B2** — HTML renderer. Depends on B1.
7. **Unit B3** — Markdown renderer. Depends on B1.
8. **Unit B4** — JSON renderer. Depends on B1.
9. **Unit B5** — Renderer barrel + final `src/index.ts` exports.
10. **Tests** (interleaved with units; see Testing section).
11. **Unit B6** — README update. Last, so the docs can reference the final API surface.
12. **CHANGELOG additions** — Under `[Unreleased]`. The release script (`./scripts/release.sh minor`) moves them under `[1.2.0]` at release time.

Parts A and B can be implemented in parallel by independent agents if desired
(no shared files except `src/index.ts` and `CHANGELOG.md`). For a single-agent
implementation, the order above is the safest sequential path.

## Testing

### Test files

| Test file | Covers | Style |
| --- | --- | --- |
| `src/__tests__/parser.test.ts` (extend) | Multi-metadata opt-in: returns array form, no throw, empty-array case, error message | Existing Vitest globals; Express app fixtures |
| `src/__tests__/with-metadata.test.ts` (new) | `withMetadata` returns valid middleware, attaches metadata, type tests | Vitest |
| `src/__tests__/renderers.test.ts` (new) | All three renderers: empty input, basic input, special chars in paths, regex paths, all metadata states | Vitest; snapshot for stable output regions, structural assertions for variable bits |
| `src/__tests__/types.test-d.ts` (extend) | `expectTypeOf` for `parseExpressApp` overloads, `withMetadata`, `MetadataHandler`, `ParseOptions`, `RouteMetaDataMulti`, renderer signatures | Vitest's `expectTypeOf` |

### Key test cases

**Multi-metadata mode (extend `parser.test.ts`):**

```typescript
it('returns array-form metadata when opted in', () => {
  app.get('/x', withMetadata({ a: 1 }), withMetadata({ b: 2 }), successResponse);
  const parsed = parseExpressApp(app, { multipleMetadata: true });
  expect(parsed[0].metadata).toEqual([{ a: 1 }, { b: 2 }]);
});

it('returns empty array for routes with no metadata in multi mode', () => {
  app.get('/x', successResponse);
  const parsed = parseExpressApp(app, { multipleMetadata: true });
  expect(parsed[0].metadata).toEqual([]);
});

it('throws by default on multiple metadata, with helpful message', () => {
  app.get('/x', withMetadata({ a: 1 }), withMetadata({ b: 2 }), successResponse);
  expect(() => parseExpressApp(app)).toThrow(/multipleMetadata: true/);
});
```

**`withMetadata` helper:**

```typescript
it('attaches metadata to the returned handler', () => {
  const h = withMetadata({ tag: 'users' });
  expect(h.metadata).toEqual({ tag: 'users' });
});

it('returns a function that calls next() with no error', () => {
  const h = withMetadata({});
  const next = vi.fn();
  h({} as Request, {} as Response, next);
  expect(next).toHaveBeenCalledOnce();
  expect(next).toHaveBeenCalledWith(); // no error arg
});

it('round-trips through the parser', () => {
  app.get('/x', withMetadata({ op: 'x' }), successResponse);
  const parsed = parseExpressApp(app);
  expect(parsed[0].metadata).toEqual({ op: 'x' });
});
```

**Renderer tests:**

```typescript
describe('renderRoutesAsHtml', () => {
  it('produces a self-contained HTML document', () => {
    const html = renderRoutesAsHtml([]);
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html');
    expect(html).toContain('<style>'); // inline CSS
    expect(html).not.toContain('http://'); // no external resources
  });

  it('escapes HTML in paths and metadata', () => {
    const routes = [{
      path: '/<script>',
      pathParams: [],
      method: 'get',
      metadata: { x: '</script>' },
    }];
    const html = renderRoutesAsHtml(routes);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('handles empty routes array', () => {
    const html = renderRoutesAsHtml([]);
    expect(html).toContain('0 routes');
  });
});

// Similar shape for Markdown and JSON.
```

**Type tests (extend `types.test-d.ts`):**

```typescript
it('parseExpressApp overload selects RouteMetaData[] without options', () => {
  expectTypeOf(parseExpressApp).parameter(0).toEqualTypeOf<Express>();
  // No options: returns RouteMetaData[]
  const r1 = parseExpressApp({} as Express);
  expectTypeOf(r1).toEqualTypeOf<RouteMetaData[]>();
});

it('parseExpressApp overload selects RouteMetaDataMulti[] with multipleMetadata: true', () => {
  const r2 = parseExpressApp({} as Express, { multipleMetadata: true });
  expectTypeOf(r2).toEqualTypeOf<RouteMetaDataMulti[]>();
});

it('withMetadata returns MetadataHandler with the attached metadata type', () => {
  const h = withMetadata<{ op: string }>({ op: 'x' });
  expectTypeOf(h.metadata).toEqualTypeOf<{ op: string }>();
});
```

## Verification Checklist

```bash
# All units land
test -f src/with-metadata.ts
test -f src/renderers/serialize.ts
test -f src/renderers/html.ts
test -f src/renderers/markdown.ts
test -f src/renderers/json.ts
test -f src/renderers/index.ts

# New exports resolve
node -e "const lib = require('./lib'); for (const fn of ['parseExpressApp','withMetadata','renderRoutesAsHtml','renderRoutesAsMarkdown','renderRoutesAsJson']) if (typeof lib[fn] !== 'function') { console.error('missing export:', fn); process.exit(1); }"

# Existing tests still green
npm test

# Build clean (TS 6, after Modernization PR has merged)
npm run build

# Lint clean
npm run lint

# Lib/ contains the new modules in their expected layout
test -f lib/with-metadata.js
test -f lib/with-metadata.d.ts
test -d lib/renderers
test -f lib/renderers/html.d.ts
```

## Hardening Options (Not Implemented Now)

- **Section-format Markdown** — opt-in alternative to the table format for
  large APIs where each route gets its own subsection.
- **Custom HTML template** — `renderRoutesAsHtml(routes, { template: fn })`
  for users who want full control of the layout. Probably overkill; revisit
  if asked.
- **Group-by support** — `renderRoutesAsHtml(routes, { groupBy: 'method' })`
  for grouping by base path or HTTP method. Tail-end nice-to-have.
- **Live Express middleware** — `app.use('/_routes', routeExplorer({ app }))`
  that re-parses and renders on each request. User explicitly chose pure
  functions only; if requested later, it's a thin wrapper around the existing
  renderers.
- **Router-side `createMetadataRouter` helper** — for tagging entire sub-
  routers (e.g., 'users namespace'). Out of scope per the user's choice; can
  be added in a future minor without breaking anything.
- **Snapshot tests for renderer output** — the design specifies behavioral
  assertions; a snapshot pass would catch incidental output drift.
- **OpenAPI 3 renderer** — natural fit if the codebase grows; currently out
  of scope.

## References

- Issue #6 thread: https://github.com/nklisch/express-route-parser/issues/6
- Issue #5 thread: https://github.com/nklisch/express-route-parser/issues/5
- Existing parser pattern (post-issue #7 fix): `src/express-parser/index.ts`
- Existing type tests pattern: `src/__tests__/types.test-d.ts`
- Vitest `expectTypeOf` docs: https://vitest.dev/api/expect-typeof.html
