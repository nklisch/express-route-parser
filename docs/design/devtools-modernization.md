# Design: Devtools Modernization

## Overview

This design replaces the project's stale dev tooling with current 2026 stable
releases. **Zero published-API surface changes are intended** — the `lib/`
output should be byte-equivalent to `1.0.6` (modulo any TypeScript 6 declaration
ordering churn, which is monitored as part of acceptance).

Scope:

- Jest 28 + ts-jest → **Vitest 4**
- TypeScript 4.7 → **TypeScript 6.0**
- ESLint 8 (.eslintrc.js) → **ESLint 10 (flat config)**
- Prettier 2 → **Prettier 3**
- Add **`expectTypeOf` type tests** to pin the public API's type shape
- Drop dead deps (`eslint-plugin-react`, `tslint-config-prettier`,
  `eslint-plugin-prefer-arrow`)

Out of scope (already shipped in `1.0.6`):

- CI matrix update (Node 20/22/24) — done in `.github/workflows/ci.yml`
- `engines.node` field — present, currently `>=18`. **Bumping to `>=20` is
  proposed in this design** because Vitest 4 and ESLint 10 require Node 20+
  for development. See Q1 below.

## Verified Facts (2026-05-03, queried directly from npm registry)

Do not substitute training-memory values for these; the major-version landscape
is current as of design time.

| Package                              | Latest stable | Node engines                            |
| ------------------------------------ | ------------- | --------------------------------------- |
| `typescript`                         | **6.0.3**     | `>=14.17`                               |
| `vitest`                             | **4.1.5**     | `^20.0.0 \|\| ^22.0.0 \|\| >=24.0.0`    |
| `@vitest/coverage-v8`                | **4.1.5**     | (matches `vitest`)                      |
| `eslint`                             | **10.3.0**    | `^20.19.0 \|\| ^22.13.0 \|\| >=24`      |
| `typescript-eslint` (unified pkg)    | **8.59.1**    | (typescript-eslint v8 line)             |
| `prettier`                           | **3.8.3**     | `>=14`                                  |
| `eslint-plugin-jsdoc`                | **62.9.0**    | (flat config supported)                 |
| `eslint-config-prettier`             | **10.1.8**    | (flat config supported, v10+)           |
| `eslint-plugin-prefer-arrow-functions` | **3.9.1**   | peer `eslint: >=9.17.0` (flat config)   |

**ESLint 10 fully removes `.eslintrc.*` support** — there is no longer a
backward-compat path. We must migrate to flat config; this is no longer
optional.

**TypeScript 6 breaking changes affecting us (none, but worth noting)**:
- Removed `moduleResolution: "classic"` — we don't use it.
- `esModuleInterop` and `allowSyntheticDefaultImports` cannot be set to false —
  ours is true, fine.
- `target: "es5"` and `"es3"` deprecated — ours is `es6`, fine.
- Type-ID ordering changed for declaration emit; may affect `lib/index.d.ts`
  byte-content. Behaviorally identical, but byte-diff'able. Monitor in
  acceptance.

**The `eslint-plugin-prefer-arrow` package is dead** (last published 2021-01,
peer `eslint >=2.0.0`, no flat-config support). Replaced by
`eslint-plugin-prefer-arrow-functions@3.9.1` which targets `eslint >=9.17.0`
(flat config native). Rule name changes from `prefer-arrow/prefer-arrow-functions`
to `prefer-arrow-functions/prefer-arrow-functions`.

## Open Questions

### Q1: Bump `engines.node` from `>=18` to `>=20`?

**Recommendation: yes, bump to `>=20`.**

Reasons:
- Node 18 reached end-of-maintenance April 2025 (≈13 months ago as of design time).
- Our CI matrix already only tests Node 20/22/24 — we don't actually verify the package on 18.
- Vitest 4 and ESLint 10 both require Node 20+ for **development**. Keeping `engines.node: ">=18"` while requiring Node 20+ to develop produces a confusing split.
- Aligns the consumer floor with the dev/CI floor. One mental model.

Risk: a consumer running Node 18 will see an `EBADENGINE` warning on install (not a hard failure unless they've enabled strict-engines). That's a soft, intentional signal.

This is a minor-version-bump worthy change (semver-minor for engines tightening). Recommend version bump to `1.1.0` when this design lands.

### Q2: Vitest globals (no test-file changes) or explicit imports?

**Recommendation: globals.**

Vitest supports a `globals: true` option that exposes `describe`, `it`, `expect`, `beforeEach`, etc. as globals — Jest-compatible. The existing test files use these without imports; setting `globals: true` keeps them working unchanged.

The alternative — adding `import { describe, it, expect, beforeEach } from 'vitest'` to every test file — is more explicit but requires touching every test file. For a small project with two test files, both options are fine. Globals wins on minimum-diff.

The type tests (Unit 5) need an explicit `import { expectTypeOf, test } from 'vitest'` regardless, because `expectTypeOf` is not a global even with `globals: true`.

### Q3: Keep coverage in default `npm test`?

**Recommendation: yes, preserve current behavior.**

The current Jest config runs with `--collectCoverage`. Vitest's equivalent is `vitest run --coverage`. Keeping coverage on by default in `npm test` matches existing behavior; a `test:fast` script for non-coverage runs can be added later if the maintainer wants it.

### Q4: Version bump on landing?

**Recommendation: `1.1.0` minor bump.**

Rationale:
- `engines.node` tightens from `>=18` to `>=20` — semver convention says minor bump.
- TypeScript 6's declaration-emit ordering may produce a byte-different `lib/index.d.ts` even with no API changes; consumers' type cache may invalidate. Better to signal change with a minor than slip it into a patch.
- All other changes are internal (devDeps, configs) and don't affect consumers.

## Implementation Units

### Unit 1: `package.json` — devDeps, scripts, engines

**File**: `package.json`

```jsonc
{
  // unchanged: name, version (will be 1.1.0 at release time), description,
  //            main, types, repository, funding, keywords, author, license,
  //            files, bugs, homepage, peerDependencies
  "scripts": {
    "test": "vitest run --coverage",
    "test:watch": "vitest",
    "build": "tsc",
    "format": "prettier --write \"src/**/*.ts\"",
    "format:check": "prettier --check \"src/**/*.ts\"",
    "lint": "eslint src",
    "lint-fix": "eslint src --fix",
    "prepare": "npm run build",
    "prepublishOnly": "npm test && npm run lint",
    "preversion": "npm run lint",
    "version": "npm run format && git add -A src",
    "postversion": "git push --follow-tags"
  },
  "devDependencies": {
    "@types/express": "^4.17.13",
    "@types/node": "^22.0.0",
    "@vitest/coverage-v8": "^4.1.5",
    "eslint": "^10.3.0",
    "eslint-config-prettier": "^10.1.8",
    "eslint-plugin-jsdoc": "^62.9.0",
    "eslint-plugin-prefer-arrow-functions": "^3.9.1",
    "express": "^4.18.1",
    "prettier": "^3.8.3",
    "typescript": "^6.0.3",
    "typescript-eslint": "^8.59.1",
    "vitest": "^4.1.5"
  },
  "peerDependencies": {
    "@types/express": "^4.x",
    "express": "^4.x"
  },
  "engines": {
    "node": ">=20"
  }
}
```

**What's removed**:

- `@types/jest` — Vitest has its own types
- `jest`, `ts-jest` — replaced by Vitest
- `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser` — replaced by unified `typescript-eslint` package
- `eslint-plugin-prefer-arrow` — dead, replaced by `eslint-plugin-prefer-arrow-functions`
- `eslint-plugin-react` — was unused (project has no React)
- `tslint-config-prettier` — TSLint is dead

**What's added**:

- `vitest`, `@vitest/coverage-v8` — replaces Jest/ts-jest
- `typescript-eslint` (unified package) — replaces the split `@typescript-eslint/*` v5 packages
- `eslint-plugin-prefer-arrow-functions` — replaces dead `eslint-plugin-prefer-arrow`
- `@types/node` — needed for Vitest config (uses `node:path` etc. transitively); pin to LTS-aligned `^22.0.0`

**Implementation Notes**:

- Keep all caret ranges; let lockfile pin exact versions on `npm install`.
- The `lint` script drops `-c .eslintrc.js --ext .ts` flags. Flat config is auto-discovered (`eslint.config.js`) and ESLint 10 uses globs from the config itself; the `--ext` flag is gone in flat config.
- `format:check` is a new script that fails if files aren't formatted (suitable for CI). `format` continues to be the write-mode for local use.
- `engines.node` bumps to `>=20`. See Q1.

**Acceptance Criteria**:

- [ ] `npm install` succeeds with no peer-dep warnings (other than benign `eslint-plugin-jsdoc` warnings if any).
- [ ] No `jest`, `ts-jest`, `@types/jest`, `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`, `eslint-plugin-prefer-arrow`, `eslint-plugin-react`, or `tslint-config-prettier` in `node_modules` after install.
- [ ] `engines.node` is `">=20"`.

---

### Unit 2: `eslint.config.js` — flat-config replacement

**File**: `eslint.config.js` (new, ESM via `.js` with `export default`; works in CJS package because flat config files are evaluated by ESLint's loader, not Node's require)

```javascript
// @ts-check
import tseslint from 'typescript-eslint';
import preferArrowFunctions from 'eslint-plugin-prefer-arrow-functions';
import jsdoc from 'eslint-plugin-jsdoc';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  // Ignore patterns (replaces .eslintignore)
  {
    ignores: ['lib/**', 'coverage/**', 'node_modules/**'],
  },

  // Base recommended configs
  ...tseslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  // Project-wide config
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'prefer-arrow-functions': preferArrowFunctions,
      jsdoc: jsdoc,
    },
    rules: {
      // typescript-eslint rules carried forward from .eslintrc.js
      '@typescript-eslint/array-type': ['error', { default: 'array' }],
      '@typescript-eslint/consistent-type-assertions': 'error',
      '@typescript-eslint/dot-notation': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/naming-convention': 'error',
      '@typescript-eslint/no-empty-function': 'error',
      '@typescript-eslint/no-empty-interface': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-misused-new': 'error',
      '@typescript-eslint/no-namespace': 'error',
      '@typescript-eslint/no-shadow': ['error', { hoist: 'all' }],
      '@typescript-eslint/no-unused-expressions': 'error',
      '@typescript-eslint/no-var-requires': 'error',
      '@typescript-eslint/prefer-for-of': 'error',
      '@typescript-eslint/prefer-function-type': 'error',
      '@typescript-eslint/prefer-namespace-keyword': 'error',
      '@typescript-eslint/triple-slash-reference': [
        'error',
        { path: 'always', types: 'prefer-import', lib: 'always' },
      ],
      '@typescript-eslint/unified-signatures': 'error',

      // Replaced: ban-types is split in typescript-eslint v8 into multiple rules.
      // Use no-restricted-types for the original Object/Function/Boolean/etc bans.
      '@typescript-eslint/no-restricted-types': [
        'error',
        {
          types: {
            Object: { message: 'Avoid using `Object`. Did you mean `object`?' },
            Function: {
              message: 'Avoid `Function`. Prefer a specific function type, like `() => void`.',
            },
            Boolean: { message: 'Avoid `Boolean`. Did you mean `boolean`?' },
            Number: { message: 'Avoid `Number`. Did you mean `number`?' },
            String: { message: 'Avoid `String`. Did you mean `string`?' },
            Symbol: { message: 'Avoid `Symbol`. Did you mean `symbol`?' },
          },
        },
      ],

      // Core ESLint rules carried forward
      'constructor-super': 'error',
      'dot-notation': 'error',
      eqeqeq: ['error', 'smart'],
      'guard-for-in': 'error',
      'id-denylist': [
        'error',
        'any',
        'Number',
        'number',
        'String',
        'string',
        'Boolean',
        'boolean',
        'Undefined',
        'undefined',
      ],
      'id-match': 'error',
      'max-classes-per-file': ['error', 1],
      'no-bitwise': 'error',
      'no-caller': 'error',
      'no-cond-assign': 'error',
      'no-console': 'error',
      'no-debugger': 'error',
      'no-empty': 'error',
      'no-empty-function': 'error',
      'no-eval': 'error',
      'no-new-wrappers': 'error',
      'no-throw-literal': 'error',
      'no-undef-init': 'error',
      'no-underscore-dangle': 'error',
      'no-unsafe-finally': 'error',
      'no-unused-expressions': 'error',
      'no-unused-labels': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'one-var': ['error', 'never'],
      'prefer-const': 'error',
      radix: 'error',
      'spaced-comment': ['error', 'always', { markers: ['/'] }],
      'use-isnan': 'error',

      // Replacement plugin for the dead eslint-plugin-prefer-arrow
      'prefer-arrow-functions/prefer-arrow-functions': 'error',

      // jsdoc rules carried forward (newline-after-description was deprecated;
      // dropped — its replacement is `tag-lines` which is more granular)
      'jsdoc/check-alignment': 'error',
      'jsdoc/check-indentation': 'error',
    },
  },

  // Test files: relax type-checked rules for test ergonomics
  {
    files: ['src/**/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },

  // Prettier compat — must be last to override stylistic conflicts
  prettierConfig,
);
```

**Implementation Notes**:

- **Why ESM in a CJS package**: ESLint flat config files are loaded by ESLint's own loader, not Node's `require()`. ESLint supports `eslint.config.js` with `export default` even in CJS packages. Alternative: `eslint.config.mjs`. Use `.js` because the project's `package.json` doesn't have `"type": "module"`, and ESLint 10 specifically allows `.js` flat-config in CJS projects.
- **`projectService: true`** is the modern type-aware-linting setup in typescript-eslint v8 — replaces the old `project: 'tsconfig.eslint.json'` pattern. Auto-discovers projects via TypeScript's project service. **This eliminates the need for `tsconfig.eslint.json`**, which is deleted in Unit 7.
- **`tseslint.config()` helper** is the official typed config builder from typescript-eslint v8. It accepts arrays/objects and returns a flat array. Provides type-checking on rule names.
- **`tseslint.configs.recommended` and `recommendedTypeChecked`** are the v8 equivalents of the old `'plugin:@typescript-eslint/recommended'` + `'plugin:@typescript-eslint/recommended-requiring-type-checking'` extends. Names align.
- **Test-files override block** consolidates the per-file `/* eslint-disable */` comments currently scattered across `src/__tests__/parser.test.ts` and `src/__tests__/example.test.ts`. With the test-files override, those comments can be removed (Unit 6).
- **`ban-types` is split** in typescript-eslint v8. The original rule's "type bans" (Object, Function, etc.) are now `no-restricted-types`. Carried forward verbatim.
- **`jsdoc/newline-after-description`** is deprecated in eslint-plugin-jsdoc v50+. Dropped (the replacement `tag-lines` is more granular; not needed for this codebase's minimal JSDoc).
- The huge list of `"off"` rules in the old `.eslintrc.js` is dropped — they were cargo-culted from `tslint-to-eslint-config`'s autogenerator and are noise.

**Acceptance Criteria**:

- [ ] `npm run lint` runs against `src/` and produces no errors.
- [ ] `npm run lint` reports the same set of issues that `eslint-plugin-prefer-arrow` would have caught (verifiable by introducing a non-arrow function in src/ and observing failure).
- [ ] No `tsconfig.eslint.json` is referenced anywhere.
- [ ] Type-aware rules (e.g. `@typescript-eslint/no-unsafe-call`) still fire for src/ but are silent for test files.

---

### Unit 3: `vitest.config.ts` — replaces `jestconfig.json`

**File**: `vitest.config.ts` (new)

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/__tests__/**/*.{test,spec}.{ts,tsx}', 'src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**', 'src/**/*.{test,spec}.ts'],
      reporter: ['text', 'html', 'lcov'],
    },
  },
});
```

**Implementation Notes**:

- **`globals: true`** — exposes `describe`, `it`, `expect`, `beforeEach` etc. as globals so existing test files need no import changes. See Q2.
- **`include`** mirrors the original Jest `testRegex`. The original regex matched `__tests__/.*` plus `*.test.*`/`*.spec.*` anywhere; the Vitest globs cover both.
- **`coverage.provider: 'v8'`** — uses native V8 coverage (faster than istanbul, no instrumentation). Requires `@vitest/coverage-v8` peer.
- **Coverage `include`/`exclude`** carries forward Jest's `collectCoverageFrom: ['src/**/*']` minus test files (Vitest counts test files in coverage by default; we exclude them).
- The config file is **TypeScript** — Vite-loaded, so it works without a separate transpile step regardless of the project's `"type"` field.

**Acceptance Criteria**:

- [ ] `npm test` runs all 30 existing tests and passes.
- [ ] Coverage report is produced (terminal output + `coverage/` dir).
- [ ] No imports needed in existing test files (`describe`/`it`/`expect` continue to work as globals).

---

### Unit 4: `tsconfig.json` updates

**File**: `tsconfig.json`

```jsonc
{
  "compilerOptions": {
    "target": "es6",
    "module": "commonjs",
    "declaration": true,
    "outDir": "./lib",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "types": ["vitest/globals", "node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules/**/*", "**/__tests__/**/*", "lib/**/*"]
}
```

**Implementation Notes**:

- **One added line**: `"types": ["vitest/globals", "node"]` — required for `it`, `expect`, etc. to type-check at the source-file level when used as globals (Q2).
- **`target: es6`** stays — TypeScript 6 still supports it (ES2015 = ES6 = `es6`). The `target: es5`/`es3` deprecations don't affect us.
- **`module: commonjs`** stays — published lib continues as CJS.
- **`exclude` adds `lib/**/*`** for safety; previously omitted but `outDir` content shouldn't be re-fed into the compiler.
- **No `moduleResolution` field** — defaults to `"node"` for `module: commonjs`, which TS 6 still supports (the `"classic"` removal doesn't affect us).

**Acceptance Criteria**:

- [ ] `npm run build` produces `lib/index.js`, `lib/index.d.ts`, `lib/express-parser/index.js`, `lib/types/index.js`, etc. — same set as 1.0.6.
- [ ] `lib/index.d.ts` exports the same identifiers as 1.0.6 (`parseExpressApp`, `Route`, `Layer`, `ExpressRegex`, `RouteMetaData`, `Parameter`, `Key`).
- [ ] **Byte-content of `lib/` may differ** from 1.0.6 due to TS 6 type-ID ordering changes; that's acceptable as long as the type-level surface is equivalent. See Verification Checklist for the diff procedure.

---

### Unit 5: Public API type tests

**File**: `src/__tests__/types.test-d.ts` (new)

```typescript
import { describe, expectTypeOf, it } from 'vitest';
import type {
  ExpressRegex,
  Key,
  Layer,
  Parameter,
  Route,
  RouteMetaData,
} from '../index';
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
    // Allows arbitrary extra string keys
    expectTypeOf<Parameter['extra' & string]>().toEqualTypeOf<any>();
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
```

**Implementation Notes**:

- **File extension `.test-d.ts`** is a Vitest convention for type-only tests — the suffix is recognized but doesn't actually change behavior; runtime assertions still execute. Use the suffix to signal intent.
- **`expectTypeOf` is type-only**. It performs compile-time type-equality and shape checks. Tests pass if the types match; they fail at *typecheck time* with a TS error if they don't. So `npm run build` is what surfaces these failures, not `npm test` per se. But Vitest will also catch them when running.
- **`toMatchObjectType` instead of `toEqualTypeOf`** for `RouteMetaData` and `Parameter` — `Parameter` has `[key: string]: any`, so strict equality with an object literal won't match. `toMatchObjectType` checks the documented shape is present without requiring exhaustive equality.
- The `Parameter['extra' & string]` line verifies the index signature — a small extra check.

**Acceptance Criteria**:

- [ ] `npm test` includes `types.test-d.ts` in its run (verifiable by output).
- [ ] All assertions pass against the current `src/index.ts` exports.
- [ ] If someone changes `RouteMetaData['method']` from `string` to e.g. `'get' | 'post'`, the type test fails at typecheck time. Manually verify by introducing the change and observing the failure.

---

### Unit 6: Source code adjustments

**File**: `src/express-parser/index.ts`, `src/__tests__/parser.test.ts`, `src/__tests__/example.test.ts`

The existing per-file `/* eslint-disable ... */` headers reference rules that are now scoped:

- **`src/express-parser/index.ts`** keeps its disables (they're for src code, not tests):

  ```typescript
  /* eslint-disable @typescript-eslint/no-unsafe-call */
  /* eslint-disable @typescript-eslint/no-unsafe-member-access */
  /* eslint-disable no-underscore-dangle */
  /* eslint-disable @typescript-eslint/no-unsafe-assignment */
  ```

  Verify each is still triggered by removing it temporarily and seeing the lint failure. Drop any that no longer fire (e.g., `restrict-plus-operands` — verify if still needed).

- **`src/__tests__/parser.test.ts`** and **`src/__tests__/example.test.ts`**: the eslint-disable headers can be **removed entirely** because the test-files override block in `eslint.config.js` (Unit 2) globally relaxes those rules for tests.

**Implementation Notes**:

- This unit is mechanical cleanup. Run lint, see what fires, adjust comments minimally.
- The src/ disables exist because the parser does deep introspection of Express's internal layer/route structures, which are typed loosely (`any`-ish in `@types/express`). The disables are load-bearing.

**Acceptance Criteria**:

- [ ] `src/__tests__/*.test.ts` files have **no eslint-disable comments** at top.
- [ ] `src/express-parser/index.ts` retains only the eslint-disable comments necessary to lint-clean (verified by toggling each).
- [ ] `npm run lint` clean.

---

### Unit 7: Cleanup — delete obsolete files

**Files to delete**:

- `.eslintrc.js`
- `tsconfig.eslint.json`
- `jestconfig.json`

**Implementation Notes**:

- These files have functioning replacements in Units 2, 3, and 4 (tsconfig.eslint.json is no longer needed thanks to `projectService: true`).
- ESLint 10 fully ignores `.eslintrc.*`, but leaving the file would be a confusing artifact — delete to avoid future maintainer confusion.

**Acceptance Criteria**:

- [ ] `test ! -f .eslintrc.js`
- [ ] `test ! -f tsconfig.eslint.json`
- [ ] `test ! -f jestconfig.json`
- [ ] `npm run lint && npm test && npm run build` all pass after deletion.

---

## Implementation Order

Strict dependency order:

1. **Unit 1** — `package.json`. Establishes the dep set; `npm install` afterwards pulls new tooling.
2. **Unit 4** — `tsconfig.json`. Quick edit; doesn't break anything but enables Unit 3's globals.
3. **Unit 3** — `vitest.config.ts`. Tests can now run.
4. **Unit 2** — `eslint.config.js`. Lint can now run.
5. **Unit 6** — Source eslint-disable cleanup.
6. **Unit 5** — Type tests (`types.test-d.ts`).
7. **Unit 7** — Delete obsolete config files.
8. **Verification** — Full `lint && build && test`, plus `lib/` diff vs 1.0.6 (see checklist).

Why this order: tests run before lint runs before cleanup, so each step's verification is meaningful — if vitest.config breaks, you find out before refactoring lint config; if lint config breaks, you find out before deleting the old one.

## Testing

### Unit Tests

All existing tests in `src/__tests__/parser.test.ts` and `src/__tests__/example.test.ts` continue to pass unchanged (Vitest API is Jest-compatible for the surface this project uses).

### Type Tests: `src/__tests__/types.test-d.ts`

Six test cases pinning:

1. `parseExpressApp` parameter and return types
2. `RouteMetaData` object shape
3. `Parameter` object shape + index signature
4. `Key` exact equality
5. `ExpressRegex` extends RegExp + fast-path flag types
6. `Route` and `Layer` smoke check

These run as part of `npm test`. Failure modes:
- **Compile failure**: type test asserts something that's no longer true → TS error → Vitest treats as test failure.
- **Runtime pass**: `expectTypeOf` calls have no runtime effect, so passing the type check passes the test.

### Coverage

Coverage stays on by default in `npm test`. The HTML report lands in `coverage/` (added to `.gitignore` if not already).

## Verification Checklist

```bash
# Unit 1: deps
node -e "const p=require('./package.json'); if(p.engines.node !== '>=20') process.exit(1)"
npm ls jest 2>&1 | grep -q '(empty)' && echo OK || echo "jest still installed"
npm ls @typescript-eslint/eslint-plugin 2>&1 | grep -q '(empty)' && echo OK
npm ls eslint-plugin-react 2>&1 | grep -q '(empty)' && echo OK

# Units 2, 3, 4: configs run
npm run lint
npm test
npm run build

# Unit 5: type tests pinned
grep -q 'expectTypeOf' src/__tests__/types.test-d.ts

# Unit 7: old files gone
test ! -f .eslintrc.js
test ! -f tsconfig.eslint.json
test ! -f jestconfig.json

# Lib/ diff vs 1.0.6 — surfaces any TS-6 declaration churn
git diff v1.0.6 -- lib/
# Acceptable: byte differences in lib/index.d.ts due to type-ID ordering.
# Not acceptable: missing exports, changed function signatures, narrowed types.
# Spot-check by importing in a smoke project; or run the type tests against
# the published lib/.

# Format check
npm run format:check
```

## Hardening Options (Not Implemented Now)

- **Pin to exact versions** instead of caret ranges — reduces lockfile churn and ensures CI reproducibility but increases manual upgrade friction. Tradeoff worth revisiting.
- **Add `arethetypeswrong` check** to CI — verifies the published `lib/index.d.ts` is consumable from both ESM and CJS consumers. Not strictly needed for a CJS-only package but cheap.
- **Switch to `tsup` or similar for dual ESM+CJS** — out of scope; would belong in a separate "ESM publishing" design.
- **Replace `globals: true` with explicit imports** in test files — better for tree-shaking and ESM purity, but requires editing every test file. Worth doing later.
- **Add Husky / lint-staged** — runs lint+format on commit. Useful for solo maintainers; overkill for now.
- **Snapshot test the `.d.ts` output** — would catch any future declaration drift programmatically rather than by manual diff.

## References

- TypeScript 6.0 release notes: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html
- ESLint 10 migration: https://eslint.org/docs/latest/use/migrate-to-10.0.0
- typescript-eslint v8 flat config guide: https://typescript-eslint.io/getting-started/
- Vitest config docs: https://vitest.dev/config/
- `expectTypeOf` reference: https://vitest.dev/api/expect-typeof.html
- `eslint-plugin-prefer-arrow-functions`: https://www.npmjs.com/package/eslint-plugin-prefer-arrow-functions
