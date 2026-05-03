# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Dev tooling: migrated from Jest 28 + ts-jest to Vitest 4 (faster, native TS, no transform config).
- Dev tooling: TypeScript 4.7 → 6.0.
- Dev tooling: ESLint 8 (legacy `.eslintrc.js`) → ESLint 10 with flat config (`eslint.config.mjs`).
- Dev tooling: Prettier 2 → 3 (config unchanged; format-stable).
- `engines.node`: `>=18` → `>=20`. Required by Vitest 4 and ESLint 10 dev requirements; Node 18 reached end-of-maintenance April 2025.

### Added
- Public API type tests (`src/__tests__/types.test-d.ts`) using Vitest's `expectTypeOf` to pin the shape of `parseExpressApp`, `RouteMetaData`, `Parameter`, `Key`, `ExpressRegex`, `Route`, `Layer`.

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

[Unreleased]: https://github.com/nklisch/express-route-parser/compare/v1.0.6...HEAD
[1.0.6]: https://github.com/nklisch/express-route-parser/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/nklisch/express-route-parser/releases/tag/v1.0.5
