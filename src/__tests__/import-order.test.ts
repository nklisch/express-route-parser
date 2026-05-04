/**
 * Sub-process tests for import-order correctness.
 *
 * G8 — lib loaded first, then user module: parse succeeds.
 * A1 — user module loaded first (constructs a Router), then lib: parse throws.
 *
 * Why sub-process: Router.prototype is patched as a side-effect of importing
 * the lib. Once patched, the patch is process-wide and persistent. The only
 * way to test "what happens when a Router is constructed before the patch"
 * is to spawn a fresh Node process where the patch hasn't run yet.
 *
 * The sub-process requires the COMPILED lib (lib/index.js). We always
 * rebuild in beforeAll so a stale build cannot produce misleading results.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const LIB_ENTRY = path.join(ROOT, 'lib', 'index.js');
const FIXTURE_DIR = path.join(__dirname, 'fixtures');

describe('import order — v5 sub-router patch timing', () => {
  beforeAll(() => {
    execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
    if (!existsSync(LIB_ENTRY)) {
      throw new Error(`Build did not produce ${LIB_ENTRY}`);
    }
  }, 60_000);

  it('G8: lib required before user-routes module — parse succeeds', () => {
    const out = execFileSync(
      process.execPath,
      [path.join(FIXTURE_DIR, 'import-order-good.cjs')],
      { encoding: 'utf8' },
    );
    expect(out.trim()).toBe('OK: /api/:tenant/x');
  });

  it('A1: user-routes module required before lib — parse throws actionable error', () => {
    const out = execFileSync(
      process.execPath,
      [path.join(FIXTURE_DIR, 'import-order-bad.cjs')],
      { encoding: 'utf8' },
    );
    expect(out).toMatch(/^THREW: /);
    expect(out).toMatch(/sub-router was constructed before instrumentation/);
  });
});
