// Fixture for the EXPRESS_ROUTE_PARSER_NO_AUTO_INSTRUMENT=1 negative test.
// Run as a Node sub-process with the env var set; the parser should throw
// because the v5 sub-router was constructed without the patch in place.
//
// stdout contract:
//   "THREW: <error.message>\n"  on the expected throw
//   "NO_THROW\n"                if the auto-instrument escape hatch failed

'use strict';

// Defensive: belt-and-suspenders even though the sub-process inherits the env.
process.env.EXPRESS_ROUTE_PARSER_NO_AUTO_INSTRUMENT = '1';

const express = require('express-v5');
const { parseExpressApp } = require('../../../lib');

const app = express();
const router = express.Router();
router.get('/x', (_req, res) => res.send());
app.use('/api/:tenant', router);

try {
  parseExpressApp(app);
  process.stdout.write('NO_THROW\n');
} catch (e) {
  process.stdout.write('THREW: ' + e.message + '\n');
}
