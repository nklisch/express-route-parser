// Shared fixture: defines and exports a v5 sub-router.
// Used by import-order-good.cjs and import-order-bad.cjs.
// Important: this module requires express-v5 and constructs a Router,
// so the order in which the calling fixture requires THIS module
// relative to requiring express-route-parser determines whether the
// patch is installed before or after Router construction.

'use strict';

const express = require('express-v5');

const router = express.Router();
router.get('/x', (_req, res) => res.send('ok'));

module.exports = { router };
