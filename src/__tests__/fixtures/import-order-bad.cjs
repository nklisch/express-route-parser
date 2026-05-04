// Fixture for the A1 (broken import order) test.
// The user module is required FIRST, constructing a Router and mounting it
// BEFORE the express-route-parser patch is installed. The lib is then
// required LATE — the patch installs, but the mount layer was already
// recorded without the [ORIGINAL_PATH] symbol, so parseExpressApp throws.
//
// This is distinct from no-auto-instrument.cjs — that fixture uses the
// env var to disable the patch. This fixture tests the pure import-order
// failure mode (no env var; the patch just installs too late).
//
// stdout contract:
//   "THREW: <error.message>\n"  on the expected throw
//   "NO_THROW\n"                if the library failed to detect the bad state

'use strict';

// 1. Load express-v5 and construct + mount the router BEFORE our lib loads.
//    The patch hasn't run yet at this point, so app.use() doesn't capture
//    the mount path with [ORIGINAL_PATH].
const express = require('express-v5');
const app = express();
const { router } = require('./v5-routes-module.cjs');
app.use('/api/:tenant', router);

// 2. Require the lib LATE — patch installs now, but the layer above was
//    already written to app's stack without [ORIGINAL_PATH].
const { parseExpressApp } = require('../../../lib');

try {
  parseExpressApp(app);
  process.stdout.write('NO_THROW\n');
} catch (e) {
  process.stdout.write('THREW: ' + e.message + '\n');
}
