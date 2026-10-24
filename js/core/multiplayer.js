(function (root) {
  'use strict';
  var SDG = (root.SDG = root.SDG || {});

  var MODES = {
    RACE: 'race',
    COOP: 'coop',
    TURN: 'turn'
  };

  function genRoomCode() {
    var chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    var code = '';
    for (var i = 0; i < 5; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return 'SDG-' + code;
  }

  function getBackendUrl() {
    if (root.__BACKEND_URL__) return root.__BACKEND_URL__;
    try {
      var stored = root.localStorage ? root.localStorage.getItem('sdg_backend_url') : null;
      if (stored && stored.trim()) return stored.trim();
    } catch (e) { /* ignore */ }

    if (root.location) {
      if (root.location.hostname === 'localhost' || root.location.hostname === '127.0.0.1') {
        return root.location.protocol + '//' + root.location.hostname + ':3000';
      }
      return 'https://sdg-multiplayer-backend.onrender.com';
    }
    return 'http://localhost:3000';
  }

  // Fallback broadcast transport for offline/local-tab testing
  function BroadcastTransport() {
    this.bc = null;
    this.isOpen = false;
    this.channelId = null;
    this.onMessage = null;
    this.onOpen = null;
    this.onClose = null;
    this.onError = null;
  }

  BroadcastTransport.prototype.init = function (roomId) {
    var self = this;
    this.channelId = roomId;
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        if (this.bc) this.bc.close();
        this.bc = new BroadcastChannel('sdg_room_' + roomId);
        this.bc.onmessage = function (ev) {
          if (ev && ev.data) {
            if (!self.isOpen) {
              self.isOpen = true;
              if (self.onOpen) self.onOpen();
            }
            if (self.onMessage) self.onMessage(ev.data);
          }
        };
      } catch (e) { /* ignore */ }
    }
  };

  BroadcastTransport.prototype.send = function (msg) {
    if (this.bc) {
      try { this.bc.postMessage(msg); } catch (e) { /* ignore */ }
    }
  };

  BroadcastTransport.prototype.close = function () {
    if (this.bc) {
      try { this.bc.close(); } catch (e) { /* ignore */ }
      this.bc = null;
    }
    this.isOpen = false;
  };

  // ---------------- Multiplayer Manager ----------------

  function Multiplayer() {
    this.roomId = null;
    this.role = null; // 'host' | 'guest'
    this.mode = MODES.RACE;
    this.stageIdx = 0;
    this.playerName = 'Player ' + Math.floor(Math.random() * 900 + 100);
    this.peerName = 'Opponent';
    this.connected = false;
    this.serverConnected = false;
    this.inGame = false;
    this.isReady = false;
    this.peerReady = false;
    this.ping = 0;
    this.sessionId = this._loadSessionId();

    // Fallback broadcast transport
    this.transport = new BroadcastTransport();

    // Opponent live tracking
    this.opponent = {
      status: 'idle',
      tick: 0,
      score: 0,
      grade: '–',
      emissions: 0,
      lastAction: '–',
      report: null
    };

    // Turn-based duel state
    this.turnState = {
      currentTurn: 'host',
      round: 1,
      maxRounds: 4,
      ticksPerRound: 25,
      hostScore: 0,
      guestScore: 0
    };

    // Cooperative mode state
    this.coopState = {
      hostRole: 'Infrastructure & Energy',
      guestRole: 'Ecology & Community',
      myRole: 'Infrastructure & Energy',
      sharedWorld: null
    };

    this.listeners = {};
    this.socket = null;

    this._initSocket();
    this._bindFallbackTransport();
  }

  Multiplayer.prototype._loadSessionId = function () {
    var id = null;
    try {
      id = root.sessionStorage ? root.sessionStorage.getItem('sdg_mp_sessionId') : null;
    } catch (e) { /* ignore */ }
    if (!id) {
      id = 'sess_' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36);
      try {
        if (root.sessionStorage) root.sessionStorage.setItem('sdg_mp_sessionId', id);
      } catch (e) { /* ignore */ }
    }
    return id;
  };

  Multiplayer.prototype._saveSession = function (code, role) {
    try {
      if (root.sessionStorage) {
        root.sessionStorage.setItem('sdg_mp_active_room', JSON.stringify({
          sessionId: this.sessionId,
          roomCode: code,
          role: role,
          playerName: this.playerName
        }));
      }
    } catch (e) { /* ignore */ }
  };

  Multiplayer.prototype._clearSession = function () {
    try {
      if (root.sessionStorage) root.sessionStorage.removeItem('sdg_mp_active_room');
    } catch (e) { /* ignore */ }
  };

  Multiplayer.prototype._initSocket = function () {
    var self = this;
    if (typeof root.io === 'undefined') return;

    try {
      var backendUrl = getBackendUrl();
      this.socket = root.io(backendUrl, {
        reconnection: true,
        reconnectionAttempts: 15,
        reconnectionDelay: 1000,
        timeout: 10000
      });

      this.socket.on('connect', function () {
        self.serverConnected = true;
        self.emit('server_status', { connected: true, url: backendUrl });

        // Auto-reconnect active session if page refreshed
        self._checkAutoReconnect();

        // Start ping loop
        self._startPingLoop();
      });

      this.socket.on('disconnect', function () {
        self.serverConnected = false;
        self.emit('server_status', { connected: false });
      });

      this.socket.on('connect_error', function (err) {
        self.serverConnected = false;
        self.emit('server_status', { connected: false, error: err });
      });

      this.socket.on('peer_joined', function (data) {
        self.peerName = data.name || 'Opponent';
        self.connected = true;
        self.emit('peer_joined', { name: self.peerName, mode: self.mode, stageIdx: self.stageIdx });
      });

      this.socket.on('peer_reconnected', function (data) {
        self.connected = true;
        self.emit('peer_reconnected', data);
      });

      this.socket.on('peer_disconnected', function (data) {
        self.emit('peer_disconnected', data);
      });

      this.socket.on('settings_changed', function (data) {
        if (data.mode) self.mode = data.mode;
        if (typeof data.stageIdx === 'number') self.stageIdx = data.stageIdx;
        self.emit('settings_changed', data);
      });

      this.socket.on('peer_ready', function (data) {
        var isOpponent = (self.role !== data.role);
        if (isOpponent) self.peerReady = data.ready;
        self.emit('peer_ready', data);
      });

      this.socket.on('match_start', function (data) {
        self.inGame = true;
        self.mode = data.mode || self.mode;
        self.stageIdx = typeof data.stageIdx === 'number' ? data.stageIdx : self.stageIdx;
        if (data.turnState) self.turnState = data.turnState;
        self.emit('match_start', data);
      });

      this.socket.on('opponent_update', function (stats) {
        self.opponent = stats;
        self.emit('opponent_update', stats);
      });

      this.socket.on('opponent_finished', function (data) {
        self.opponent.status = 'finished';
        self.opponent.report = data.report;
        self.emit('opponent_finished', data);
      });

      this.socket.on('match_finished', function (data) {
        self.inGame = false;
        self.emit('match_finished', data);
      });

      this.socket.on('coop_action', function (data) {
        self.emit('coop_action', data);
      });

      this.socket.on('turn_passed', function (data) {
        if (data.turnState) self.turnState = data.turnState;
        self.emit('turn_passed', data);
      });

      this.socket.on('chat', function (msg) {
        self.emit('chat', msg);
      });

      this.socket.on('rematch_requested', function () {
        self.emit('rematch_requested');
      });

      this.socket.on('rematch_accepted', function (data) {
        self.inGame = true;
        self.opponent = { status: 'coding', tick: 0, score: 0, grade: '–', emissions: 0, lastAction: '–', report: null };
        self.emit('rematch_accepted', data);
      });
    } catch (e) {
      console.warn('Socket.IO init exception:', e);
    }
  };

  Multiplayer.prototype._checkAutoReconnect = function () {
    var self = this;
    try {
      var saved = root.sessionStorage ? JSON.parse(root.sessionStorage.getItem('sdg_mp_active_room') || 'null') : null;
      if (saved && saved.sessionId && saved.roomCode && this.socket) {
        this.socket.emit('reconnect_session', {
          sessionId: saved.sessionId,
          roomCode: saved.roomCode
        }, function (res) {
          if (res && res.success) {
            self.roomId = res.code;
            self.role = res.role;
            self.connected = true;
            if (res.room) {
              self.mode = res.room.mode;
              self.stageIdx = res.room.stageIdx;
              if (res.role === 'host' && res.room.guest) self.peerName = res.room.guest.name;
              if (res.role === 'guest' && res.room.host) self.peerName = res.room.host.name;
            }
            self.emit('connected', { role: self.role, roomId: self.roomId, reconnected: true });
          }
        });
      }
    } catch (e) { /* ignore */ }
  };

  Multiplayer.prototype._startPingLoop = function () {
    var self = this;
    if (this._pingInterval) clearInterval(this._pingInterval);
    this._pingInterval = setInterval(function () {
      if (self.socket && self.socket.connected) {
        var start = Date.now();
        self.socket.emit('latency_ping', function () {
          self.ping = Date.now() - start;
          self.emit('ping', self.ping);
        });
      }
    }, 6000);
  };

  Multiplayer.prototype._bindFallbackTransport = function () {
    var self = this;
    this.transport.onOpen = function () {
      self.connected = true;
      self.emit('connected', { role: self.role, roomId: self.roomId });
      self.send({
        type: 'HELLO',
        name: self.playerName,
        role: self.role,
        mode: self.mode,
        stageIdx: self.stageIdx
      });
    };

    this.transport.onMessage = function (msg) {
      if (!msg || !msg.type) return;
      self._handleMessage(msg);
    };
  };

  Multiplayer.prototype._handleMessage = function (msg) {
    if (msg._sender === this.playerName) return;

    switch (msg.type) {
      case 'HELLO':
        this.peerName = msg.name || 'Opponent';
        this.connected = true;
        if (this.role === 'host') {
          this.send({
            type: 'WELCOME',
            name: this.playerName,
            mode: this.mode,
            stageIdx: this.stageIdx
          });
        }
        this.emit('peer_joined', { name: this.peerName, mode: this.mode, stageIdx: this.stageIdx });
        break;

      case 'WELCOME':
        this.peerName = msg.name || 'Host';
        this.connected = true;
        this.mode = msg.mode || this.mode;
        this.stageIdx = typeof msg.stageIdx === 'number' ? msg.stageIdx : this.stageIdx;
        this.emit('peer_joined', { name: this.peerName, mode: this.mode, stageIdx: this.stageIdx });
        this.emit('settings_changed', { mode: this.mode, stageIdx: this.stageIdx });
        break;

      case 'SET_SETTINGS':
        if (msg.mode) this.mode = msg.mode;
        if (typeof msg.stageIdx === 'number') this.stageIdx = msg.stageIdx;
        this.emit('settings_changed', { mode: this.mode, stageIdx: this.stageIdx });
        break;

      case 'READY':
        this.peerReady = !!msg.ready;
        this.emit('peer_ready', { ready: this.peerReady });
        break;

      case 'MATCH_START':
        this.inGame = true;
        this.mode = msg.mode || this.mode;
        this.stageIdx = typeof msg.stageIdx === 'number' ? msg.stageIdx : this.stageIdx;
        this.emit('match_start', { mode: this.mode, stageIdx: this.stageIdx });
        break;

      case 'OPPONENT_UPDATE':
        this.opponent = {
          status: msg.status || 'running',
          tick: msg.tick || 0,
          score: msg.score || 0,
          grade: msg.grade || '–',
          emissions: msg.emissions || 0,
          lastAction: msg.lastAction || '–',
          report: null
        };
        this.emit('opponent_update', this.opponent);
        break;

      case 'RUN_FINISH':
        this.opponent.status = 'finished';
        this.opponent.report = msg.report;
        this.emit('opponent_finished', { report: msg.report });
        break;

      case 'COOP_ACTION':
        this.emit('coop_action', {
          actionName: msg.actionName,
          args: msg.args,
          kwargs: msg.kwargs,
          tick: msg.tick
        });
        break;

      case 'TURN_PASS':
        this.turnState = msg.turnState;
        this.emit('turn_passed', { turnState: this.turnState, worldSnapshot: msg.worldSnapshot });
        break;

      case 'CHAT':
        this.emit('chat', msg);
        break;

      case 'REMATCH':
        this.emit('rematch_requested');
        break;

      case 'REMATCH_ACCEPT':
        this.inGame = true;
        this.isReady = false;
        this.peerReady = false;
        this.opponent = { status: 'coding', tick: 0, score: 0, grade: '–', emissions: 0, lastAction: '–', report: null };
        this.emit('rematch_accepted');
        break;
    }
  };

  Multiplayer.prototype.on = function (event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  };

  Multiplayer.prototype.emit = function (event, data) {
    var fns = this.listeners[event] || [];
    for (var i = 0; i < fns.length; i++) {
      try { fns[i](data); } catch (e) { console.error('Listener error in ' + event + ':', e); }
    }
  };

  Multiplayer.prototype.send = function (msg) {
    msg._sender = this.playerName;
    msg.timestamp = Date.now();
    this.transport.send(msg);
  };

  // Create Room
  Multiplayer.prototype.createRoom = function (onReady, onError) {
    var self = this;
    this.role = 'host';
    this.isReady = false;
    this.peerReady = false;
    this.coopState.myRole = this.coopState.hostRole;

    if (this.socket && this.socket.connected) {
      this.socket.emit('create_room', {
        playerName: this.playerName,
        sessionId: this.sessionId
      }, function (res) {
        if (res && res.success) {
          self.roomId = res.code;
          self._saveSession(res.code, 'host');
          self.transport.init(res.code);
          if (onReady) onReady(res.code);
        } else {
          self._fallbackCreate(onReady, onError);
        }
      });
    } else {
      this._fallbackCreate(onReady, onError);
    }
  };

  Multiplayer.prototype._fallbackCreate = function (onReady, onError) {
    this.roomId = genRoomCode();
    this._saveSession(this.roomId, 'host');
    this.transport.init(this.roomId);
    if (onReady) onReady(this.roomId);
  };

  // Join Room
  Multiplayer.prototype.joinRoom = function (roomId, onConnected, onError) {
    var self = this;
    this.role = 'guest';
    this.roomId = roomId.trim().toUpperCase();
    this.isReady = false;
    this.peerReady = false;
    this.coopState.myRole = this.coopState.guestRole;

    if (this.socket && this.socket.connected) {
      this.socket.emit('join_room', {
        roomCode: this.roomId,
        playerName: this.playerName,
        sessionId: this.sessionId
      }, function (res) {
        if (res && res.success) {
          self._saveSession(self.roomId, 'guest');
          self.connected = true;
          self.transport.init(self.roomId);
          if (res.room) {
            self.mode = res.room.mode || self.mode;
            self.stageIdx = typeof res.room.stageIdx === 'number' ? res.room.stageIdx : self.stageIdx;
            if (res.room.host) self.peerName = res.room.host.name;
          }
          self.emit('connected', { role: 'guest', roomId: self.roomId });
          if (onConnected) onConnected();
        } else {
          if (onError) onError(new Error((res && res.error) || 'Could not join room'));
        }
      });
    } else {
      this._fallbackJoin(this.roomId, onConnected, onError);
    }
  };

  Multiplayer.prototype._fallbackJoin = function (roomId, onConnected, onError) {
    var self = this;
    this.transport.init(roomId);
    this._saveSession(roomId, 'guest');
    setTimeout(function () {
      if (self.transport.bc) {
        self.transport.isOpen = true;
        if (self.transport.onOpen) self.transport.onOpen();
        if (onConnected) onConnected();
      } else {
        if (onConnected) onConnected();
      }
    }, 40);
  };

  Multiplayer.prototype.leave = function () {
    this.transport.close();
    this._clearSession();
    if (this.socket && this.socket.connected) {
      this.socket.emit('leave_room');
    }
    this.connected = false;
    this.inGame = false;
    this.roomId = null;
    this.role = null;
    this.isReady = false;
    this.peerReady = false;
    this.emit('disconnected');
  };

  Multiplayer.prototype.setSettings = function (mode, stageIdx) {
    this.mode = mode;
    this.stageIdx = stageIdx;
    if (this.socket && this.socket.connected) {
      this.socket.emit('set_settings', { mode: mode, stageIdx: stageIdx });
    }
    this.send({
      type: 'SET_SETTINGS',
      mode: this.mode,
      stageIdx: this.stageIdx
    });
    this.emit('settings_changed', { mode: this.mode, stageIdx: this.stageIdx });
  };

  Multiplayer.prototype.setReady = function (ready) {
    this.isReady = !!ready;
    if (this.socket && this.socket.connected) {
      this.socket.emit('set_ready', { ready: this.isReady });
    }
    this.send({ type: 'READY', ready: this.isReady });
    this.emit('my_ready', { ready: this.isReady });
  };

  Multiplayer.prototype.startMatch = function () {
    this.inGame = true;
    if (this.socket && this.socket.connected) {
      this.socket.emit('start_match');
    }
    this.send({
      type: 'MATCH_START',
      mode: this.mode,
      stageIdx: this.stageIdx
    });
    this.emit('match_start', { mode: this.mode, stageIdx: this.stageIdx });
  };

  Multiplayer.prototype.sendTelemetry = function (status, tick, score, grade, emissions, lastAction) {
    if (this.socket && this.socket.connected) {
      this.socket.emit('telemetry_update', {
        status: status,
        tick: tick,
        score: score,
        grade: grade,
        emissions: emissions,
        lastAction: lastAction
      });
    }
    this.send({
      type: 'OPPONENT_UPDATE',
      status: status,
      tick: tick,
      score: score,
      grade: grade,
      emissions: emissions,
      lastAction: lastAction
    });
  };

  Multiplayer.prototype.sendFinished = function (report) {
    if (this.socket && this.socket.connected) {
      this.socket.emit('run_finish', { report: report });
    }
    this.send({
      type: 'RUN_FINISH',
      report: report
    });
  };

  Multiplayer.prototype.sendCoopAction = function (actionName, args, kwargs, tick) {
    if (this.socket && this.socket.connected) {
      this.socket.emit('coop_action', {
        actionName: actionName,
        args: args,
        kwargs: kwargs,
        tick: tick
      });
    }
    this.send({
      type: 'COOP_ACTION',
      actionName: actionName,
      args: args,
      kwargs: kwargs,
      tick: tick
    });
  };

  Multiplayer.prototype.sendTurnPass = function (worldSnapshot, points) {
    var isHost = this.role === 'host';
    if (isHost) {
      this.turnState.hostScore += points || 0;
      this.turnState.currentTurn = 'guest';
    } else {
      this.turnState.guestScore += points || 0;
      this.turnState.currentTurn = 'host';
      this.turnState.round++;
    }

    if (this.socket && this.socket.connected) {
      this.socket.emit('pass_turn', {
        turnState: this.turnState,
        worldSnapshot: worldSnapshot
      });
    }
    this.send({
      type: 'TURN_PASS',
      turnState: this.turnState,
      worldSnapshot: worldSnapshot
    });
    this.emit('turn_passed', { turnState: this.turnState, worldSnapshot: worldSnapshot });
  };

  Multiplayer.prototype.sendChat = function (text) {
    var msg = {
      type: 'CHAT',
      from: this.playerName,
      text: text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    if (this.socket && this.socket.connected) {
      this.socket.emit('chat_message', { text: text });
    }
    this.send(msg);
    this.emit('chat', msg);
  };

  Multiplayer.prototype.requestRematch = function () {
    if (this.socket && this.socket.connected) {
      this.socket.emit('rematch_request');
    }
    this.send({ type: 'REMATCH' });
  };

  Multiplayer.prototype.acceptRematch = function () {
    this.inGame = true;
    this.isReady = false;
    this.peerReady = false;
    this.opponent = { status: 'coding', tick: 0, score: 0, grade: '–', emissions: 0, lastAction: '–', report: null };
    if (this.socket && this.socket.connected) {
      this.socket.emit('rematch_accept');
    }
    this.send({ type: 'REMATCH_ACCEPT' });
    this.emit('rematch_accepted');
  };

  // Determine winner for Duel / Race Mode
  Multiplayer.prototype.getDuelVerdict = function (myReport, opponentReport) {
    if (!myReport || !opponentReport) return null;
    var myScore = myReport.score || 0;
    var oppScore = opponentReport.score || 0;

    var result = 'tie';
    if (myScore > oppScore) result = 'win';
    else if (myScore < oppScore) result = 'loss';
    else {
      var myEm = (myReport.emissions !== undefined) ? myReport.emissions : (myReport.world ? myReport.world.emissions : 0);
      var oppEm = (opponentReport.emissions !== undefined) ? opponentReport.emissions : (opponentReport.world ? opponentReport.world.emissions : 0);
      if (myEm < oppEm) result = 'win';
      else if (myEm > oppEm) result = 'loss';
    }

    return {
      result: result,
      myScore: myScore,
      oppScore: oppScore,
      myGrade: myReport.grade ? myReport.grade.letter : '–',
      oppGrade: opponentReport.grade ? opponentReport.grade.letter : '–'
    };
  };

  SDG.MODES = MODES;
  SDG.Multiplayer = new Multiplayer();
})(typeof window !== 'undefined' ? window : globalThis);
