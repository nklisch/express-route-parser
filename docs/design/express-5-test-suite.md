# E2E Test Suite Design — Express 5 Surface

Designed via the e2e-test-design skill, 2026-05-03. Companion to
`docs/design/express-5-support.md` (the original v5 implementation design).

## Project Summary

`express-route-parser` is a TypeScript library exposing a single function,
`parseExpressApp(app)`, that walks an Express app's router tree and returns
a list of routes (`RouteMetaData[]`). Auto-detects Express 4 vs Express 5.

**Public surface relevant to v5:**
- `parseExpressApp(app, options?)` — the parser entry point
- `instrumentExpress5Router()` — manual instrument, for advanced users
- `withMetadata<M>(metadata)` — typed metadata wrapper
- `renderRoutesAsHtml`, `renderRoutesAsMarkdown`, `renderRoutesAsJson`
- `EXPRESS_ROUTE_PARSER_NO_AUTO_INSTRUMENT=1` env var
- Auto-installed `Router.prototype.use` / `.route` patch (side effect of import)

## Test Environment

- **Framework:** Vitest 4.x with v8 coverage; globals enabled (`describe`/`it`/`expect`).
- **Express versions:** v4 via `express`, v5 via `express-v5` npm alias (`npm:express@^5.2.0`).
- **Sub-process tests:** require a build (`npm run build`) so the fixture can `require('../../../lib')`. Existing `no-auto-instrument.test.ts` already enforces this via `beforeAll`.
- **HTTP smoke:** native Node `fetch` (Node ≥ 20, matches our engines floor); `server.listen(0)` for a random port; `server.close()` in `afterAll`.
- **Fixture conventions:** `.cjs` files under `src/__tests__/fixtures/` are excluded from eslint and tsconfig (`fixtures/**` ignore).

## Existing Coverage (Baseline)

| File | Tests | What it covers |
|---|---:|---|
| `parser-v5.test.ts` | 21 | Parser parity with v4 + v5-specific (wildcards, optional groups, ancestor params, regex/array mounts) |
| `no-auto-instrument.test.ts` | 2 | Env-var escape hatch (negative + manual instrument) |
| `types.test-d.ts` | 2 (v5 portion) | `Parameter['type']` union pinned |
| `parser.test.ts` | many | All v4 behavior |
| `renderers.test.ts` | many | Renderers via **synthetic** fixtures only |
| `example.test.ts` | 1 | README v4 example round-trip |
| `with-metadata.test.ts` | many | `withMetadata` |

**Identified gaps in the v5 surface (drives the new tests below):**

1. README v5 snippet not test-pinned
2. Renderers never receive real v5-parsed routes — `type: 'wildcard'` is invisible to assertions
3. No cross-version test (v4 + v5 in the same process)
4. No idempotency test for `instrumentExpress5Router()`
5. No coverage of `router.use(handler)` / bare-middleware / 4-arg error middleware on v5
6. No coverage of `router.param()` on v5 (covered for v4)
7. PUT / PATCH / DELETE round-trip on v5 not asserted
8. No live HTTP smoke (parser correctness vs. Express's actual routing)
9. Broken import order (sub-router constructed before our lib loads, no env var) is the most realistic user failure mode and isn't tested
10. Big chained `.route()` (`.all().get().post().put().patch().delete()`) on v5 not asserted

---

## Golden-Path Tests

### Journey: Documentation example fidelity

**Priority:** high

#### Test G1: README v5 example round-trips through the parser

- **File:** `src/__tests__/example-v5.test.ts` (new — parallels existing `example.test.ts`)
- **Setup:** Build the v5 app described verbatim in `README.md` lines 159-170, using `express-v5` and `withMetadata` for the metadata middleware.
- **Steps:**
  1. Construct an Express 5 app with one top-level route, one nested router with a sub-router, and a metadata-bearing route in the sub-router (mirror the v4 `example.test.ts`).
  2. Call `parseExpressApp(app)`.
- **Assertions:**
  - Returned array matches the documented shape (path, method, pathParams with ancestor accumulation, metadata).
  - Each `Parameter` on a v5 route has `type: 'param'` (or `'wildcard'`).
- **Teardown:** none.

---

### Journey: Renderer integration with v5-parsed routes

**Priority:** high

#### Test G2: v5-parsed routes round-trip through HTML / Markdown / JSON renderers

- **File:** `src/__tests__/renderers-v5.test.ts` (new — focused on integration, not unit-level renderer behavior)
- **Setup:** Build a small v5 app with a deliberately diverse mix:
  - a required-param route (`/users/:id`)
  - an optional-segment route (`/users{/:id}`)
  - a wildcard route (`/files/*splat`)
  - a nested mount with an ancestor param (`/api/:tenant` → `/x`)
  - a multi-method route (`.route('/y').get().post()`)
- **Steps:**
  1. Call `parseExpressApp(app)`.
  2. Pass the result to `renderRoutesAsHtml`, `renderRoutesAsMarkdown`, `renderRoutesAsJson`.
- **Assertions:**
  - All three renderers return non-empty strings without throwing on `type: 'wildcard'`.
  - HTML output contains all parsed paths as substrings.
  - Markdown output contains all parsed paths and methods.
  - JSON output is valid JSON whose parse equals the original parser result.
  - Same flow with `multipleMetadata: true` produces valid output.
- **Teardown:** none.

---

### Journey: All HTTP methods on v5

**Priority:** medium

#### Test G3: PUT, PATCH, DELETE round-trip

- **File:** `src/__tests__/parser-v5.test.ts` (extend)
- **Setup:** Register one route per method using `app.put`, `app.patch`, `app.delete`.
- **Steps:** Call `parseExpressApp`.
- **Assertions:** Each method appears in the output with the expected path. (GET / HEAD / OPTIONS / POST already covered.)
- **Teardown:** none.

---

### Journey: Big chained `.route()` on v5

**Priority:** medium

#### Test G4: `.route('/x').all().get().post().put().patch().delete().head().options()`

- **File:** `src/__tests__/parser-v5.test.ts` (extend)
- **Setup:** Build a `Router.route('/multi')` chain with all standard methods plus `.all()`.
- **Steps:** Call `parseExpressApp`.
- **Assertions:**
  - Output contains exactly one entry per explicit method (no `.all()` entry — its `method` is undefined).
  - All entries share `path: '/multi'`.
- **Teardown:** none.

---

### Journey: Cross-version (Express 4 + Express 5 parsed in the same process)

**Priority:** high

#### Test G5: parse v4 app, then parse v5 app, in the same test

- **File:** `src/__tests__/cross-version.test.ts` (new)
- **Setup:** Build a v4 app (`import express from 'express'`) with one route, and a v5 app (`import express5 from 'express-v5'`) with one route.
- **Steps:**
  1. Parse the v4 app.
  2. Parse the v5 app.
- **Assertions:**
  - Both produce the correct paths and methods.
  - The v4 entry's `pathParams[0]` does **not** have a `type` field (`expect(...).toBeUndefined()` on `type`).
  - The v5 entry's `pathParams[0]` **does** have `type: 'param'`.
  - Repeating the v4 parse after the v5 parse still works (no cross-contamination of state).
- **Teardown:** none.

---

### Journey: Live HTTP smoke — parsed paths actually route on a running v5 server

**Priority:** high

#### Test G6: boot v5 server, parse, fetch each parsed path, expect 2xx

- **File:** `src/__tests__/http-smoke-v5.test.ts` (new)
- **Setup:**
  - Build a v5 app with: a static route, a `:id` route, a wildcard route, a nested router with an ancestor `:tenant` param, and a multi-method `.route()` chain.
  - Each handler responds with status 204 (no body).
  - Start the server on port 0 in `beforeAll`; capture the assigned port; close in `afterAll`.
- **Steps:**
  1. `parseExpressApp(app)`.
  2. For each parsed route, build a concrete URL by substituting realistic values for path params (e.g., `:id` → `42`, `*splat` → `a/b/c`, `{:opt}` → omit the segment).
  3. `fetch(url, { method })` using the route's method (skip wildcard placeholders for `HEAD`/`OPTIONS` if those aren't registered).
- **Assertions:**
  - Every parsed route's substituted URL responds with a 2xx status. A 404 means the parser produced a path Express doesn't actually serve at — bug.
- **Teardown:** `server.close()` in `afterAll`.

**Note:** This test catches the "parser thinks the path is X but Express routes a different path" class of bug — the most valuable smoke for v5 since the path-string capture goes through a monkey-patch.

---

### Journey: `instrumentExpress5Router()` is idempotent

**Priority:** medium

#### Test G7: calling `instrumentExpress5Router()` repeatedly never throws and always returns true

- **File:** `src/__tests__/parser-v5.test.ts` (extend) **or** `src/__tests__/instrument-idempotency.test.ts` (new)
- **Setup:** Import `instrumentExpress5Router` from the lib.
- **Steps:**
  1. Call `instrumentExpress5Router()` three times in a row.
  2. Construct a new v5 router and parse it.
- **Assertions:**
  - All three calls return `true`.
  - The post-call parse still produces correct output (proving the patch wasn't broken by repeated calls).
- **Teardown:** none.

---

### Journey: Sub-router defined in a separate module file (working case)

**Priority:** medium

#### Test G8: import order is enforced — lib first, then user module that constructs routers

- **File:** sub-process test in `src/__tests__/import-order.test.ts` (new)
- **Fixture:** `src/__tests__/fixtures/v5-routes-module.cjs` — a CommonJS module that requires `express-v5` and exports a sub-router.
- **Fixture:** `src/__tests__/fixtures/import-order-good.cjs` — an entry-point fixture that requires our lib (which loads the patch), THEN requires the user-routes module, mounts it, and parses.
- **Setup:** `beforeAll` runs `npm run build` (same pattern as `no-auto-instrument.test.ts`).
- **Steps:** Spawn `node fixtures/import-order-good.cjs`, capture stdout.
- **Assertions:** stdout matches `OK: <expected paths joined>` — proves the recommended import order works across module boundaries.
- **Teardown:** none.

---

## Adversarial / Failure-Mode Tests

### Category: User Mistakes — Wrong import order

#### Test A1: sub-router constructed in a module loaded BEFORE our lib (no env var)

- **Scenario:** A user's `app.js` imports their routes module (which requires `express-v5` and constructs a router) BEFORE importing `express-route-parser`. The patch installs late; the existing router's layers have no captured mount paths.
- **File:** `src/__tests__/import-order.test.ts` (extend)
- **Fixture:** `src/__tests__/fixtures/import-order-bad.cjs` — requires `express-v5` and constructs a sub-router with `app.use('/api/:tenant', subrouter)` BEFORE requiring our lib. Then requires our lib and calls `parseExpressApp`.
- **Action:** Spawn `node fixtures/import-order-bad.cjs`.
- **Expected behavior:** stdout matches `THREW: ` followed by the actionable message containing `sub-router was constructed before instrumentation`.
- **Verify no side effects:** Process exits cleanly; no other crashes.

**Note:** This is distinct from the existing `no-auto-instrument.test.ts` test — that one uses the env-var to skip the patch. This one tests the more realistic real-world failure mode: import order, no env var.

---

### Category: User Mistakes — Non-route layers in the router stack

#### Test A2: 4-arg error middleware in a v5 router stack

- **Scenario:** App has both a real route and a 4-arg error middleware (`(err, req, res, next) => ...`). The parser must skip the error middleware silently — it isn't a route.
- **File:** `src/__tests__/parser-v5.test.ts` (extend)
- **Setup:** `app.get('/x', ok); app.use((_err, _req, _res, next) => next());`
- **Action:** `parseExpressApp(app)`.
- **Expected behavior:** Output contains exactly one entry — the `/x` route. No error, no warning.
- **Verify no side effects:** No console output, no thrown errors.

#### Test A3: 404 catchall (bare middleware) at the end of the stack

- **Scenario:** App has a real route followed by a 3-arg fallthrough handler used as a 404 catchall.
- **File:** `src/__tests__/parser-v5.test.ts` (extend)
- **Setup:** `app.get('/x', ok); app.use((_req, res) => res.status(404).send());`
- **Action:** `parseExpressApp(app)`.
- **Expected behavior:** Output contains exactly the `/x` route. The bare middleware is silently skipped.

#### Test A4: bare middleware before route registration

- **Scenario:** App calls `app.use(mw1); app.use(mw2); app.get('/x', h);` — common shape for body parsers, CORS, etc.
- **File:** `src/__tests__/parser-v5.test.ts` (extend)
- **Setup:** Two `app.use(fn)` calls with no path, then a real route.
- **Action:** `parseExpressApp(app)`.
- **Expected behavior:** Output is exactly `[{ path: '/x', method: 'get', pathParams: [] }]`.

---

### Category: User Mistakes — Param handlers and same-prefix mounts

#### Test A5: `router.param()` handler is not a route on v5

- **Scenario:** A v5 router uses `.param('id', handler)` to install a param resolver, plus a real route at `/users/:id`. The parser must surface only the route.
- **File:** `src/__tests__/parser-v5.test.ts` (extend)
- **Setup:** `router.param('id', handler); router.get('/users/:id', ok); app.use('/', router);`
- **Action:** `parseExpressApp(app)`.
- **Expected behavior:** Output is exactly the `/users/:id` GET entry; no entry for the param handler.

#### Test A6: two sub-routers mounted at the same prefix

- **Scenario:** `app.use('/api', r1); app.use('/api', r2);` — uncommon but legal. Both routers should be walked and their routes should appear in output with `/api` prefixed.
- **File:** `src/__tests__/parser-v5.test.ts` (extend)
- **Setup:** Two distinct routers each with one route, both mounted at `/api`.
- **Action:** `parseExpressApp(app)`.
- **Expected behavior:** Output contains both routes, each with the `/api` prefix.

---

### Category: Boundary Conditions

#### Test A7: routerless v5 app

- **Scenario:** An Express 5 app with no routes registered.
- **File:** `src/__tests__/parser-v5.test.ts` (already present — keep)
- **Action:** `parseExpressApp(app)`.
- **Expected behavior:** Returns `[]`.

*(Already covered; keep on the list as a checklist item.)*

#### Test A8: chained `.all()` interleaved with explicit methods on v5

- **Scenario:** `.route('/multi').all(handler).get(ok).post(ok)` — `.all()` produces a stack entry with no method; the parser must skip those.
- **File:** `src/__tests__/parser-v5.test.ts` (extend)
- **Setup:** `app.route('/multi').all(noopMw).get(ok).post(ok);`
- **Action:** `parseExpressApp(app)`.
- **Expected behavior:** Output contains exactly two entries — `get` and `post` at `/multi`.

#### Test A9: route with no path arg via `app.use(fn)` — already covered

*Equivalent to A4; deduped here.*

---

## Implementation Notes

**Test files to add:**
- `src/__tests__/example-v5.test.ts` — G1
- `src/__tests__/renderers-v5.test.ts` — G2
- `src/__tests__/cross-version.test.ts` — G5
- `src/__tests__/http-smoke-v5.test.ts` — G6
- `src/__tests__/import-order.test.ts` — G8 + A1
- `src/__tests__/fixtures/v5-routes-module.cjs` — shared fixture
- `src/__tests__/fixtures/import-order-good.cjs` — G8 fixture
- `src/__tests__/fixtures/import-order-bad.cjs` — A1 fixture

**Test files to extend:**
- `src/__tests__/parser-v5.test.ts` — G3, G4, G7, A2, A3, A4, A5, A6, A8

**Shared infrastructure:**
- HTTP smoke uses native `fetch` (Node ≥ 20, no new dep).
- Sub-process tests reuse the `beforeAll` build pattern from `no-auto-instrument.test.ts`.
- Fixture `.cjs` files are already excluded from eslint and tsconfig.

**Conventions to follow:**
- Arrow functions everywhere, single quotes, no docstrings on tests, vitest globals.
- Each test self-contained — no shared mutable state across tests.
- HTTP smoke must close its server in `afterAll` to avoid hanging the runner.

## Priority Order

Implement in this order — highest-value first, lowest-risk first within each tier:

**Tier 1 — High value, low risk (start here)**
1. G3 — PUT/PATCH/DELETE methods (~3 lines per test)
2. G4 — multi-method `.route()` chain
3. A2, A3, A4, A5, A6, A8 — non-route layer skipping (extend `parser-v5.test.ts`, all small)
4. G7 — idempotency

**Tier 2 — High value, moderate risk**
5. G1 — README v5 example pin
6. G2 — renderer integration
7. G5 — cross-version

**Tier 3 — Highest value, highest setup cost**
8. G8 + A1 — import-order sub-process tests (requires fixtures)
9. G6 — live HTTP smoke (requires server lifecycle)

Tier 1 should produce ~10 new green tests in one sitting. Tier 2 adds 3 files but uses existing infrastructure. Tier 3 is the biggest payoff — it's where real-world failure modes get caught — and should not be skipped despite the heavier setup.

## Coverage targets

- After Tier 1: ~150 total tests (was 142). All extensions land in `parser-v5.test.ts`.
- After Tier 2: ~155 total tests across 9 files.
- After Tier 3: ~160 total tests across 11 files (counting fixtures separately).
- Statement coverage stays ≥ 99%; branch coverage stays ≥ 95% (current floor).

## Out of scope

- Express 4 surface — not the focus. Existing `parser.test.ts` is comprehensive.
- Performance / load testing — this is a parsing library; runtime performance isn't a contract.
- Visual regression on renderer output — the renderers are tested for content, not exact whitespace/style.
- TypeScript strict-mode compatibility tests beyond what `types.test-d.ts` already pins.
- Bundling / ESM compatibility — separate concern, not v5-specific.
