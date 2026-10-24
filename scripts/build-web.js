'use strict';

// Copies the static web game into www/ for the Capacitor Android wrapper.
// The root folder stays the canonical source of the browser build.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'www');

const files = ['index.html'];
const dirs = ['css', 'js'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const file of files) {
  fs.copyFileSync(path.join(root, file), path.join(out, file));
}
for (const dir of dirs) {
  fs.cpSync(path.join(root, dir), path.join(out, dir), { recursive: true });
}

console.log('web build copied to ' + out);