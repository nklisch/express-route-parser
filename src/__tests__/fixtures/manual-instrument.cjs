// Fixture for the manual-instrumentation path. With the env var set the
// auto-patch is skipped, but `instrumentExpress5Router()` must still work
// when called BEFORE `express-v5` is required.
//
// stdout contract:
//   "OK: <comma-joined paths>\n"  on success
//   "THREW: <error.message>\n"    if the manual call didn't take effect

'use strict';

process.env.EXPRESS_ROUTE_PARSER_NO_AUTO_INSTRUMENT = '1';

// Require the lib first so the side-effect import runs (it should be a no-op
// thanks to the env var), then call instrumentExpress5Router() explicitly
// BEFORE requiring express-v5 / constructing any routers.
const { instrumentExpress5Router, parseExpressApp } = require('../../../lib');
instrumentExpress5Router();

const express = require('express-v5');

const app = express();
const router = express.Router();
router.get('/x', (_req, res) => res.send());
app.use('/api/:tenant', router);

try {
  const routes = parseExpressApp(app);
  process.stdout.write('OK: ' + routes.map((r) => r.path).join(',') + '\n');
} catch (e) {
  process.stdout.write('THREW: ' + e.message + '\n');
}
