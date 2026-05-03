# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.6] - YYYY-MM-DD

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
