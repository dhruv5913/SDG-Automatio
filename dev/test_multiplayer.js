// Multiplayer unit test — node dev/test_multiplayer.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
globalThis.SDG = {};

// Load multiplayer script
const mpCode = fs.readFileSync(path.join(root, 'js/core/multiplayer.js'), 'utf8');
vm.runInThisContext(mpCode);

const SDG = globalThis.SDG;
let pass = 0, fail = 0;

function assert(name, condition) {
  if (condition) {
    pass++;
    console.log('PASS ' + name);
  } else {
    fail++;
    console.error('FAIL ' + name);
  }
}

console.log('Testing SDG.Multiplayer core logic...');

// 1. Singleton initialization
assert('SDG.Multiplayer exists', !!SDG.Multiplayer);
assert('Default mode is race', SDG.Multiplayer.mode === 'race');

// 2. Duel verdict evaluation
const reportA = { score: 85, grade: { letter: 'A' }, emissions: 20 };
const reportB = { score: 72, grade: { letter: 'B' }, emissions: 35 };
const verdict1 = SDG.Multiplayer.getDuelVerdict(reportA, reportB);
assert('Duel verdict win when score higher', verdict1 && verdict1.result === 'win' && verdict1.myScore === 85);

const verdict2 = SDG.Multiplayer.getDuelVerdict(reportB, reportA);
assert('Duel verdict loss when score lower', verdict2 && verdict2.result === 'loss');

// Tie breaker: lower emissions wins
const reportC1 = { score: 80, grade: { letter: 'B' }, emissions: 15 };
const reportC2 = { score: 80, grade: { letter: 'B' }, emissions: 30 };
const verdictTie = SDG.Multiplayer.getDuelVerdict(reportC1, reportC2);
assert('Duel tie-breaker awards win to lower emissions', verdictTie && verdictTie.result === 'win');

// 3. Message handling simulation between two mock instances
const host = new SDG.Multiplayer.constructor();
host.playerName = 'Alice';
host.role = 'host';
host.mode = 'race';
host.stageIdx = 1;

const guest = new SDG.Multiplayer.constructor();
guest.playerName = 'Bob';
guest.role = 'guest';

// Mock transport loopback
host.transport.send = function (msg) {
  guest._handleMessage(JSON.parse(JSON.stringify(msg)));
};
guest.transport.send = function (msg) {
  host._handleMessage(JSON.parse(JSON.stringify(msg)));
};

let hostPeerJoined = false;
let guestSettingsReceived = false;

host.on('peer_joined', function (data) {
  hostPeerJoined = true;
});
guest.on('settings_changed', function (data) {
  guestSettingsReceived = true;
});

// Guest sends HELLO
guest.send({ type: 'HELLO', name: guest.playerName, role: guest.role, mode: guest.mode, stageIdx: guest.stageIdx });

assert('Host received peer_joined with Bob', hostPeerJoined && host.peerName === 'Bob');
assert('Guest received WELCOME and updated stageIdx', guestSettingsReceived && guest.stageIdx === 1);

// 4. Test telemetry updates
let telemetryReceived = false;
host.on('opponent_update', function (opp) {
  telemetryReceived = (opp.score === 90 && opp.grade === 'A');
});
guest.sendTelemetry('running', 42, 90, 'A', 12, 'plant_crop');
assert('Host received opponent telemetry update', telemetryReceived);

// 5. Test Co-op action
let coopActionReceived = null;
host.on('coop_action', function (act) {
  coopActionReceived = act;
});
guest.sendCoopAction('pump_water', [2], {}, 15);
assert('Host received coop action', coopActionReceived && coopActionReceived.actionName === 'pump_water');

// 6. Test Turn pass
let turnPassedReceived = null;
host.on('turn_passed', function (ev) {
  turnPassedReceived = ev;
});
guest.sendTurnPass({ tick: 25, population: 100 }, 15);
assert('Host received turn pass and round incremented', turnPassedReceived && host.turnState.guestScore === 15);

console.log(`\nResults: ${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
