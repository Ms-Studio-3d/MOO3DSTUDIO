'use strict';
// Run with ELECTRON_RUN_AS_NODE=1 using the Electron executable AFTER native rebuild.
if (!process.versions.electron) throw new Error('This test must run inside Electron, not system Node.');
const Driver = require('better-sqlite3');
const probe = new Driver(':memory:');
probe.prepare('SELECT 1 AS ok').get();
probe.close();
console.log(`Native better-sqlite3 loaded successfully in Electron ${process.versions.electron}`);
require('./stability.test.js');
