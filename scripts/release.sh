#!/usr/bin/env bash
#
# release.sh — cut a new release of express-route-parser end-to-end.
#
# Usage:
#   ./scripts/release.sh patch              # 1.0.6 -> 1.0.7
#   ./scripts/release.sh minor              # 1.0.6 -> 1.1.0
#   ./scripts/release.sh major              # 1.0.6 -> 2.0.0
#   ./scripts/release.sh 1.2.3              # explicit version
#   ./scripts/release.sh patch --auto-merge # enable GitHub auto-merge after CI passes
#   ./scripts/release.sh patch --no-watch   # don't watch the Release workflow run
#
# What it does (the full flow we use to publish):
#
#   1. Validates: clean tree, on main+up-to-date, gh CLI auth, no existing
#      release branch for this version.
#   2. Creates branch release/X.Y.Z, updates CHANGELOG.md date, bumps version
#      in package.json and package-lock.json, commits.
#   3. Pushes branch, opens PR via gh.
#   4. Waits for CI checks to pass on the PR.
#   5. Either auto-merges (--auto-merge) or pauses for the maintainer to merge.
#   6. After merge, fetches main, tags the MERGE COMMIT (not the bump commit —
#      see docs/RELEASING.md "Tag placement"), pushes the tag.
#   7. Watches the Release workflow run, then verifies npm publication.
#
# Exit codes:
#   0 — release shipped to npm successfully
#   1 — precondition failed (dirty tree, wrong branch, etc.)
#   2 — CI failed on the release PR
#   3 — release workflow failed
#   4 — npm verification failed (version not published, no provenance)
#

set -euo pipefail

# -- Config -------------------------------------------------------------------

readonly REPO_REMOTE="origin"
readonly DEFAULT_BRANCH="main"
readonly PACKAGE_NAME="express-route-parser"

# -- Helpers ------------------------------------------------------------------

color_red()    { printf '\033[0;31m%s\033[0m' "$*"; }
color_green()  { printf '\033[0;32m%s\033[0m' "$*"; }
color_yellow() { printf '\033[0;33m%s\033[0m' "$*"; }
color_dim()    { printf '\033[2m%s\033[0m' "$*"; }

step() { printf '\n%s %s\n' "$(color_green '==>')" "$*"; }
info() { printf '%s %s\n' "$(color_dim '   ')" "$*"; }
warn() { printf '%s %s\n' "$(color_yellow '!!!')" "$*" >&2; }
die()  { printf '%s %s\n' "$(color_red 'ERROR:')" "$*" >&2; exit "${2:-1}"; }

usage() {
    sed -n '/^# Usage:/,/^$/p' "$0" | sed 's/^# \?//' >&2
    exit 64
}

# -- Argument parsing ---------------------------------------------------------

BUMP=""
AUTO_MERGE=0
WATCH=1

while [[ $# -gt 0 ]]; do
    case "$1" in
        patch|minor|major) BUMP="$1"; shift ;;
        [0-9]*.[0-9]*.[0-9]*) BUMP="$1"; shift ;;  # explicit version
        --auto-merge) AUTO_MERGE=1; shift ;;
        --no-watch) WATCH=0; shift ;;
        -h|--help) usage ;;
        *) warn "Unknown argument: $1"; usage ;;
    esac
done

[[ -z "$BUMP" ]] && usage

# -- Preflight ----------------------------------------------------------------

step "Preflight checks"

command -v gh >/dev/null || die "gh CLI not found. Install: https://cli.github.com/"
command -v jq >/dev/null || die "jq not found (used to compute next version)."
command -v node >/dev/null || die "node not found."

gh auth status >/dev/null 2>&1 || die "gh CLI not authenticated. Run: gh auth login"
info "gh authenticated"

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
[[ "$CURRENT_BRANCH" == "$DEFAULT_BRANCH" ]] || \
    die "Must be on '$DEFAULT_BRANCH', currently on '$CURRENT_BRANCH'."
info "on $DEFAULT_BRANCH"

[[ -z "$(git status --porcelain)" ]] || \
    die "Working tree is dirty. Stash or commit before releasing."
info "working tree clean"

git fetch "$REPO_REMOTE" "$DEFAULT_BRANCH" --quiet
LOCAL_HEAD=$(git rev-parse HEAD)
REMOTE_HEAD=$(git rev-parse "$REPO_REMOTE/$DEFAULT_BRANCH")
[[ "$LOCAL_HEAD" == "$REMOTE_HEAD" ]] || \
    die "Local '$DEFAULT_BRANCH' is not up to date with '$REPO_REMOTE/$DEFAULT_BRANCH'. Run: git pull --ff-only"
info "main up to date"

# -- Compute version ----------------------------------------------------------

step "Computing next version"

CURRENT_VERSION=$(node -p "require('./package.json').version")
info "current version: $CURRENT_VERSION"

case "$BUMP" in
    patch|minor|major)
        # Compute next version with node (no external semver dep needed).
        NEW_VERSION=$(node -e "
            const [maj, min, pat] = '$CURRENT_VERSION'.split('.').map(Number);
            const bump = '$BUMP';
            if (bump === 'major')      console.log(\`\${maj + 1}.0.0\`);
            else if (bump === 'minor') console.log(\`\${maj}.\${min + 1}.0\`);
            else                       console.log(\`\${maj}.\${min}.\${pat + 1}\`);
        ")
        ;;
    *)
        NEW_VERSION="$BUMP"
        ;;
esac

info "new version: $(color_green "$NEW_VERSION")"

RELEASE_BRANCH="release/$NEW_VERSION"
RELEASE_TAG="v$NEW_VERSION"

# Refuse to clobber an existing branch or tag.
if git ls-remote --exit-code --heads "$REPO_REMOTE" "$RELEASE_BRANCH" >/dev/null 2>&1; then
    die "Branch '$RELEASE_BRANCH' already exists on $REPO_REMOTE. Delete it or pick a different version."
fi
if git ls-remote --exit-code --tags "$REPO_REMOTE" "$RELEASE_TAG" >/dev/null 2>&1; then
    die "Tag '$RELEASE_TAG' already exists on $REPO_REMOTE."
fi

# -- Create release branch ----------------------------------------------------

step "Creating branch $RELEASE_BRANCH"

git switch -c "$RELEASE_BRANCH"

# Update CHANGELOG: replace YYYY-MM-DD placeholder if present, else move
# [Unreleased] section under a dated [X.Y.Z] heading.
TODAY=$(date -u +%Y-%m-%d)

if grep -qE "## \[$NEW_VERSION\] - YYYY-MM-DD" CHANGELOG.md; then
    info "CHANGELOG: filling date for pre-seeded [$NEW_VERSION]"
    sed -i.bak "s/## \[$NEW_VERSION\] - YYYY-MM-DD/## [$NEW_VERSION] - $TODAY/" CHANGELOG.md
    rm CHANGELOG.md.bak
elif grep -qE "## \[$NEW_VERSION\] - [0-9]{4}-[0-9]{2}-[0-9]{2}" CHANGELOG.md; then
    info "CHANGELOG: [$NEW_VERSION] section already dated, leaving as-is"
else
    warn "CHANGELOG.md has no [$NEW_VERSION] section."
    warn "Add changes under [Unreleased] or pre-seed [$NEW_VERSION] before re-running."
    git switch "$DEFAULT_BRANCH"
    git branch -D "$RELEASE_BRANCH"
    exit 1
fi

# Bump package.json and package-lock.json. The lockfile has the version in two
# places (top-level "version" and packages."".version) — npm version covers both.
# --ignore-scripts: the release flow owns commit/tag/push; any preversion /
# version / postversion hook would interfere (e.g. a stray `git push` on a
# branch with no upstream aborts the release mid-flight).
info "bumping package.json + package-lock.json to $NEW_VERSION"
npm version "$NEW_VERSION" --no-git-tag-version --allow-same-version --ignore-scripts >/dev/null

# Sanity: verify the bump landed in both files.
PKG_VER=$(node -p "require('./package.json').version")
LOCK_TOP=$(node -p "require('./package-lock.json').version")
LOCK_PKGS=$(node -p "require('./package-lock.json').packages[''].version")
[[ "$PKG_VER" == "$NEW_VERSION" && "$LOCK_TOP" == "$NEW_VERSION" && "$LOCK_PKGS" == "$NEW_VERSION" ]] || \
    die "Version bump did not propagate consistently (pkg=$PKG_VER, lock-top=$LOCK_TOP, lock-pkgs=$LOCK_PKGS)."

# Commit. Match prior convention: short message that's just the version.
git add CHANGELOG.md package.json package-lock.json
git commit -m "$NEW_VERSION" >/dev/null
info "committed: $(git log -1 --oneline)"

# -- Push and open PR ---------------------------------------------------------

step "Pushing branch and opening PR"

git push -u "$REPO_REMOTE" "$RELEASE_BRANCH" --quiet

PR_BODY=$(cat <<EOF
Release **$NEW_VERSION**.

## Changelog

See \`CHANGELOG.md\` for the full entry. Highlights:

$(awk -v ver="$NEW_VERSION" '
    $0 ~ "^## \\[" ver "\\]" { in_section = 1; next }
    in_section && /^## \[/   { exit }
    in_section && NF         { print }
' CHANGELOG.md | head -40)

## Test plan

- [x] CI passes on this PR
- [ ] After merge: tag points at the merge commit (script handles this)
- [ ] After release: \`$NEW_VERSION\` shows on npm with provenance badge
EOF
)

PR_URL=$(gh pr create --title "Release $NEW_VERSION" --body "$PR_BODY" --base "$DEFAULT_BRANCH" 2>&1 | tail -1)
info "PR: $PR_URL"

PR_NUMBER=$(echo "$PR_URL" | grep -oE '[0-9]+$')
[[ -n "$PR_NUMBER" ]] || die "Could not parse PR number from: $PR_URL"

# -- Wait for CI --------------------------------------------------------------

step "Waiting for CI on PR #$PR_NUMBER"

# Allow checks to register.
sleep 5

# Find the run ID(s) for this PR's CI.
gh pr checks "$PR_NUMBER" >/dev/null 2>&1 || true

# `gh pr checks --watch` blocks until terminal state.
if ! gh pr checks "$PR_NUMBER" --watch --fail-fast 2>&1; then
    die "CI failed on PR #$PR_NUMBER. Investigate: $PR_URL" 2
fi

info "CI passed"

# -- Merge --------------------------------------------------------------------

if [[ "$AUTO_MERGE" -eq 1 ]]; then
    step "Enabling auto-merge"
    gh pr merge "$PR_NUMBER" --auto --merge >/dev/null
    info "auto-merge requested; will merge once branch protections are satisfied"
else
    step "Awaiting manual merge of PR #$PR_NUMBER"
    info "Merge it: $PR_URL"
    info "(use --auto-merge next time to skip this pause)"
fi

# Poll for merged state.
SECONDS_WAITED=0
while true; do
    PR_STATE=$(gh pr view "$PR_NUMBER" --json state,mergedAt --jq '.state + "/" + (.mergedAt // "null")')
    if [[ "$PR_STATE" == MERGED/* ]]; then
        info "PR merged"
        break
    fi
    if [[ "$PR_STATE" == CLOSED/null ]]; then
        die "PR #$PR_NUMBER was closed without merging."
    fi
    SECONDS_WAITED=$((SECONDS_WAITED + 10))
    if (( SECONDS_WAITED % 60 == 0 )); then
        info "still waiting for merge ($((SECONDS_WAITED / 60))m)"
    fi
    sleep 10
done

# -- Tag the merge commit -----------------------------------------------------

step "Tagging merge commit"

git switch "$DEFAULT_BRANCH" >/dev/null 2>&1
git pull --ff-only "$REPO_REMOTE" "$DEFAULT_BRANCH" --quiet

# The merge commit IS the new HEAD of main (regardless of merge strategy:
# squash/merge-commit/rebase all leave a single new commit at HEAD).
MERGE_SHA=$(git rev-parse HEAD)
info "tagging $MERGE_SHA as $RELEASE_TAG"

git tag -a "$RELEASE_TAG" -m "$NEW_VERSION" "$MERGE_SHA"
git push "$REPO_REMOTE" "$RELEASE_TAG" --quiet
info "tag pushed: $RELEASE_TAG"

# -- Watch release workflow ---------------------------------------------------

if [[ "$WATCH" -eq 1 ]]; then
    step "Watching Release workflow"

    # Find the run that was just triggered.
    sleep 5
    RUN_ID=""
    for _ in 1 2 3 4 5 6; do
        RUN_ID=$(gh run list --workflow=release.yml --limit 1 --json databaseId,headBranch,event \
            --jq ".[] | select(.event == \"push\") | .databaseId" | head -1)
        [[ -n "$RUN_ID" ]] && break
        sleep 5
    done

    if [[ -z "$RUN_ID" ]]; then
        warn "Could not find Release workflow run; check manually: gh run list --workflow=release.yml"
    else
        info "run: https://github.com/$(gh repo view --json nameWithOwner --jq .nameWithOwner)/actions/runs/$RUN_ID"
        if ! gh run watch "$RUN_ID" --exit-status; then
            die "Release workflow failed. Inspect: gh run view $RUN_ID --log-failed" 3
        fi
        info "Release workflow succeeded"
    fi
fi

# -- Verify npm publication ---------------------------------------------------

step "Verifying npm publication"

# npm metadata lags briefly; poll for up to ~30s.
for _ in 1 2 3 4 5 6; do
    if npm view "$PACKAGE_NAME@$NEW_VERSION" version >/dev/null 2>&1; then
        break
    fi
    sleep 5
done

PUBLISHED=$(npm view "$PACKAGE_NAME" dist-tags.latest 2>/dev/null || echo "")
if [[ "$PUBLISHED" != "$NEW_VERSION" ]]; then
    die "npm 'latest' is '$PUBLISHED', expected '$NEW_VERSION'." 4
fi

# Confirm provenance attestation is attached.
HAS_PROVENANCE=$(npm view "$PACKAGE_NAME@$NEW_VERSION" --json 2>/dev/null \
    | node -e "process.stdin.resume(); let d=''; process.stdin.on('data', c => d += c); process.stdin.on('end', () => { try { const j = JSON.parse(d); console.log(j.dist?.attestations ? 'yes' : 'no') } catch { console.log('unknown') } })")

if [[ "$HAS_PROVENANCE" != "yes" ]]; then
    warn "npm publish succeeded but provenance attestation not found ($HAS_PROVENANCE). Check the publish-job logs."
else
    info "provenance attestation present"
fi

# -- Done ---------------------------------------------------------------------

step "$(color_green "Released $NEW_VERSION")"

cat <<EOF
  npm:    https://www.npmjs.com/package/$PACKAGE_NAME/v/$NEW_VERSION
  github: https://github.com/$(gh repo view --json nameWithOwner --jq .nameWithOwner)/releases/tag/$RELEASE_TAG

If the GitHub Release notes don't reflect what shipped (e.g. tag was placed
on a non-merge commit somehow), edit them with:

  gh release edit $RELEASE_TAG --notes "..."
EOF
