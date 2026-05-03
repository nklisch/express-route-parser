import { describe, expectTypeOf, it } from 'vitest';
import type { ExpressRegex, Key, Layer, Parameter, Route, RouteMetaData } from '../index';
import { parseExpressApp } from '../index';
import type { Express } from 'express';

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
