# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-05-04

### Added
- **Express 5 support.** `parseExpressApp(app)` auto-detects Express 4 vs Express 5 and dispatches to
  the appropriate parser. New `Parameter.type` field surfaces path-to-regexp v8's `'param'` vs
  `'wildcard'` distinction for v5 routes.
- Auto-installed `Router.prototype` patch on package import captures mount paths for Express 5
  (necessary because Express 5 discards the path string at Layer construction). Idempotent; no-op
  on Express 4-only deployments. Disable via `EXPRESS_ROUTE_PARSER_NO_AUTO_INSTRUMENT=1`.
- New export: `instrumentExpress5Router()` for users who need to defer instrumentation.

### Fixed
- **Express 5 nested-router `pathParams` now accumulate ancestor params**, matching Express 4
  behavior. Previously, `app.use('/api/:v', router); router.get('/users/:id', h)` reported only
  `:id`; now reports `:v` and `:id`. Closes a regression vs the v4 parser's existing semantics.

### Changed
- **BREAKING (peer dep widening): `peerDependencies.express` is now `^4.x || ^5.x`** (was `^4.x`).
  Existing v1.x consumers on Express 4 are unaffected; Express 5 consumers can now install.
  Same widening for `@types/express`.
- Express 5 optional-segment detection switched from a regex heuristic on the raw path string to
  path-to-regexp v8's public `parse()` AST. `Group` tokens (`{...}`) are now the structural source
  of optionality. Same observable behavior on documented forms; more robust on uncommon ones.
- Internal restructure: parser body split into `src/express-parser/v4.ts`,
  `src/express-parser/v5.ts`, and a thin dispatcher in `src/express-parser/index.ts`.
  Public API surface unchanged.

### Added (dev)
- E2E test suite for the v5 surface (`docs/design/express-5-test-suite.md`): renderer integration
  with real v5-parsed routes, README v5 example pin, cross-version (v4 + v5 in same process),
  live HTTP smoke (boots a real v5 server, fetches each parsed route), import-order tests
  (working + broken via sub-process fixtures), idempotent instrument, error middleware / 404
  catchall / `router.param()` skipping, same-prefix mounts, all HTTP methods. Coverage:
  117 → 173 tests.
- Sub-process test fixtures live in `src/__tests__/fixtures/` (`.cjs`, exempt from eslint and
  tsconfig).

## [1.1.0] - 2026-05-03

### Added
- `parseExpressApp(app, { multipleMetadata: true })` opt-in: returns `RouteMetaDataMulti[]`
  where `metadata` is always `any[]` (possibly empty). Default single-mode behavior unchanged;
  throws on multiple metadata with a friendlier error that mentions the opt-in. Closes #6.
- `withMetadata<M>(meta)` helper: returns a no-op `RequestHandler` with `metadata: M`
  attached. Typed alternative to the README's inline `const m: any = ...` cast pattern. Closes #6.
- New exports: `withMetadata`, `ParseOptions`, `RouteMetaDataMulti`, `MetadataHandler`.
- `renderRoutesAsHtml(routes, { title? })`: self-contained HTML document with inline CSS,
  method-colored badges, and collapsible metadata via `<details>`. No external resources. Closes #5.
- `renderRoutesAsMarkdown(routes, { title? })`: GFM-compatible Markdown table; short metadata
  inline-coded, long metadata in a `<details>`/`<pre>` block. Closes #5.
- `renderRoutesAsJson(routes, { indent? })`: pretty-printed JSON; RegExp paths serialized as
  their string form rather than `{}`. Closes #5.
- New exports: `renderRoutesAsHtml`, `HtmlRenderOptions`, `renderRoutesAsMarkdown`,
  `MarkdownRenderOptions`, `renderRoutesAsJson`, `JsonRenderOptions`.

### Fixed
- `parseExpressApp(app)` no longer crashes when called on an app with no routes registered.
  The constructor previously fell back from `app._router` to `app.router`, which in Express 4
  is a deprecated property that throws on access. Now correctly returns `[]` for routeless apps.

### Changed
- Dev tooling: migrated from Jest 28 + ts-jest to Vitest 4 (faster, native TS, no transform config).
- Dev tooling: TypeScript 4.7 → 6.0.
- Dev tooling: ESLint 8 (legacy `.eslintrc.js`) → ESLint 10 with flat config (`eslint.config.mjs`).
- Dev tooling: Prettier 2 → 3 (config unchanged; format-stable).
- `engines.node`: `>=18` → `>=20`. Required by Vitest 4 and ESLint 10 dev requirements; Node 18 reached end-of-maintenance April 2025.
- Single-mode error message for multiple metadata now mentions `{ multipleMetadata: true }` opt-in.

### Added (dev)
- Public API type tests (`src/__tests__/types.test-d.ts`) using Vitest's `expectTypeOf` to pin the shape of `parseExpressApp`, `RouteMetaData`, `Parameter`, `Key`, `ExpressRegex`, `Route`, `Layer`, plus all new exports.
- 15 additional behavior tests across HTTP methods, mount-path variations, empty-router handling, `router.param` handling, Markdown newline escaping, JSON array-path round-trip, and negative type tests for `withMetadata`. Coverage: 102 → 117 tests.

### Removed
- Dead deps: `eslint-plugin-react` (unused), `eslint-plugin-prefer-arrow` (replaced with `eslint-plugin-prefer-arrow-functions`), `tslint-config-prettier` (TSLint dead).
- Obsolete config files: `.eslintrc.js`, `tsconfig.eslint.json`, `jestconfig.json`.

## [1.0.6] - 2026-05-03

### Fixed
- `Router#route` chained handlers (e.g. `.post(...).get(...)`) now produce one
  `RouteMetaData` entry per HTTP method instead of only the last handler. (#7)

### Added
- Type definition for `path` on `RouteMetaData` broadened to accept arrays and
  regex, matching what Express's `app.METHOD` accepts. (PR #8, previously merged
  but unreleased.)

### Changed
- Release pipeline now runs in GitHub Actions via npm OIDC Trusted Publishing.
  Published tarballs include signed provenance attestations.

## [1.0.5] - 2022-08-01

Initial published version covered by this changelog. See git history for prior changes.

[Unreleased]: https://github.com/nklisch/express-route-parser/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/nklisch/express-route-parser/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/nklisch/express-route-parser/compare/v1.0.6...v1.1.0
[1.0.6]: https://github.com/nklisch/express-route-parser/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/nklisch/express-route-parser/releases/tag/v1.0.5
