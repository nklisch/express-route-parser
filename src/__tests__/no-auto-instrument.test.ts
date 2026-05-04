/**
 * Sub-process tests for the `EXPRESS_ROUTE_PARSER_NO_AUTO_INSTRUMENT=1`
 * escape hatch.
 *
 * Why a sub-process: the auto-instrument side effect runs at module load
 * time inside `src/index.ts`. Any test that imports the lib has already
 * triggered the patch, and the `Router.prototype` mutation is process-wide
 * and persistent. The only honest way to verify the env-var escape hatch
 * is to spawn a fresh Node process with the env var set.
 *
 * The sub-process imports the COMPILED lib (`lib/index.js`) — there's no
 * TS runner installed for child processes (no tsx/ts-node/vite-node), so
 * the test ensures `lib/` exists by running `npm run build` if necessary.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '../..');
const LIB_ENTRY = path.join(ROOT, 'lib', 'index.js');
const FIXTURE_DIR = path.join(__dirname, 'fixtures');

describe('EXPRESS_ROUTE_PARSER_NO_AUTO_INSTRUMENT escape hatch', () => {
  beforeAll(() => {
    // Always rebuild so the sub-process tests run against current source.
    // `lib/` may be stale from a previous build with different source on disk;
    // a stale lib silently produces a misleading test result.
    execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
    if (!existsSync(LIB_ENTRY)) {
      throw new Error(`Build did not produce ${LIB_ENTRY}`);
    }
  }, 60_000);

  it('skips the auto-patch; v5 sub-router parse throws the expected error', () => {
    const out = execFileSync(
      process.execPath,
      [path.join(FIXTURE_DIR, 'no-auto-instrument.cjs')],
      {
        env: { ...process.env, EXPRESS_ROUTE_PARSER_NO_AUTO_INSTRUMENT: '1' },
        encoding: 'utf8',
      },
    );
    expect(out).toMatch(/^THREW: /);
    expect(out).toMatch(/sub-router was constructed before instrumentation/);
  });

  it('manual instrumentExpress5Router() before router construction restores parsing', () => {
    const out = execFileSync(
      process.execPath,
      [path.join(FIXTURE_DIR, 'manual-instrument.cjs')],
      {
        env: { ...process.env, EXPRESS_ROUTE_PARSER_NO_AUTO_INSTRUMENT: '1' },
        encoding: 'utf8',
      },
    );
    expect(out.trim()).toBe('OK: /api/:tenant/x');
  });
});
