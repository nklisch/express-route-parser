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

## Cutting a Release (Recommended: One-Command Script)

```bash
./scripts/release.sh patch    # 1.0.6 -> 1.0.7
./scripts/release.sh minor    # 1.0.6 -> 1.1.0
./scripts/release.sh major    # 1.0.6 -> 2.0.0
```

The script handles the full flow end-to-end:

1. Validates preconditions (clean working tree, on `main` and up to date,
   `gh` authenticated, no in-flight release PR).
2. Computes the new version, creates branch `release/X.Y.Z`.
3. Updates `CHANGELOG.md`'s `[Unreleased]` section to a dated `[X.Y.Z]` block
   (or fills in a pre-seeded `[X.Y.Z]` section's date if present).
4. Bumps version in `package.json` and `package-lock.json`.
5. Commits and pushes the branch; opens a PR via `gh pr create`.
6. Waits for the PR's CI checks to pass.
7. Pauses for the maintainer to merge the PR (or enables GitHub auto-merge
   with `--auto-merge`).
8. After merge: fetches `main`, **tags the merge commit** (not the bump commit
   inside the branch — see "Tag placement" below), pushes the tag.
9. Watches the `Release` workflow run, then verifies the new version lands on
   npm with the provenance badge.

Run `./scripts/release.sh --help` for flags.

## Cutting a Release (Manual Procedure)

The script is the canonical path; this manual procedure documents what it does
and serves as a fallback if the script is unavailable.

`main` is a protected branch — direct pushes are rejected. All releases go
through a PR.

1. Ensure `main` is green in CI and contains everything intended for the release.
2. Decide the new version (`X.Y.Z`).
3. Create a branch from `main`:
   ```bash
   git switch main && git pull --ff-only
   git switch -c release/X.Y.Z
   ```
4. Update `CHANGELOG.md`:
   - If you were appending changes to `[Unreleased]`, move that section under a
     new `[X.Y.Z]` heading with today's date.
   - If `[X.Y.Z]` is already pre-seeded with planned content (as was the case
     for 1.0.6), just fill in the date placeholder.
   - Add an `[Unreleased]` placeholder back at the top.
   - Update the compare-link footnotes.
5. Bump the version in **both** `package.json` and `package-lock.json` (lockfile
   contains the version in two places: top-level `version` and `packages."".version`).
6. Commit and push:
   ```bash
   git add CHANGELOG.md package.json package-lock.json
   git commit -m "X.Y.Z"      # match prior tag-commit convention
   git push -u origin release/X.Y.Z
   ```
7. Open a PR:
   ```bash
   gh pr create --title "Release X.Y.Z" --body "..."
   ```
8. Wait for CI to pass, then merge the PR (squash, merge-commit, or rebase — all work).
9. **Tag the merge commit on `main`** — see "Tag placement" below for why this
   matters:
   ```bash
   git switch main && git pull --ff-only
   git tag -a vX.Y.Z -m "X.Y.Z"
   git push origin vX.Y.Z
   ```
10. The `Release` workflow fires on the tag push. It runs tests/lint/build,
    publishes to npm with provenance, and creates a GitHub Release with
    auto-generated notes.
11. Verify on https://www.npmjs.com/package/express-route-parser that the new
    version shows a "Provenance" badge.

## Tag Placement (Important)

**Always tag the merge commit on `main`, not the version-bump commit inside the
release branch.**

GitHub's auto-generated release notes (used by `softprops/action-gh-release`
with `generate_release_notes: true`) discover PRs merged between the previous
release tag and the current tag by walking the commit graph. If the tag points
at a commit that's *inside* the release branch (e.g., the bump commit), then
the release PR's merge commit is unreachable from the tag, and any PRs that
merged via that PR's flow won't appear in the notes.

This was learned the hard way during the `1.0.6` ship — the tag was placed on
the bump commit, the auto-generated notes only mentioned the previous PR (#8),
and the notes had to be manually overwritten. The `release.sh` script and the
manual procedure above both place the tag on the merge commit to avoid this.

Symptom that you got it wrong: the GitHub Release notes show fewer PRs than
you expected for the version. Fix: edit the release notes manually, and place
future tags correctly.

## Rollback

If a bad version is published:

- **Within 72 hours**: `npm unpublish express-route-parser@<bad-version>`
  (locally, using a personal token — OIDC does not cover unpublish, so a
  classic auth token is needed for this).
- **After 72 hours**: publish a `<bad-version>+1` patch with the fix; users
  can be steered via `npm deprecate`.

In both cases, also update `CHANGELOG.md` and consider editing the GitHub
Release to note the issue.

## Manual Re-Run of the Publish Workflow

If the publish workflow fails for a transient reason (registry blip, GitHub
Actions infra issue) and the tag is already pushed, re-run via:

- GitHub UI: Actions → Release → Run workflow → enter the tag (e.g. `v1.0.6`).
- The workflow uses `workflow_dispatch` and produces the same result as a
  tag push.

## Releasing With No Source Changes

Sometimes you'll want to release just to update metadata (engines, scripts,
docs, devDeps) — i.e., the published `lib/` is unchanged from the previous
version.

In that case: still cut a release if any consumer-visible field changed
(`engines.node`, `peerDependencies`, package types). If only `devDependencies`
or CI changed, **don't release** — the lib/ output is byte-identical and there
is nothing for consumers to install.

A "did anything publishable change?" sanity check:

```bash
git diff v<prev>..HEAD -- lib/ package.json
```

If both are unchanged or only `version` differs in `package.json`, a release
adds zero value.
