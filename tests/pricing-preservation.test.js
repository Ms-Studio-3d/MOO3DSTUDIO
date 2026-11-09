'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const manifest = require('./pricing-preservation.json');
for (const check of manifest.checks) {
  let source = fs.readFileSync(path.join(__dirname, '..', check.file), 'utf8').replace(/\r\n/g, '\n');
  if (check.stopBefore) {
    const end = source.indexOf(check.stopBefore);
    assert.ok(end >= 0, `${check.file}: boundary missing`);
    source = source.slice(0, end);
  }
  assert.equal(crypto.createHash('sha256').update(source).digest('hex'), check.sha256, `${check.file}: original pricing code changed`);
}
const pkg = require('../package.json');
const lock = require('../package-lock.json');
assert.equal(pkg.version, lock.version);
assert.equal(pkg.version, lock.packages[''].version);
for (const file of ['backup-worker.js', 'backup-safety.js', 'reset-options.js']) assert.ok(pkg.build.files.includes(file), `${file}: missing from packaged app`);
console.log('Original pricing engine and calculation helpers match uploaded source byte-for-byte (SHA-256); package manifest checks passed.');
