import { describe, it, expect } from 'vitest';
import { renderRoutesAsHtml } from '../renderers/html';
import { renderRoutesAsMarkdown } from '../renderers/markdown';
import { renderRoutesAsJson } from '../renderers/json';
import { pathToString, metadataToString } from '../renderers/serialize';
import type { AnyRouteMetaData } from '../renderers/serialize';
import type { ExpressRegex } from '../types';

// Helpers to build fixture routes
const route = (
  method: string,
  path: string | string[] | ExpressRegex,
  metadata?: unknown,
): AnyRouteMetaData => ({
  method,
  path,
  pathParams: [],
  ...(metadata !== undefined ? { metadata } : {}),
});

const routeWithParams = (
  method: string,
  path: string,
  params: { name: string; required: boolean }[],
): AnyRouteMetaData => ({
  method,
  path,
  pathParams: params.map((p) => ({ ...p, in: 'path' })),
});

describe('serialize helpers', () => {
  describe('pathToString', () => {
    it('returns a plain string unchanged', () => {
      expect(pathToString('/users/:id')).toBe('/users/:id');
    });

    it('joins an array of paths with ", "', () => {
      expect(pathToString(['/a', '/b'])).toBe('/a, /b');
    });

    it('converts a RegExp to its string form', () => {
      expect(pathToString(/^\/foo$/ as ExpressRegex)).toBe('/^\\/foo$/');
    });
  });

  describe('metadataToString', () => {
    it('returns undefined when metadata is absent', () => {
      expect(metadataToString({ path: '/', pathParams: [], method: 'get' })).toBeUndefined();
    });

    it('returns undefined when metadata is an empty array', () => {
      expect(metadataToString({ path: '/', pathParams: [], method: 'get', metadata: [] })).toBeUndefined();
    });

    it('returns pretty-printed JSON for an object', () => {
      const result = metadataToString({ path: '/', pathParams: [], method: 'get', metadata: { x: 1 } });
      expect(result).toBe(JSON.stringify({ x: 1 }, null, 2));
    });

    it('returns pretty-printed JSON for a non-empty array', () => {
      const result = metadataToString({ path: '/', pathParams: [], method: 'get', metadata: [{ a: 1 }] });
      expect(result).toBe(JSON.stringify([{ a: 1 }], null, 2));
    });
  });
});

describe('renderRoutesAsHtml', () => {
  it('produces a self-contained HTML document', () => {
    const html = renderRoutesAsHtml([]);
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html');
    expect(html).toContain('<style>');
    expect(html).not.toContain('http://');
  });

  it('uses "Routes" as the default title', () => {
    const html = renderRoutesAsHtml([]);
    expect(html).toContain('<title>Routes</title>');
    expect(html).toContain('<h1>Routes</h1>');
  });

  it('uses a custom title when provided', () => {
    const html = renderRoutesAsHtml([], { title: 'My API' });
    expect(html).toContain('<title>My API</title>');
    expect(html).toContain('<h1>My API</h1>');
  });

  it('handles empty routes array with "0 routes" caption', () => {
    const html = renderRoutesAsHtml([]);
    expect(html).toContain('0 routes');
    expect(html).toContain('<tbody>');
  });

  it('shows "1 route" (singular) for a single route', () => {
    const html = renderRoutesAsHtml([route('get', '/x')]);
    expect(html).toContain('1 route<');
  });

  it('produces one <tr> per route', () => {
    const routes = [route('get', '/a'), route('post', '/b'), route('delete', '/c')];
    const html = renderRoutesAsHtml(routes);
    const trCount = (html.match(/<tr>/g) ?? []).length;
    // 1 header row + 3 body rows
    expect(trCount).toBe(4);
  });

  it('escapes HTML in paths', () => {
    const html = renderRoutesAsHtml([route('get', '/<script>')]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes HTML in metadata', () => {
    const html = renderRoutesAsHtml([route('get', '/x', { x: '</script>' })]);
    expect(html).not.toContain('</script>');
    expect(html).toContain('&lt;/script&gt;');
  });

  it('escapes HTML in the title', () => {
    const html = renderRoutesAsHtml([], { title: '<b>Bold</b>' });
    expect(html).not.toContain('<b>Bold</b>');
    expect(html).toContain('&lt;b&gt;Bold&lt;/b&gt;');
  });

  it('renders path params with required/optional markers', () => {
    const html = renderRoutesAsHtml([routeWithParams('get', '/users/:id', [{ name: 'id', required: true }])]);
    expect(html).toContain('<code>id</code>');
  });

  it('renders optional path params with "?" suffix', () => {
    const html = renderRoutesAsHtml([routeWithParams('get', '/users/:id?', [{ name: 'id', required: false }])]);
    expect(html).toContain('<code>id?</code>');
  });

  it('wraps metadata in <details>', () => {
    const html = renderRoutesAsHtml([route('get', '/x', { op: 'getX' })]);
    expect(html).toContain('<details>');
    expect(html).toContain('<summary>show</summary>');
  });

  it('renders routes with RegExp paths', () => {
    // /^\/foo$/ has no < or > chars; verify it's present as-is in a <code> cell
    const html = renderRoutesAsHtml([route('get', /^\/foo$/ as ExpressRegex)]);
    expect(html).toContain('/^\\/foo$/');
    expect(html).toContain('<code>');
  });

  it('renders multi-metadata (array) routes', () => {
    const r: AnyRouteMetaData = { method: 'get', path: '/x', pathParams: [], metadata: [{ a: 1 }, { b: 2 }] };
    const html = renderRoutesAsHtml([r]);
    expect(html).toContain('<details>');
  });
});

describe('renderRoutesAsMarkdown', () => {
  it('starts with "# Routes" heading by default', () => {
    const md = renderRoutesAsMarkdown([]);
    expect(md).toMatch(/^# Routes\n/);
  });

  it('uses a custom title when provided', () => {
    const md = renderRoutesAsMarkdown([], { title: 'API Reference' });
    expect(md).toMatch(/^# API Reference\n/);
  });

  it('includes route count on its own line', () => {
    const md = renderRoutesAsMarkdown([]);
    expect(md).toContain('0 routes.');
  });

  it('uses singular "route" for a single route', () => {
    const md = renderRoutesAsMarkdown([route('get', '/x')]);
    expect(md).toContain('1 route.');
  });

  it('produces no table for empty routes array', () => {
    const md = renderRoutesAsMarkdown([]);
    expect(md).not.toContain('| Method |');
  });

  it('produces a table header for non-empty routes', () => {
    const md = renderRoutesAsMarkdown([route('get', '/x')]);
    expect(md).toContain('| Method | Path | Path Params | Metadata |');
    expect(md).toContain('| --- | --- | --- | --- |');
  });

  it('renders method as inline code in uppercase', () => {
    const md = renderRoutesAsMarkdown([route('get', '/x')]);
    expect(md).toContain('`GET`');
  });

  it('renders path as inline code', () => {
    const md = renderRoutesAsMarkdown([route('get', '/users/:id')]);
    expect(md).toContain('`/users/:id`');
  });

  it('escapes pipe characters in paths', () => {
    // regex-style path with |
    const md = renderRoutesAsMarkdown([route('get', '/a|/b')]);
    expect(md).toContain('\\|');
  });

  it('renders "—" when there are no path params', () => {
    const md = renderRoutesAsMarkdown([route('get', '/x')]);
    // at least one "—" for params and one for metadata
    expect(md).toContain('—');
  });

  it('renders short single-line metadata as inline code', () => {
    // "true" has no newlines and is short → inline code
    const md = renderRoutesAsMarkdown([route('get', '/x', true)]);
    expect(md).toContain('`true`');
    expect(md).not.toContain('<details>');
  });

  it('wraps long metadata in <details>', () => {
    const longMeta = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9 };
    const md = renderRoutesAsMarkdown([route('get', '/x', longMeta)]);
    expect(md).toContain('<details>');
    expect(md).toContain('<summary>show</summary>');
  });

  it('handles array paths', () => {
    const md = renderRoutesAsMarkdown([route('get', ['/a', '/b'])]);
    expect(md).toContain('`/a, /b`');
  });
});

describe('renderRoutesAsJson', () => {
  it('produces valid JSON', () => {
    const json = renderRoutesAsJson([route('get', '/x')]);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('produces an empty array for no routes', () => {
    expect(JSON.parse(renderRoutesAsJson([]))).toEqual([]);
  });

  it('round-trips a simple route', () => {
    const routes = [route('get', '/users/:id', { op: 'getUser' })];
    const parsed = JSON.parse(renderRoutesAsJson(routes));
    expect(parsed[0].method).toBe('get');
    expect(parsed[0].path).toBe('/users/:id');
    expect(parsed[0].metadata).toEqual({ op: 'getUser' });
  });

  it('converts RegExp paths to their string form', () => {
    const json = renderRoutesAsJson([route('get', /^\/foo$/ as ExpressRegex)]);
    const parsed = JSON.parse(json);
    expect(typeof parsed[0].path).toBe('string');
    expect(parsed[0].path).toBe('/^\\/foo$/');
  });

  it('produces single-line output with indent: 0', () => {
    const json = renderRoutesAsJson([route('get', '/x')], { indent: 0 });
    expect(json).not.toContain('\n');
  });

  it('uses custom indent when specified', () => {
    const json = renderRoutesAsJson([route('get', '/x', { a: 1 })], { indent: 4 });
    // 4-space indent produces lines starting with 4 spaces
    expect(json).toMatch(/^ {4}/m);
  });

  it('handles multi-metadata array routes', () => {
    const r: AnyRouteMetaData = { method: 'get', path: '/x', pathParams: [], metadata: [{ a: 1 }, { b: 2 }] };
    const parsed = JSON.parse(renderRoutesAsJson([r]));
    expect(parsed[0].metadata).toEqual([{ a: 1 }, { b: 2 }]);
  });

  // Gap (MEDIUM): array-form path round-trip. Source: design Unit B4 AC,
  // "round-trips: parsed routes serialized then JSON-parsed equals the input".
  // Array paths (RouteMetaData['path']: string[]) come from app.get(['/a','/b']).
  it('preserves array-form path through JSON', () => {
    const r: AnyRouteMetaData = {
      method: 'get',
      path: ['/foo', '/bar'],
      pathParams: [],
    };
    const json = renderRoutesAsJson([r]);
    const parsed = JSON.parse(json);
    expect(parsed[0].path).toEqual(['/foo', '/bar']);
  });
});

// ---------------------------------------------------------------------------
// Gap (MEDIUM): newline handling in Markdown cells. Source: design Unit B3
// implementation note ("`escapePipe` ... Newlines are converted to `<br>`
// since GFM tables don't allow literal newlines in cells").
// ---------------------------------------------------------------------------

describe('renderRoutesAsMarkdown — newline handling', () => {
  it('escapes newlines in path cells to <br>', () => {
    const r: AnyRouteMetaData = {
      method: 'get',
      // Pathologically build a path with a newline. Real-world routes don't
      // contain newlines, but the rendered output should remain a valid
      // single-line table cell either way.
      path: '/foo\n/bar',
      pathParams: [],
    };
    const md = renderRoutesAsMarkdown([r]);
    // The cell should contain <br> in place of the literal newline.
    // The literal newline must NOT appear inside the table row (each row is
    // a single line).
    const tableLine = md.split('\n').find((line) => line.includes('/foo'));
    expect(tableLine).toBeDefined();
    expect(tableLine).toContain('<br>');
    expect(tableLine).toContain('/bar');
  });
});

// ---------------------------------------------------------------------------
// Re-export coverage check (renderers/serialize) — exercised by other tests
// already, but call out directly so a regression is obvious.
// ---------------------------------------------------------------------------

describe('renderers/serialize public surface', () => {
  it('pathToString and metadataToString are exported and exercised', () => {
    // Already exercised by all three renderers; this asserts the imports
    // work as a smoke check (the import at the top of this file would fail
    // type-check otherwise).
    expect(typeof pathToString).toBe('function');
    expect(typeof metadataToString).toBe('function');
  });
});
