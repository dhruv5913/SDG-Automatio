(function (root) {
  'use strict';
  var SDG = (root.SDG = root.SDG || {});
  var MP = SDG.Multiplayer;

  function $(id) { return document.getElementById(id); }

  function MultiplayerUI() {
    this.localReport = null;
    this.opponentReport = null;
    this.duelVerdict = null;
    this.myScore = 0;
    this.myGrade = '–';
  }

  MultiplayerUI.prototype.init = function () {
    var self = this;
    if (!MP) return;

    this._bindDOM();
    this._bindMultiplayerEvents();
    this._checkUrlJoinCode();
  };

  MultiplayerUI.prototype._bindDOM = function () {
    var self = this;

    // Topbar Multiplayer button
    var btnMp = $('btnMultiplayer');
    if (btnMp) {
      btnMp.addEventListener('click', function () {
        self.openModal();
      });
    }

    // Modal Close
    var modalClose = $('mpModalClose');
    if (modalClose) {
      modalClose.addEventListener('click', function () {
        $('multiplayerModal').classList.add('hidden');
      });
    }

    // Host room button
    var btnHost = $('btnMpHost');
    if (btnHost) {
      btnHost.addEventListener('click', function () {
        var nameInput = $('mpPlayerName');
        if (nameInput && nameInput.value.trim()) {
          MP.playerName = nameInput.value.trim();
        }
        btnHost.disabled = true;
        btnHost.textContent = 'Creating Room...';

        MP.createRoom(function (roomId) {
          btnHost.textContent = 'Create Room';
          btnHost.disabled = false;
          var hostBox = $('mpHostDetails');
          if (hostBox) hostBox.classList.remove('hidden');
          var codeDisp = $('mpRoomCodeDisplay');
          if (codeDisp) codeDisp.textContent = roomId;
          self._updateStatusPill(true, 'Room ' + roomId + ' (Waiting for Guest)');
        }, function (err) {
          btnHost.textContent = 'Create Room';
          btnHost.disabled = false;
          alert('Network signaling error. Using local broadcast fallback for same-device testing.');
          var hostBox = $('mpHostDetails');
          if (hostBox) hostBox.classList.remove('hidden');
          var codeDisp = $('mpRoomCodeDisplay');
          if (codeDisp) codeDisp.textContent = MP.roomId;
        });
      });
    }

    // Copy Code button
    var btnCopy = $('btnMpCopyCode');
    if (btnCopy) {
      btnCopy.addEventListener('click', function () {
        if (MP.roomId) {
          navigator.clipboard.writeText(MP.roomId).then(function () {
            btnCopy.textContent = '✓ Copied!';
            setTimeout(function () { btnCopy.textContent = '📋 Copy Code'; }, 1800);
          }).catch(function () {
            prompt('Copy this room code:', MP.roomId);
          });
        }
      });
    }

    // Open 2nd tab test button
    var btnOpenTab = $('btnMpOpenTab');
    if (btnOpenTab) {
      btnOpenTab.addEventListener('click', function () {
        if (MP.roomId) {
          var url = window.location.origin + window.location.pathname + '#join=' + encodeURIComponent(MP.roomId);
          window.open(url, '_blank');
        }
      });
    }

    // Join room button
    var btnJoin = $('btnMpJoin');
    if (btnJoin) {
      btnJoin.addEventListener('click', function () {
        var joinInput = $('mpJoinCodeInput');
        var code = joinInput ? joinInput.value.trim().toUpperCase() : '';
        if (!code) {
          self._showJoinError('Please enter a room code');
          return;
        }
        var nameInput = $('mpPlayerName');
        if (nameInput && nameInput.value.trim()) {
          MP.playerName = nameInput.value.trim();
        }
        btnJoin.disabled = true;
        btnJoin.textContent = 'Connecting...';
        self._showJoinError('');

        MP.joinRoom(code, function () {
          btnJoin.disabled = false;
          btnJoin.textContent = '⚡ Join';
          self._updateStatusPill(true, 'Connected to ' + code);
          self._switchView('lobby');
          self._updateLobbyUI();
        }, function (err) {
          btnJoin.disabled = false;
          btnJoin.textContent = '⚡ Join';
          self._showJoinError('Could not connect. Verify room code or test in 2nd tab.');
        });
      });
    }

    // Mode selection buttons
    ['mpModeRace', 'mpModeCoop', 'mpModeTurn'].forEach(function (id) {
      var card = $(id);
      if (card) {
        card.addEventListener('click', function () {
          if (MP.role !== 'host') {
            alert('Only the room host can change the game mode.');
            return;
          }
          var mode = card.getAttribute('data-mode');
          MP.setSettings(mode, MP.stageIdx);
        });
      }
    });

    // Stage selector buttons
    var stageBtns = document.querySelectorAll('.mp-stage-btn');
    stageBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (MP.role !== 'host') {
          alert('Only the room host can select the stage.');
          return;
        }
        var sIdx = parseInt(btn.getAttribute('data-stage'), 10) || 0;
        MP.setSettings(MP.mode, sIdx);
      });
    });

    // Ready button
    var btnReady = $('btnMpReady');
    if (btnReady) {
      btnReady.addEventListener('click', function () {
        var newReady = !MP.isReady;
        MP.setReady(newReady);
        btnReady.textContent = newReady ? '✓ Ready!' : 'Ready Up';
        btnReady.classList.toggle('primary', newReady);
        self._updateLobbyUI();
      });
    }

    // Start match button (Host only)
    var btnStart = $('btnMpStart');
    if (btnStart) {
      btnStart.addEventListener('click', function () {
        if (MP.role !== 'host') return;
        MP.startMatch();
      });
    }

    // Disconnect button
    var btnDisconnect = $('btnMpDisconnect');
    if (btnDisconnect) {
      btnDisconnect.addEventListener('click', function () {
        MP.leave();
        self._switchView('connect');
        self._updateStatusPill(false, 'Disconnected');
      });
    }

    // Lobby Chat
    var btnSendChat = $('btnMpSendChat');
    var chatInput = $('mpChatInput');
    function doSendChat() {
      if (chatInput && chatInput.value.trim()) {
        MP.sendChat(chatInput.value.trim());
        chatInput.value = '';
      }
    }
    if (btnSendChat) btnSendChat.addEventListener('click', doSendChat);
    if (chatInput) {
      chatInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') doSendChat();
      });
    }

    // HUD buttons
    var btnHudLeave = $('btnMpHudLeave');
    if (btnHudLeave) {
      btnHudLeave.addEventListener('click', function () {
        if (confirm('Leave this multiplayer match?')) {
          MP.leave();
          self.hideHud();
        }
      });
    }
    var btnHudChat = $('btnMpHudChat');
    if (btnHudChat) {
      btnHudChat.addEventListener('click', function () {
        self.openModal();
      });
    }

    // Duel Modal Rematch
    var btnRematch = $('btnDuelRematch');
    if (btnRematch) {
      btnRematch.addEventListener('click', function () {
        btnRematch.disabled = true;
        btnRematch.textContent = 'Waiting for Opponent...';
        MP.requestRematch();
      });
    }
    var btnDuelClose = $('btnDuelClose');
    if (btnDuelClose) {
      btnDuelClose.addEventListener('click', function () {
        $('duelModal').classList.add('hidden');
      });
    }
  };

    MP.on('server_status', function (st) {
      var dot = $('mpDot');
      var txt = $('mpStatusText');
      if (st.connected) {
        if (!MP.connected) self._updateStatusPill(true, 'Server Ready');
      } else {
        if (!MP.connected) self._updateStatusPill(false, 'Server Connecting / Offline');
      }
    });

    MP.on('ping', function (pingMs) {
      var pingEl = $('mpPingDisplay');
      if (pingEl) pingEl.textContent = pingMs + 'ms';
      var hudPing = $('mpHudPing');
      if (hudPing) hudPing.textContent = '📡 ' + pingMs + 'ms';
    });

    MP.on('peer_reconnected', function (data) {
      self._updateStatusPill(true, 'Connected with ' + data.name);
      self._appendChat('System', (data.name || 'Opponent') + ' reconnected to the match!');
      if (root.SDG && root.SDG.showToast) {
        root.SDG.showToast((data.name || 'Opponent') + ' reconnected!', 'ok');
      }
    });

    MP.on('peer_disconnected', function (data) {
      self._updateStatusPill(false, 'Opponent disconnected (waiting 2m...)');
      self._appendChat('System', 'Opponent lost connection. Waiting 2m for reconnect...');
      if (root.SDG && root.SDG.showToast) {
        root.SDG.showToast('Opponent disconnected. Holding room open...', 'warn');
      }
    });

    MP.on('connected', function () {
      self._updateStatusPill(true, 'Connected');
      self._switchView('lobby');
      self._updateLobbyUI();
    });

    MP.on('peer_joined', function (data) {
      self._updateStatusPill(true, 'Connected with ' + data.name);
      self._switchView('lobby');
      self._updateLobbyUI();
      self._appendChat('System', data.name + ' joined the room!');
    });

    MP.on('settings_changed', function (data) {
      self._updateSettingsUI(data.mode, data.stageIdx);
    });

    MP.on('peer_ready', function (data) {
      self._updateLobbyUI();
    });

    MP.on('my_ready', function (data) {
      self._updateLobbyUI();
    });

    MP.on('match_start', function (data) {
      $('multiplayerModal').classList.add('hidden');
      self.localReport = null;
      self.opponentReport = null;
      self.showHud(data.mode);

      // Load chosen stage if needed
      if (SDG.debug && typeof SDG.debug.selectStage === 'function') {
        if (SDG.debug.getStageIdx && SDG.debug.getStageIdx() !== data.stageIdx) {
          SDG.debug.selectStage(data.stageIdx);
        }
      }

      // Display starter instructions based on mode
      if (data.mode === 'race') {
        self._updateHudStatus('Match started! Code and click ▶ Run to race!');
      } else if (data.mode === 'coop') {
        var myRole = MP.coopState.myRole;
        self._updateHudStatus('CO-OP: You are ' + myRole + '. Code cooperatively!');
      } else if (data.mode === 'turn') {
        self._updateHudStatus('Turn-Based Match! Round 1 / ' + MP.turnState.maxRounds);
      }
    });

    MP.on('opponent_update', function (opp) {
      self._updateOpponentHud(opp);
    });

    MP.on('opponent_finished', function (data) {
      self.opponentReport = data.report;
      var scoreText = data.report ? (data.report.score + ' (' + (data.report.grade ? data.report.grade.letter : '') + ')') : 'done';
      self._updateHudStatus('Opponent finished! Score: ' + scoreText);
      self._checkDuelComplete();
    });

    MP.on('turn_passed', function (data) {
      var isMyTurn = (MP.role === data.turnState.currentTurn);
      self._updateHudStatus(isMyTurn ? 'YOUR TURN! Advance your code now.' : "Opponent's turn to optimize.");
      $('mpHudModePill').textContent = '⏳ Turn ' + data.turnState.round + '/' + data.turnState.maxRounds;
    });

    MP.on('chat', function (msg) {
      self._appendChat(msg.from, msg.text, msg.time);
    });

    MP.on('rematch_requested', function () {
      var banner = $('duelBanner');
      if (banner) {
        var p = document.createElement('p');
        p.className = 'hint accent';
        p.textContent = 'Opponent wants a rematch! Click Rematch to accept!';
        banner.appendChild(p);
      }
      var btn = $('btnDuelRematch');
      if (btn) btn.textContent = 'Accept Rematch!';
    });

    MP.on('rematch_accepted', function () {
      $('duelModal').classList.add('hidden');
      self.localReport = null;
      self.opponentReport = null;
      self.showHud(MP.mode);
      if (SDG.debug && typeof SDG.debug.reset === 'function') {
        SDG.debug.reset(false);
      }
      self._updateHudStatus('Rematch started! Code and click ▶ Run!');
    });

    MP.on('disconnected', function () {
      self._updateStatusPill(false, 'Disconnected');
      self.hideHud();
      self._switchView('connect');
      var hostBox = $('mpHostDetails');
      if (hostBox) hostBox.classList.add('hidden');
    });
  };

  MultiplayerUI.prototype._checkUrlJoinCode = function () {
    var hash = window.location.hash || '';
    if (hash.indexOf('multiplayer') !== -1) {
      this.openModal();
    }
    var match = hash.match(/join=([A-Za-z0-9_-]+)/);
    if (!match) {
      var search = window.location.search || '';
      match = search.match(/join=([A-Za-z0-9_-]+)/);
    }
    if (match && match[1]) {
      var code = decodeURIComponent(match[1]).toUpperCase();
      var input = $('mpJoinCodeInput');
      if (input) input.value = code;
      // Open modal automatically
      this.openModal();
    }
  };

  MultiplayerUI.prototype.openModal = function () {
    $('multiplayerModal').classList.remove('hidden');
    if (MP.connected) {
      this._switchView('lobby');
      this._updateLobbyUI();
    } else {
      this._switchView('connect');
    }
  };

  MultiplayerUI.prototype._switchView = function (view) {
    var conn = $('mpConnectView');
    var lobby = $('mpLobbyView');
    if (conn) conn.classList.toggle('hidden', view !== 'connect');
    if (lobby) lobby.classList.toggle('hidden', view !== 'lobby');
  };

  MultiplayerUI.prototype._updateStatusPill = function (active, text) {
    var pill = $('mpStatusPill');
    var dot = $('mpDot');
    var stText = $('mpStatusText');
    if (pill && dot && stText) {
      pill.classList.toggle('active', active);
      dot.className = 'mp-dot ' + (active ? 'online' : '');
      stText.textContent = text;
    }
  };

  MultiplayerUI.prototype._showJoinError = function (msg) {
    var errEl = $('mpJoinError');
    if (errEl) {
      errEl.textContent = msg;
      errEl.classList.toggle('hidden', !msg);
    }
  };

  MultiplayerUI.prototype._updateLobbyUI = function () {
    var nameYou = $('mpNameYou');
    var tagYou = $('mpTagYou');
    var readyYou = $('mpReadyYou');
    var nameOpp = $('mpNameOpponent');
    var tagOpp = $('mpTagOpponent');
    var readyOpp = $('mpReadyOpponent');

    if (nameYou) nameYou.textContent = MP.playerName;
    if (tagYou) tagYou.textContent = MP.role === 'host' ? 'Host' : 'Guest';
    if (readyYou) {
      readyYou.textContent = MP.isReady ? '✓ Ready' : 'Waiting';
      readyYou.className = 'mp-ready-badge ' + (MP.isReady ? 'ready' : '');
    }

    if (nameOpp) nameOpp.textContent = MP.peerName;
    if (tagOpp) tagOpp.textContent = MP.role === 'host' ? 'Guest' : 'Host';
    if (readyOpp) {
      readyOpp.textContent = MP.peerReady ? '✓ Ready' : 'Waiting';
      readyOpp.className = 'mp-ready-badge ' + (MP.peerReady ? 'ready' : '');
    }

    this._updateSettingsUI(MP.mode, MP.stageIdx);

    var btnStart = $('btnMpStart');
    if (btnStart) {
      if (MP.role === 'host') {
        btnStart.style.display = 'inline-block';
        // Enable if both ready or host ready
        btnStart.disabled = !(MP.isReady && MP.peerReady);
        btnStart.title = (MP.isReady && MP.peerReady) ? 'Both players are ready!' : 'Waiting for both players to ready up';
      } else {
        btnStart.style.display = 'none';
      }
    }
  };

  MultiplayerUI.prototype._updateSettingsUI = function (mode, stageIdx) {
    ['mpModeRace', 'mpModeCoop', 'mpModeTurn'].forEach(function (id) {
      var card = $(id);
      if (card) {
        card.classList.toggle('active', card.getAttribute('data-mode') === mode);
      }
    });

    var stageBtns = document.querySelectorAll('.mp-stage-btn');
    stageBtns.forEach(function (btn) {
      var sIdx = parseInt(btn.getAttribute('data-stage'), 10);
      btn.classList.toggle('active', sIdx === stageIdx);
    });
  };

  MultiplayerUI.prototype._appendChat = function (from, text, time) {
    var container = $('mpChatMessages');
    if (!container) return;
    var row = document.createElement('div');
    row.className = 'mp-chat-row ' + (from === MP.playerName ? 'self' : '');
    var timeStr = time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    row.innerHTML = '<span class="mp-chat-from">' + from + ':</span> <span class="mp-chat-text">' + text + '</span> <span class="mp-chat-time">' + timeStr + '</span>';
    container.appendChild(row);
    container.scrollTop = container.scrollHeight;
  };

  // ---------------- HUD Management ----------------

  MultiplayerUI.prototype.showHud = function (mode) {
    var bar = $('mpHudBar');
    if (bar) bar.classList.remove('hidden');

    var pill = $('mpHudModePill');
    if (pill) {
      if (mode === 'race') pill.textContent = '🏁 1v1 Race';
      else if (mode === 'coop') pill.textContent = '🤝 Co-op City (' + MP.coopState.myRole + ')';
      else if (mode === 'turn') pill.textContent = '⏳ Turn 1/' + MP.turnState.maxRounds;
    }

    var youEl = $('mpHudYou');
    var oppEl = $('mpHudOpp');
    if (youEl) youEl.innerHTML = MP.playerName + ': <b id="mpHudYourScore">0</b> (<span id="mpHudYourGrade">–</span>)';
    if (oppEl) oppEl.innerHTML = MP.peerName + ': <b id="mpHudOppScore">0</b> (<span id="mpHudOppGrade">–</span>)';
  };

  MultiplayerUI.prototype.hideHud = function () {
    var bar = $('mpHudBar');
    if (bar) bar.classList.add('hidden');
  };

  MultiplayerUI.prototype._updateHudStatus = function (text) {
    var st = $('mpHudStatus');
    if (st) st.textContent = text;
  };

  MultiplayerUI.prototype._updateOpponentHud = function (opp) {
    var oppScore = $('mpHudOppScore');
    var oppGrade = $('mpHudOppGrade');
    var oppTick = $('mpHudOppTick');
    var oppEm = $('mpHudOppEmissions');
    var hudSt = $('mpHudStatus');

    if (oppScore) oppScore.textContent = opp.score;
    if (oppGrade) oppGrade.textContent = opp.grade;
    if (oppTick) oppTick.textContent = 'Tick ' + opp.tick;
    if (oppEm) oppEm.textContent = opp.emissions + ' kg CO₂';
    if (hudSt) hudSt.textContent = opp.status === 'running' ? (MP.peerName + ' running: ' + (opp.lastAction || 'action')) : (MP.peerName + ': ' + opp.status);
  };

  MultiplayerUI.prototype.updateLocalTelemetry = function (score, grade) {
    this.myScore = score;
    this.myGrade = grade;
    var youScore = $('mpHudYourScore');
    var youGrade = $('mpHudYourGrade');
    if (youScore) youScore.textContent = score;
    if (youGrade) youGrade.textContent = grade;
  };

  MultiplayerUI.prototype.onLocalRunFinish = function (report) {
    this.localReport = report;
    this.updateLocalTelemetry(report.score, report.grade ? report.grade.letter : '–');
    this._checkDuelComplete();
  };

  MultiplayerUI.prototype._checkDuelComplete = function () {
    if (!this.localReport || !this.opponentReport) return;
    this._showDuelModal(this.localReport, this.opponentReport);
  };

  MultiplayerUI.prototype._showDuelModal = function (myRep, oppRep) {
    var modal = $('duelModal');
    if (!modal) return;

    var verdict = MP.getDuelVerdict(myRep, oppRep);
    this.duelVerdict = verdict;

    var trophy = $('duelTrophy');
    var title = $('duelTitle');
    var subtitle = $('duelSubtitle');

    if (MP.mode === 'coop') {
      trophy.textContent = '🤝';
      title.textContent = 'CO-OP MISSION COMPLETE!';
      title.className = 'coop';
      subtitle.textContent = 'Your combined team achieved a Grade ' + myRep.grade.letter + ' score of ' + myRep.score + '/100!';
    } else if (verdict.result === 'win') {
      trophy.textContent = '🏆';
      title.textContent = 'VICTORY!';
      title.className = 'win';
      subtitle.textContent = 'You outperformed your opponent in sustainability!';
    } else if (verdict.result === 'loss') {
      trophy.textContent = '🥈';
      title.textContent = 'DEFEAT!';
      title.className = 'loss';
      subtitle.textContent = 'Opponent achieved a higher sustainability score. Challenge them to a rematch!';
    } else {
      trophy.textContent = '🤝';
      title.textContent = 'TIED MATCH!';
      title.className = 'tie';
      subtitle.textContent = 'Both automated cities scored equally in balance and efficiency!';
    }

    $('duelNameYou').textContent = MP.playerName.toUpperCase();
    $('duelScoreYou').textContent = myRep.score;
    $('duelGradeYou').textContent = 'Grade ' + (myRep.grade ? myRep.grade.letter : '–');
    $('duelEmissionsYou').textContent = Math.round(myRep.world ? myRep.world.emissions : 0) + ' kg';
    $('duelActionsYou').textContent = myRep.totalActions || Object.keys(myRep.world ? myRep.world.stats.actions : {}).length;
    $('duelStatusYou').textContent = myRep.passed ? 'Cleared' : 'Failed';

    $('duelNameOpp').textContent = MP.peerName.toUpperCase();
    $('duelScoreOpp').textContent = oppRep.score;
    $('duelGradeOpp').textContent = 'Grade ' + (oppRep.grade ? oppRep.grade.letter : '–');
    $('duelEmissionsOpp').textContent = Math.round(oppRep.world ? oppRep.world.emissions : (oppRep.emissions || 0)) + ' kg';
    $('duelActionsOpp').textContent = oppRep.totalActions || (oppRep.actions ? oppRep.actions.length : '–');
    $('duelStatusOpp').textContent = oppRep.passed ? 'Cleared' : 'Failed';

    var btnRematch = $('btnDuelRematch');
    if (btnRematch) {
      btnRematch.disabled = false;
      btnRematch.textContent = '🔄 Rematch';
    }

    modal.classList.remove('hidden');
  };

  SDG.MultiplayerUI = new MultiplayerUI();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { SDG.MultiplayerUI.init(); });
  } else {
    SDG.MultiplayerUI.init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
