// Cross-version test: parse a v4 app and a v5 app in the same process.
// Asserts the key distinguishing characteristic: v4 Parameter lacks `type`;
// v5 Parameter always has `type`.
import { describe, it, expect } from 'vitest';
import e4 from 'express';
import e5 from 'express-v5';
import type { RequestHandler as Handler4 } from 'express';
import type { RequestHandler as Handler5 } from 'express-v5';
import { parseExpressApp } from '../index';

const ok4: Handler4 = (_req, res) => {
  res.status(204).send();
};

const ok5: Handler5 = (_req, res) => {
  res.status(204).send();
};

describe('cross-version parsing (v4 + v5 in the same process)', () => {
  it('v4 Parameter does not have a type field; v5 Parameter always does', () => {
    const app4 = e4();
    app4.get('/v4/:id', ok4);
    const [route4] = parseExpressApp(app4);
    expect(route4.path).toBe('/v4/:id');
    expect(route4.method).toBe('get');
    expect(route4.pathParams[0].name).toBe('id');
    expect(route4.pathParams[0].type).toBeUndefined();

    const app5 = e5();
    app5.get('/v5/:id', ok5);
    const [route5] = parseExpressApp(app5);
    expect(route5.path).toBe('/v5/:id');
    expect(route5.method).toBe('get');
    expect(route5.pathParams[0].name).toBe('id');
    expect(route5.pathParams[0].type).toBe('param');
  });

  it('repeating a v4 parse after a v5 parse produces correct output (no cross-contamination)', () => {
    // Parse v5 first
    const app5 = e5();
    app5.get('/check/:x', ok5);
    const [r5] = parseExpressApp(app5);
    expect(r5.pathParams[0].type).toBe('param');

    // Now parse v4 again — must still work with no type field
    const app4 = e4();
    app4.get('/check/:x', ok4);
    const [r4] = parseExpressApp(app4);
    expect(r4.path).toBe('/check/:x');
    expect(r4.pathParams[0].type).toBeUndefined();
  });

  it('v4 and v5 wildcards both parse correctly with correct type presence', () => {
    // v5 wildcard — type: 'wildcard'
    const app5 = e5();
    app5.get('/files/*splat', ok5);
    const [r5] = parseExpressApp(app5);
    expect(r5.pathParams[0].type).toBe('wildcard');

    // v4 has no wildcard type concept — path is just a param with no type
    const app4 = e4();
    app4.get('/files/:splat*', ok4);
    const [r4] = parseExpressApp(app4);
    // v4 extracts the param but leaves type undefined
    expect(r4.pathParams[0].type).toBeUndefined();
  });
});
