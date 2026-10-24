'use strict';
const assert = require('assert');

// Mock browser globals for Node.js test environment
global.window = global;
global.localStorage = {
  _data: {},
  getItem(k) { return this._data[k] || null; },
  setItem(k, v) { this._data[k] = String(v); },
  removeItem(k) { delete this._data[k]; }
};

require('../js/core/storage.js');
const Storage = global.SDG.Storage;

console.log('Testing SDG.Storage...');

// Test 1: Validation
assert.strictEqual(Storage.validateSaveData(null).valid, false);
assert.strictEqual(Storage.validateSaveData({}).valid, false);
assert.strictEqual(Storage.validateSaveData({ version: '2.1.0' }).valid, false);

const validSave = {
  version: '2.1.0',
  unlocked: 2,
  lastStageIdx: 1,
  lastMode: 'medium',
  results: { stage1: { passed: true, score: 91 } },
  codes: { stage1_medium: 'pump_water()' }
};
assert.strictEqual(Storage.validateSaveData(validSave).valid, true);
console.log('PASS validateSaveData schema check');

// Test 2: hasProgress
assert.strictEqual(Storage.hasProgress(null), false);
assert.strictEqual(Storage.hasProgress({ unlocked: 1, results: {}, codes: {} }), false);
assert.strictEqual(Storage.hasProgress(validSave), true);
console.log('PASS hasProgress detection');

// Test 3: Save and Load via localStorage fallback in node
Storage.save(validSave, (err, saved) => {
  assert.ifError(err);
  assert.strictEqual(saved.lastStageIdx, 1);
  assert.strictEqual(saved.lastMode, 'medium');

  Storage.load((loadErr, loaded) => {
    assert.ifError(loadErr);
    assert.strictEqual(loaded.unlocked, 2);
    assert.strictEqual(loaded.lastStageIdx, 1);
    assert.strictEqual(loaded.lastMode, 'medium');
    assert.strictEqual(loaded.codes.stage1_medium, 'pump_water()');
    console.log('PASS save & load cycle');

    Storage.clearAll(() => {
      Storage.load((cErr, empty) => {
        assert.strictEqual(empty, null);
        console.log('PASS clearAll resets state');
        console.log('\nAll Storage unit tests passed!');
      });
    });
  });
});
