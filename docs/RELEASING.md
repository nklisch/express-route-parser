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
