'use strict';

const io = require('../server/node_modules/socket.io-client');
const assert = require('assert');

const SERVER_URL = 'http://127.0.0.1:3000';
console.log('Running End-to-End Socket.IO Multiplayer Verification against', SERVER_URL);

let hostSocket, guestSocket;
let roomCode = null;

function runTest() {
  return new Promise((resolve, reject) => {
    // 1. Connect Host
    hostSocket = io(SERVER_URL, { timeout: 3000 });

    hostSocket.on('connect', () => {
      console.log('PASS 1. Host connected to Socket.IO server');

      // 2. Host creates room
      hostSocket.emit('create_room', { playerName: 'EcoHost', sessionId: 'sess_host_123' }, (res) => {
        assert(res.success, 'Host room creation must succeed');
        assert(res.code, 'Room code must be provided');
        assert.strictEqual(res.role, 'host', 'Host role must be host');
        roomCode = res.code;
        console.log('PASS 2. Room created with code:', roomCode);

        // 3. Connect Guest
        guestSocket = io(SERVER_URL, { timeout: 3000 });

        guestSocket.on('connect', () => {
          console.log('PASS 3. Guest connected to Socket.IO server');

          // Guest joins room
          guestSocket.emit('join_room', { roomCode, playerName: 'GreenCoder', sessionId: 'sess_guest_456' }, (joinRes) => {
            assert(joinRes.success, 'Guest join must succeed');
            assert.strictEqual(joinRes.role, 'guest', 'Role must be guest');
            console.log('PASS 4. Guest joined room', roomCode);
          });
        });

        // 4. Host receives peer_joined event
        hostSocket.on('peer_joined', (data) => {
          assert.strictEqual(data.name, 'GreenCoder');
          console.log('PASS 5. Host notified of guest join:', data.name);

          // 5. Host changes mode and stage
          hostSocket.emit('set_settings', { mode: 'coop', stageIdx: 2 });
        });

        // 6. Guest receives settings_changed
        guestSocket.on('settings_changed', (settings) => {
          if (settings.mode === 'coop' && settings.stageIdx === 2) {
            console.log('PASS 6. Guest synchronized settings: mode=coop, stageIdx=2');

            // Both set ready
            hostSocket.emit('set_ready', { ready: true });
            guestSocket.emit('set_ready', { ready: true });

            setTimeout(() => {
              // Host starts match
              hostSocket.emit('start_match');
            }, 100);
          }
        });

        // 7. Match start
        guestSocket.on('match_start', (data) => {
          assert.strictEqual(data.mode, 'coop');
          assert.strictEqual(data.stageIdx, 2);
          console.log('PASS 7. Match started synchronized on both players');

          // 8. Send telemetry & co-op action
          guestSocket.emit('telemetry_update', {
            tick: 10,
            score: 75,
            grade: 'B',
            emissions: 18,
            lastAction: 'build_recycler',
            status: 'running'
          });

          guestSocket.emit('coop_action', {
            actionName: 'build_solar_panel',
            args: [1, 2],
            kwargs: {},
            tick: 10
          });
        });

        hostSocket.on('opponent_update', (telemetry) => {
          assert.strictEqual(telemetry.score, 75);
          assert.strictEqual(telemetry.grade, 'B');
          console.log('PASS 8. Host received live telemetry mirror:', telemetry);
        });

        hostSocket.on('coop_action', (coop) => {
          assert.strictEqual(coop.actionName, 'build_solar_panel');
          console.log('PASS 9. Host received shared co-op action:', coop.actionName);

          // 9. Test reconnection: disconnect guest then reconnect with sessionId
          guestSocket.disconnect();

          setTimeout(() => {
            const reconnectedGuest = io(SERVER_URL);
            reconnectedGuest.on('connect', () => {
              reconnectedGuest.emit('reconnect_session', { sessionId: 'sess_guest_456' }, (reconnRes) => {
                assert(reconnRes.success, 'Guest session reconnection must succeed');
                assert.strictEqual(reconnRes.role, 'guest');
                console.log('PASS 10. Guest successfully reconnected using session token');

                // 10. Finish run and calculate verdict
                hostSocket.emit('run_finish', {
                  report: { score: 92, grade: { letter: 'A' }, final: { emissions: 14 } }
                });
                reconnectedGuest.emit('run_finish', {
                  report: { score: 78, grade: { letter: 'B' }, final: { emissions: 25 } }
                });
              });
            });

            hostSocket.on('match_finished', (result) => {
              assert.strictEqual(result.winner, 'host', 'Host with higher score should win');
              console.log('PASS 11. Match finished! Verdict computed by server: winner =', result.winner);

              // Cleanup
              hostSocket.disconnect();
              reconnectedGuest.disconnect();
              console.log('\n======================================================');
              console.log('ALL 11 END-TO-END MULTIPLAYER REAL-TIME TESTS PASSED!');
              console.log('======================================================');
              resolve();
            });
          }, 300);
        });
      });
    });

    hostSocket.on('connect_error', (err) => {
      reject(err);
    });
  });
}

runTest().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
