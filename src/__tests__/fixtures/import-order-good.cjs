// Fixture for the G8 (working import order) test.
// The lib is required FIRST so the Router.prototype patch is in place,
// then the user routes module is loaded (which constructs a Router),
// then the app is created and the router is mounted.
// This is the recommended pattern.
//
// stdout contract:
//   "OK: <comma-joined paths>\n"  on success
//   "THREW: <error.message>\n"    if something unexpected blew up

'use strict';

// 1. Require the lib first — this installs the Router.prototype patch
const { parseExpressApp } = require('../../../lib');

// 2. Now require the user module that constructs a Router (patch is active)
const { router } = require('./v5-routes-module.cjs');

// 3. Create the app and mount the router
const express = require('express-v5');
const app = express();
app.use('/api/:tenant', router);

try {
  const routes = parseExpressApp(app);
  process.stdout.write('OK: ' + routes.map((r) => r.path).join(',') + '\n');
} catch (e) {
  process.stdout.write('THREW: ' + e.message + '\n');
}
