# Design: CI Publish via npm OIDC Trusted Publishing

## Overview

This design replaces the current local-publish workflow (maintainer runs `npm publish` on
their laptop with a long-lived token) with a tag-driven GitHub Actions workflow that uses
**npm OIDC Trusted Publishing**. No `NPM_TOKEN` secret will exist in the repo. The
workflow is invoked when the maintainer pushes a `v*` tag (typically via `npm version`),
and the publish job exchanges a GitHub OIDC token for a short-lived npm credential to
publish the package with auto-generated provenance.

Adjacent improvements bundled into this design because they are inseparable from a sane
release story: a CHANGELOG, a fixed CI workflow that actually lints, a safer
`postversion` hook, and an `engines.node` declaration. The issue #7 fix and version bump
to `1.0.6` (which also ships PR #8's typedef change) is the first user of this pipeline.

## Verified Facts (2026-05)

These were re-checked against current npm and Node.js docs at design time. Do not
substitute training-memory values — they are stale for OIDC.

- **npm CLI requirement**: `>= 11.5.1` for OIDC trusted publishing.
- **Node.js requirement**: `>= 22.14.0` for the publish job runtime. (Source: npm docs
  `docs.npmjs.com/trusted-publishers/`.)
- **Required GitHub Actions permission**: `id-token: write`.
- **Self-hosted runners are NOT supported** — must use GitHub-hosted runners.
- **Provenance is automatic** when publishing via OIDC from GitHub Actions; the
  `--provenance` flag is not required, but passing it is harmless and makes intent
  explicit.
- **Initial version restriction**: A package's *first* version cannot be published via
  OIDC; the package must already exist. Not a blocker for us — `express-route-parser` is
  on npm at `1.0.5`.
- **Trusted publisher configuration is done in the npmjs.com web UI**, not in
  repository code. Required fields: GitHub org/user, repo name, workflow filename
  (e.g. `release.yml`), and optional environment.
- **Node LTS landscape (May 2026)**: Node 24 is in active LTS; Node 22 is in
  maintenance LTS until April 2027; Node 20 reached end-of-maintenance April 2026.
  Choose Node 24 for the publish job to match `skilltap`'s precedent and to stay on
  active LTS.

## Out-of-Scope (Manual Setup the Maintainer Must Do Once)

Before the workflow can succeed, the maintainer must:

1. Sign in to https://www.npmjs.com.
2. Navigate to the `express-route-parser` package settings → Publishing access →
   Trusted publishers.
3. Add a GitHub Actions trusted publisher with these exact values:
   - **Organization or user**: `nklisch`
   - **Repository**: `express-route-parser`
   - **Workflow filename**: `release.yml`
   - **Environment name**: leave empty (no GitHub environment will be used in this
     design — see "Hardening Options" for when to add one).
4. After saving, the existing classic automation token can be revoked. The
   `NPM_TOKEN` repository secret (if it exists) should be deleted.

This is one-time setup and lives outside the codebase.

## Implementation Units

### Unit 1: Release workflow

**File**: `.github/workflows/release.yml`

```yaml
name: Release

on:
  push:
    tags:
      - "v*"
  workflow_dispatch:
    inputs:
      tag:
        description: "Tag to release (e.g. v1.0.6)"
        required: true
        type: string

permissions:
  contents: read
  id-token: write

env:
  RELEASE_TAG: ${{ github.event_name == 'workflow_dispatch' && inputs.tag || github.ref_name }}

jobs:
  publish-npm:
    name: Publish to npm
    runs-on: ubuntu-latest
    steps:
      - name: Checkout at release tag
        uses: actions/checkout@v4
        with:
          ref: ${{ env.RELEASE_TAG }}

      - name: Setup Node.js (active LTS, satisfies npm OIDC >= 22.14.0)
        uses: actions/setup-node@v4
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org

      - name: Verify npm CLI version meets OIDC minimum (>= 11.5.1)
        run: |
          npm --version
          node -e "const v = process.versions.node.split('.').map(Number); if (v[0] < 22 || (v[0] === 22 && v[1] < 14)) { console.error('Node ' + process.version + ' is below 22.14.0 required for npm OIDC'); process.exit(1); }"

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Run lint
        run: npm run lint

      - name: Build
        run: npm run build

      - name: Publish to npm with provenance
        run: npm publish --provenance --access public

  github-release:
    name: Create GitHub Release
    needs: publish-npm
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - name: Checkout at release tag
        uses: actions/checkout@v4
        with:
          ref: ${{ env.RELEASE_TAG }}
          fetch-depth: 0

      - name: Create GitHub Release with auto-generated notes
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ env.RELEASE_TAG }}
          generate_release_notes: true
          fail_on_unmatched_files: false
```

**Implementation Notes**:

- `permissions:` is declared at workflow level with `contents: read` and the critical
  `id-token: write`. Each job can narrow further (the `github-release` job re-grants
  `contents: write` because `softprops/action-gh-release` needs it).
- `RELEASE_TAG` is computed once and reused: `github.ref_name` for tag-push, or the
  `workflow_dispatch` input. This is the same pattern `skilltap` uses.
- `actions/checkout@v4` is pinned to a major version. `with: ref: ${{ env.RELEASE_TAG }}`
  ensures the publish job builds *exactly* the tagged commit, not whatever happens to
  be on `main` at workflow-trigger time. This prevents a publish-skew bug if commits
  land between tag creation and workflow start.
- `actions/setup-node@v4` with `registry-url: https://registry.npmjs.org` is required
  for `npm publish` to know where to authenticate. Without it, OIDC token exchange
  silently fails to bind to the registry.
- `node-version: 24` chosen for: (a) active LTS as of 2026, (b) matches the
  `skilltap` reference, (c) ships an npm CLI well above the 11.5.1 minimum.
- The "Verify Node version" step is a paranoia check that fails loudly if a future
  edit accidentally drops Node below the OIDC threshold. Cheap insurance against the
  exact class of error this design exists to prevent.
- `npm ci` not `npm install` — uses lockfile, fails if `package.json` and
  `package-lock.json` are out of sync.
- `npm test`, `npm run lint`, `npm run build` are run *in CI* even though
  `prepublishOnly` would re-run test+lint and `prepare` would re-run build. This
  duplication is intentional: it surfaces failures with clean job names in the GitHub
  Actions UI rather than buried in `npm publish` output.
- `npm publish --provenance --access public`: `--provenance` is automatic with OIDC
  but passed explicitly for documentation value. `--access public` is required for
  scoped packages and harmless for unscoped — this package is unscoped today, but
  passing it removes one foot-gun if the package is ever scoped.
- The `github-release` job runs after publish succeeds. If publish fails, no GitHub
  Release is created, which prevents the confusing state where a release exists but
  no npm artifact does. The reverse failure mode (npm publish succeeds, GH release
  fails) is recoverable manually with `gh release create`.
- `generate_release_notes: true` lets GitHub auto-generate notes from PR titles and
  commits since the last tag. A maintained CHANGELOG (Unit 4) supplements this.

**Acceptance Criteria**:

- [ ] Pushing a tag `v1.0.6` triggers the workflow.
- [ ] The publish job has `id-token: write` permission and uses `actions/setup-node@v4`
      with Node 24 and `registry-url: https://registry.npmjs.org`.
- [ ] Workflow checks out the tagged commit, not `main`.
- [ ] `npm publish` runs without `NPM_TOKEN` and succeeds against npm registry.
- [ ] Published tarball on npmjs.com shows a "Provenance" badge linking to the
      GitHub Actions run.
- [ ] After publish, a GitHub Release for the tag exists with auto-generated notes.
- [ ] `workflow_dispatch` with input `v1.0.6` produces the same outcome as a tag push
      of `v1.0.6`.

---

### Unit 2: Fix CI workflow (rename and harden)

**File**: `.github/workflows/ci.yml` (rename of existing `node.js.yml`)

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    name: Test on Node ${{ matrix.node-version }}
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        node-version: [20, 22, 24]
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: npm

      - run: npm ci

      - name: Lint
        run: npm run lint

      - name: Build
        run: npm run build

      - name: Test
        run: npm test
```

**Implementation Notes**:

- **Delete the existing `.github/workflows/node.js.yml`** as part of this change. Two
  CI workflows produce confusing PR status checks.
- Matrix changed from `[12, 14, 16, 18]` (three are EOL) to `[20, 22, 24]`. Node 20
  reached end-of-maintenance April 2026 but is kept transiently to catch
  consumer-side breakage during the deprecation window; can be dropped in a
  follow-up. Node 22 is maintenance LTS, Node 24 is active LTS.
- Replaces the broken `npm run format` step with `npm run lint`. The original ran
  `prettier --write`, which mutates files but never fails the build, defeating the
  purpose of CI formatting checks.
- `cache: npm` enables built-in npm cache (faster CI, no third-party action).
- `fail-fast: false` so all matrix entries report regardless of one failing — useful
  for diagnosing version-specific issues.
- `actions/checkout@v3` → `@v4`, `actions/setup-node@v3` → `@v4`. v3 of both actions
  uses Node 16 internally (deprecated by GitHub).

**Acceptance Criteria**:

- [ ] PRs to `main` show three status checks: "Test on Node 20", "Test on Node 22",
      "Test on Node 24".
- [ ] CI fails on lint errors (verify by introducing one and observing failure).
- [ ] CI fails on test failures (covered by existing test suite).
- [ ] CI fails on type errors (covered by `npm run build` invoking `tsc`).
- [ ] No `node.js.yml` workflow remains.

---

### Unit 3: Update `package.json` for safer release ergonomics

**File**: `package.json`

Changes (full file diff is mechanical; only the modified fields are shown):

```jsonc
{
  // existing fields unchanged...
  "engines": {
    "node": ">=18"
  },
  "scripts": {
    "test": "jest --collectCoverage --config jestconfig.json",
    "build": "tsc",
    "format": "prettier --write \"src/**/*.ts\"",
    "lint": "eslint -c .eslintrc.js --ext .ts src",
    "lint-fix": "eslint -c .eslintrc.js --ext .ts src --fix",
    "prepare": "npm run build",
    "prepublishOnly": "npm test && npm run lint",
    "preversion": "npm run lint",
    "version": "npm run format && git add -A src",
    "postversion": "git push --follow-tags"
  }
}
```

**Implementation Notes**:

- `engines.node: ">=18"` is the **consumer-facing** floor for the published library.
  This is intentionally lower than the publish-job Node 22.14 requirement: consumers
  can run `express-route-parser` on any Node >= 18, but *publishing* it requires
  Node >= 22.14.0. These are unrelated knobs. Node 18 is currently the lowest
  reasonable floor (16 EOL Sep 2023). If the project wants to drop Node 18 it can be
  raised to 20 in a separate change with a minor-version bump.
- `postversion: "git push --follow-tags"` replaces `"git push && git push --tags"`.
  The original pushed *every* local tag in the repo, including any local-only
  experiments. `--follow-tags` pushes only annotated tags reachable from the pushed
  commits, which is what the maintainer almost always means.
- `prepublishOnly` is intentionally **kept** as belt-and-suspenders even though CI
  also runs test+lint. It catches the case where someone runs `npm publish` locally
  bypassing CI (e.g. emergency hotfix when CI is down).
- No other script changes. `prepare` continues to build on install/publish.

**Acceptance Criteria**:

- [ ] `npm version patch` produces a new commit, an annotated tag, and a single
      `git push --follow-tags` that pushes both atomically.
- [ ] `npm install` from a Node 17 environment emits an `EBADENGINE` warning (or
      hard error depending on consumer config).
- [ ] `prepublishOnly` still runs test+lint locally.

---

### Unit 4: Initial CHANGELOG

**File**: `CHANGELOG.md` (new)

```markdown
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
```

**Implementation Notes**:

- The `[1.0.6]` entry above is the first version cut by the new pipeline. The
  `YYYY-MM-DD` placeholder is filled in at release time.
- The "Keep a Changelog" sections (Added/Changed/Deprecated/Removed/Fixed/Security)
  are conventional. Use only the ones that apply per release.
- Compare-link footnotes use the canonical `nklisch/express-route-parser` repo URL,
  matching both `package.json` `repository.url` and the active git remote.
- The CHANGELOG is hand-maintained. PRs that ship user-visible changes should
  update the `[Unreleased]` section. The `npm version` step transitions
  `[Unreleased]` to a numbered entry — this is currently manual but could be
  automated later with a `version` lifecycle hook.

**Acceptance Criteria**:

- [ ] `CHANGELOG.md` exists at repo root.
- [ ] Existing user-visible changes since `1.0.5` (issue #7 fix, PR #8 typedefs) are
      documented under `[1.0.6]`.

---

### Unit 5: Maintainer release runbook

**File**: `docs/RELEASING.md` (new)

```markdown
# Releasing express-route-parser

This package publishes to npm via GitHub Actions using OIDC Trusted Publishing.
There is no `NPM_TOKEN` secret. Publishing requires only that the maintainer has
write access to the GitHub repo and that the trusted publisher is configured on
npmjs.com (see one-time setup below).

## One-Time Setup

The npmjs.com trusted publisher must be configured once per package. Required values:

| Field          | Value                                  |
| -------------- | -------------------------------------- |
| Provider       | GitHub Actions                         |
| Org or user    | `nklisch`                              |
| Repository     | `express-route-parser`                 |
| Workflow file  | `release.yml`                          |
| Environment    | (leave empty)                          |

Done at https://www.npmjs.com/package/express-route-parser/access (Publishing
access section).

After this is configured, the legacy npm automation token (if any) can be revoked.

## Cutting a Release

1. Ensure `main` is green in CI and contains everything intended for the release.
2. Move the `[Unreleased]` section of `CHANGELOG.md` under a new `[X.Y.Z]` heading
   with today's date. Add an `[Unreleased]` placeholder back at the top. Update
   the compare-link footnotes.
3. Commit the CHANGELOG change.
4. Run `npm version <patch|minor|major>`. This:
   - lints (`preversion`)
   - bumps the version in `package.json` and `package-lock.json`
   - formats and stages source (`version`)
   - commits and creates an annotated `v<x.y.z>` tag
   - pushes commit + tag to origin (`postversion`, `git push --follow-tags`)
5. The `Release` workflow fires on the tag, runs tests/lint/build, publishes to
   npm with provenance, and creates a GitHub Release.
6. Verify on https://www.npmjs.com/package/express-route-parser that the new
   version shows a "Provenance" badge.

## Rollback

If a bad version is published:

- Within 72 hours: `npm unpublish express-route-parser@<bad-version>` (locally,
  using a personal token — OIDC does not cover unpublish).
- After 72 hours: publish a `<bad-version>+1` patch with the fix; users can be
  steered via `npm deprecate`.

## Manual Re-Run

If the publish workflow fails for a transient reason (registry blip, etc.) and
the tag is already pushed, re-run via:

- GitHub UI: Actions → Release → Run workflow → enter the tag (e.g. `v1.0.6`).
- This uses the `workflow_dispatch` trigger and produces the same result as a
  tag push.
```

**Implementation Notes**:

- Living documentation. Keep concise — intended for the maintainer, not consumers.
- Placed under `docs/` to keep repo root uncluttered.

**Acceptance Criteria**:

- [ ] `docs/RELEASING.md` exists.
- [ ] A maintainer who has never released this package before can follow it
      end-to-end without consulting external docs.

---

## Open Questions

These need resolution before implementation. Each is a real fork in the road, not a
nit.

### Q1: Should we use a GitHub Environment for the publish job?

A GitHub Environment with a required reviewer would force a human approval step
between tag-push and `npm publish` running. This is a hardening option used by
projects that want a final out-of-band review. Skilltap does not use one. For a
package with a single maintainer and no compliance requirements, the friction
likely outweighs the value.

**Recommendation**: skip for v1 of this pipeline; add later if abuse or
mistake-publishes become a problem. If added, the environment name must be
declared *both* in the workflow `jobs.publish-npm.environment` field *and* on the
npmjs.com trusted publisher configuration — they must match exactly.

### Q2: Drop `prepublishOnly` lifecycle hook?

Now that CI runs test+lint before publish, the `prepublishOnly` script is
redundant in the happy path. Removing it makes `npm publish` faster locally
during incident response. Keeping it adds a safety net if someone publishes
outside CI. **Recommendation**: keep it — the cost is seconds, the value is
non-zero.

---

## Implementation Order

Strict dependency order:

1. **Unit 4 (CHANGELOG.md)** — no dependencies. Establishes the artifact that
   subsequent releases will update.
2. **Unit 3 (package.json updates)** — no dependencies. Safe even before the new
   workflow exists.
3. **Unit 2 (CI workflow rename + fix)** — no dependencies on this design but
   should land before Unit 1 to ensure the release workflow's tag-time test run
   is consistent with PR-time test runs.
4. **One-time manual setup**: configure trusted publisher on npmjs.com (out of
   scope for code, in scope for the release runbook).
5. **Unit 1 (release.yml)** — depends on the trusted-publisher being configured
   in npmjs.com. The workflow can be merged before that configuration exists,
   but it will fail on first invocation if the npm side isn't done yet.
6. **Unit 5 (RELEASING.md)** — last, because it documents the now-existing
   pipeline. Could be done in parallel with Unit 1.
7. **First release using the new pipeline**: `1.0.6`, shipping the issue #7 fix
   and PR #8's typedef change.

## Verification Checklist

After all units are implemented:

```bash
# Unit 2: CI workflow
gh workflow list                      # should show "CI" and "Release", not "Node.js CI"
gh workflow run CI                    # PR-style run; should pass on Node 20/22/24

# Unit 3: package.json
node -e "const p=require('./package.json'); if (p.engines?.node !== '>=18') process.exit(1)"
node -e "const p=require('./package.json'); if (p.scripts.postversion !== 'git push --follow-tags') process.exit(1)"

# Unit 4: CHANGELOG
test -f CHANGELOG.md && grep -q '\[1.0.6\]' CHANGELOG.md

# Unit 5: Runbook
test -f docs/RELEASING.md

# End-to-end (after npm trusted-publisher is configured):
# npm version patch    # creates v1.0.6 tag, pushes
# Watch GitHub Actions: Release workflow should run publish-npm then github-release
# Verify on npmjs.com: package version 1.0.6 with Provenance badge
# Verify on GitHub: Release v1.0.6 with auto-generated notes
```

## Hardening Options (Not Implemented Now)

Listed here so a future maintainer doesn't have to re-derive them:

- **GitHub Environment with required reviewer** for `publish-npm` job — adds a
  manual approval gate. Worth it if the project gains contributors and you want
  a publish-time human check.
- **Pin GitHub Actions to commit SHAs instead of major tags** — defends against
  a compromised action publishing your package. Tradeoff: dependabot churn.
- **Sigstore key-pinning / cosign verification** of action SHAs — overkill for
  this package's risk profile.
- **Separate `prerelease` workflow** that publishes to a `next` dist-tag from
  branches matching `release/*`, leaving `latest` for stable.
- **Auto-CHANGELOG** via a `version` script extension that promotes
  `[Unreleased]` → numbered section. Removes a manual step.

## References

- npm docs: trusted publishing — https://docs.npmjs.com/trusted-publishers/
  - Verified at design time: requires npm CLI ≥ 11.5.1, Node ≥ 22.14.0,
    `id-token: write` permission, GitHub-hosted runners only.
- GitHub Changelog (2025-07-31): npm trusted publishing GA —
  https://github.blog/changelog/2025-07-31-npm-trusted-publishing-with-oidc-is-generally-available/
- npm/cli#8544: initial-version restriction —
  https://github.com/npm/cli/issues/8544
- Reference implementation: `~/dev/skilltap/.github/workflows/release.yml` (the
  `publish-npm` job; this design borrows its structure).
