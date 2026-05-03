import { describe, expectTypeOf, it } from 'vitest';
import type {
  ExpressRegex,
  Key,
  Layer,
  Parameter,
  Route,
  RouteMetaData,
  RouteMetaDataMulti,
  ParseOptions,
  MetadataHandler,
  HtmlRenderOptions,
  MarkdownRenderOptions,
  JsonRenderOptions,
} from '../index';
import { parseExpressApp, withMetadata } from '../index';
import type { Express } from 'express';
import type { renderRoutesAsHtml, renderRoutesAsMarkdown, renderRoutesAsJson } from '../index';

describe('public API type contract', () => {
  it('parseExpressApp accepts an Express app and returns RouteMetaData[]', () => {
    expectTypeOf(parseExpressApp).parameter(0).toEqualTypeOf<Express>();
    expectTypeOf(parseExpressApp).returns.toEqualTypeOf<RouteMetaData[]>();
  });

  it('RouteMetaData has the documented shape', () => {
    expectTypeOf<RouteMetaData>().toMatchObjectType<{
      path: string | string[] | ExpressRegex;
      pathParams: Parameter[];
      method: string;
      metadata?: any;
    }>();
  });

  it('Parameter has the documented shape', () => {
    expectTypeOf<Parameter>().toMatchObjectType<{
      in: string;
      name: string;
      required: boolean;
    }>();
    // Verify the index signature — arbitrary string keys resolve to any
    type ArbitraryKey = Parameter['someArbitraryKey'];
    expectTypeOf<ArbitraryKey>().toEqualTypeOf<any>();
  });

  it('Key has the documented shape', () => {
    expectTypeOf<Key>().toEqualTypeOf<{
      name: string;
      optional: boolean;
      offset: number;
    }>();
  });

  it('ExpressRegex extends RegExp with fast-path flags', () => {
    expectTypeOf<ExpressRegex>().toExtend<RegExp>();
    expectTypeOf<ExpressRegex['fast_slash']>().toEqualTypeOf<boolean>();
    expectTypeOf<ExpressRegex['fast_star']>().toEqualTypeOf<boolean>();
  });

  it('Route and Layer are exported (smoke check)', () => {
    expectTypeOf<Route>().not.toBeNever();
    expectTypeOf<Layer>().not.toBeNever();
  });
});

describe('issue #6 type contract', () => {
  it('parseExpressApp without options returns RouteMetaData[]', () => {
    const r = parseExpressApp({} as Express);
    expectTypeOf(r).toEqualTypeOf<RouteMetaData[]>();
  });

  it('parseExpressApp with multipleMetadata: true returns RouteMetaDataMulti[]', () => {
    const r = parseExpressApp({} as Express, { multipleMetadata: true });
    expectTypeOf(r).toEqualTypeOf<RouteMetaDataMulti[]>();
  });

  it('parseExpressApp with multipleMetadata: false returns RouteMetaData[]', () => {
    const r = parseExpressApp({} as Express, { multipleMetadata: false });
    expectTypeOf(r).toEqualTypeOf<RouteMetaData[]>();
  });

  it('parseExpressApp with empty options object returns RouteMetaData[]', () => {
    const r = parseExpressApp({} as Express, {});
    expectTypeOf(r).toEqualTypeOf<RouteMetaData[]>();
  });

  it('RouteMetaDataMulti has the documented shape', () => {
    expectTypeOf<RouteMetaDataMulti>().toMatchObjectType<{
      path: string | string[] | ExpressRegex;
      pathParams: Parameter[];
      method: string;
      metadata: any[];
    }>();
  });

  it('ParseOptions has the documented shape', () => {
    expectTypeOf<ParseOptions>().toMatchObjectType<{
      multipleMetadata?: boolean;
    }>();
  });

  it('withMetadata returns MetadataHandler with the attached metadata type', () => {
    const h = withMetadata<{ op: string }>({ op: 'x' });
    expectTypeOf(h.metadata).toEqualTypeOf<{ op: string }>();
  });

  it('MetadataHandler defaults to unknown metadata type', () => {
    expectTypeOf<MetadataHandler>().toMatchObjectType<{ metadata: unknown }>();
  });

  it('MetadataHandler can be specialized with a concrete type', () => {
    type MyMeta = { operationId: string; tags: string[] };
    expectTypeOf<MetadataHandler<MyMeta>>().toMatchObjectType<{ metadata: MyMeta }>();
  });
});

describe('issue #5 renderer type contract', () => {
  it('renderRoutesAsHtml accepts RouteMetaData[] and returns string', () => {
    expectTypeOf<typeof renderRoutesAsHtml>().parameter(0).toEqualTypeOf<RouteMetaData[] | RouteMetaDataMulti[]>();
    expectTypeOf<typeof renderRoutesAsHtml>().returns.toEqualTypeOf<string>();
  });

  it('renderRoutesAsMarkdown accepts RouteMetaData[] and returns string', () => {
    expectTypeOf<typeof renderRoutesAsMarkdown>().parameter(0).toEqualTypeOf<RouteMetaData[] | RouteMetaDataMulti[]>();
    expectTypeOf<typeof renderRoutesAsMarkdown>().returns.toEqualTypeOf<string>();
  });

  it('renderRoutesAsJson accepts RouteMetaData[] and returns string', () => {
    expectTypeOf<typeof renderRoutesAsJson>().parameter(0).toEqualTypeOf<RouteMetaData[] | RouteMetaDataMulti[]>();
    expectTypeOf<typeof renderRoutesAsJson>().returns.toEqualTypeOf<string>();
  });

  // Gap (LOW): RenderOptions shapes were not pinned. Source: design Unit B5 AC,
  // "`import type { HtmlRenderOptions, MarkdownRenderOptions, JsonRenderOptions }
  //  from 'express-route-parser'` resolves."
  it('HtmlRenderOptions has the documented shape', () => {
    expectTypeOf<HtmlRenderOptions>().toMatchObjectType<{
      title?: string;
    }>();
  });

  it('MarkdownRenderOptions has the documented shape', () => {
    expectTypeOf<MarkdownRenderOptions>().toMatchObjectType<{
      title?: string;
    }>();
  });

  it('JsonRenderOptions has the documented shape', () => {
    expectTypeOf<JsonRenderOptions>().toMatchObjectType<{
      indent?: number;
    }>();
  });
});

// ---------------------------------------------------------------------------
// Gap (HIGH): withMetadata<M> compile-time rejection. Source: design Unit A2 AC,
// "withMetadata<MySchema>({ ... }) rejects an input that doesn't match MySchema
// at compile time." The positive case is covered by `types.test-d.ts:99`; the
// negative case (the actual contract — rejection) was missing.
// ---------------------------------------------------------------------------

describe('withMetadata negative type tests', () => {
  it('rejects metadata that does not match the explicit type parameter', () => {
    type ExpectedMeta = { operationId: string; tags: string[] };

    // Positive case (sanity): correct shape resolves.
    const ok = withMetadata<ExpectedMeta>({ operationId: 'getX', tags: ['users'] });
    expectTypeOf(ok.metadata).toEqualTypeOf<ExpectedMeta>();

    // Negative case: missing required field.
    // @ts-expect-error - missing 'tags' field
    withMetadata<ExpectedMeta>({ operationId: 'getX' });

    // Negative case: wrong type for a field.
    // @ts-expect-error - 'operationId' should be string, got number
    withMetadata<ExpectedMeta>({ operationId: 42, tags: [] });

    // Negative case: extra unknown field (excess-property check).
    // @ts-expect-error - 'unknownField' is not declared on ExpectedMeta
    withMetadata<ExpectedMeta>({ operationId: 'x', tags: [], unknownField: true });
  });
});
