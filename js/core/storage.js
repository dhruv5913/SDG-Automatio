(function (root) {
  'use strict';
  var SDG = (root.SDG = root.SDG || {});

  var DB_NAME = 'sdg_automation_db';
  var DB_VERSION = 1;
  var STORE_NAME = 'game_save';
  var SAVE_KEY = 'sdg-game-save-v2';
  var SCHEMA_VERSION = '2.1.0';

  var dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = function (e) {
        resolve(e.target.result);
      };
      req.onerror = function (e) {
        console.warn('IndexedDB open error, falling back to localStorage:', e);
        resolve(null);
      };
    });
    return dbPromise;
  }

  var Storage = {
    SCHEMA_VERSION: SCHEMA_VERSION,

    // Auto-save game state to IndexedDB + sync summary to localStorage
    save: function (state, callback) {
      if (!state) return;
      var data = {
        version: SCHEMA_VERSION,
        timestamp: Date.now(),
        lastStageIdx: typeof state.lastStageIdx === 'number' ? state.lastStageIdx : 0,
        lastMode: state.lastMode || 'easy',
        unlocked: state.unlocked || 1,
        results: state.results || {},
        codes: state.codes || {},
        modes: state.modes || {},
        settings: state.settings || { view3d: true, sound: true }
      };

      // 1. Sync small metadata to localStorage for rapid fallback
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify({
          version: data.version,
          timestamp: data.timestamp,
          lastStageIdx: data.lastStageIdx,
          lastMode: data.lastMode,
          unlocked: data.unlocked,
          results: data.results,
          codes: data.codes,
          modes: data.modes,
          settings: data.settings
        }));
      } catch (e) { /* ignore quota errors */ }

      // 2. Persist comprehensive data into IndexedDB
      openDB().then(function (db) {
        if (!db) {
          if (callback) callback(null, data);
          return;
        }
        try {
          var tx = db.transaction(STORE_NAME, 'readwrite');
          var store = tx.objectStore(STORE_NAME);
          store.put(data, 'current_state');
          tx.oncomplete = function () {
            if (callback) callback(null, data);
          };
          tx.onerror = function (err) {
            console.warn('IndexedDB put error:', err);
            if (callback) callback(null, data); // fallback succeeded
          };
        } catch (e) {
          if (callback) callback(null, data);
        }
      });
    },

    // Load auto-save: checks IndexedDB first, then localStorage
    load: function (callback) {
      openDB().then(function (db) {
        if (!db) {
          Storage._loadFromLocalStorage(callback);
          return;
        }
        try {
          var tx = db.transaction(STORE_NAME, 'readonly');
          var store = tx.objectStore(STORE_NAME);
          var req = store.get('current_state');
          req.onsuccess = function () {
            var res = req.result;
            if (res && res.codes) {
              callback(null, res);
            } else {
              Storage._loadFromLocalStorage(callback);
            }
          };
          req.onerror = function () {
            Storage._loadFromLocalStorage(callback);
          };
        } catch (e) {
          Storage._loadFromLocalStorage(callback);
        }
      });
    },

    _loadFromLocalStorage: function (callback) {
      try {
        var str = localStorage.getItem(SAVE_KEY);
        if (str) {
          var parsed = JSON.parse(str);
          if (parsed && typeof parsed === 'object') {
            callback(null, parsed);
            return;
          }
        }
      } catch (e) { /* ignore */ }
      callback(null, null);
    },

    // Check if player has existing saved progress
    hasProgress: function (data) {
      if (!data) return false;
      if (data.unlocked && data.unlocked > 1) return true;
      if (data.results && Object.keys(data.results).length > 0) return true;
      if (data.codes && Object.keys(data.codes).length > 0) {
        // Check if any code has been customized
        var hasCode = false;
        Object.keys(data.codes).forEach(function (k) {
          if (data.codes[k] && data.codes[k].trim()) hasCode = true;
        });
        if (hasCode) return true;
      }
      return false;
    },

    // Export manual save file as JSON download
    exportSaveFile: function (state) {
      var data = {
        app: 'SDG Automation',
        version: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        lastStageIdx: typeof state.lastStageIdx === 'number' ? state.lastStageIdx : 0,
        lastMode: state.lastMode || 'easy',
        unlocked: state.unlocked || 1,
        results: state.results || {},
        codes: state.codes || {},
        modes: state.modes || {},
        settings: state.settings || { view3d: true, sound: true }
      };

      var jsonStr = JSON.stringify(data, null, 2);
      var blob = new Blob([jsonStr], { type: 'application/json' });
      var url = URL.createObjectURL(blob);

      var now = new Date();
      var dateStr = now.toISOString().slice(0, 10);
      var filename = 'game-save-' + dateStr + '.json';

      var a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      return filename;
    },

    // Validate structure and version of imported save file
    validateSaveData: function (obj) {
      if (!obj || typeof obj !== 'object') {
        return { valid: false, error: 'File content is not a valid JSON object' };
      }
      if (!obj.version) {
        return { valid: false, error: 'Missing save format version in file' };
      }
      if (!obj.codes || typeof obj.codes !== 'object') {
        return { valid: false, error: 'Corrupted save file: missing code entries' };
      }
      if (typeof obj.unlocked !== 'number' && typeof obj.unlocked !== 'undefined') {
        return { valid: false, error: 'Corrupted save file: invalid unlocked stage format' };
      }
      return { valid: true };
    },

    // Parse imported file
    parseSaveFile: function (file, callback) {
      var reader = new FileReader();
      reader.onload = function (e) {
        try {
          var parsed = JSON.parse(e.target.result);
          var check = Storage.validateSaveData(parsed);
          if (!check.valid) {
            callback(new Error(check.error), null);
            return;
          }
          callback(null, parsed);
        } catch (err) {
          callback(new Error('Invalid JSON file. Please select a valid game save file.'), null);
        }
      };
      reader.onerror = function () {
        callback(new Error('Failed to read file from disk'), null);
      };
      reader.readAsText(file);
    },

    // Clear saved progress (for New Game)
    clearAll: function (callback) {
      try {
        localStorage.removeItem(SAVE_KEY);
      } catch (e) { /* ignore */ }

      openDB().then(function (db) {
        if (!db) {
          if (callback) callback();
          return;
        }
        try {
          var tx = db.transaction(STORE_NAME, 'readwrite');
          var store = tx.objectStore(STORE_NAME);
          store.clear();
          tx.oncomplete = function () { if (callback) callback(); };
          tx.onerror = function () { if (callback) callback(); };
        } catch (e) {
          if (callback) callback();
        }
      });
    }
  };

  SDG.Storage = Storage;
})(typeof window !== 'undefined' ? window : globalThis);
