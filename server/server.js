'use strict';

const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Configuration & Environment Variables
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const RECONNECT_GRACE_MS = 120000; // 2 minutes grace period for reconnections

// Middleware
app.use(cors({
  origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(',').map(s => s.trim()),
  credentials: true
}));
app.use(express.json());

// In-Memory State with Session Persistence
// rooms: Map<string, Room>
// sessions: Map<string, { socketId, roomCode, role, playerName, lastActive }>
const rooms = new Map();
const sessions = new Map();

// Helper: Generate clean 5-character alphanumeric room codes
function generateRoomCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // Exclude ambiguous chars (0, 1, I, O)
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

// REST Endpoints
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    activeRooms: rooms.size,
    activeSessions: sessions.size,
    socketConnections: io.engine.clientsCount
  });
});

app.get('/api/rooms', (req, res) => {
  const publicRooms = [];
  for (const [code, r] of rooms.entries()) {
    publicRooms.push({
      code,
      mode: r.mode,
      stageIdx: r.stageIdx,
      status: r.status,
      playerCount: (r.host ? 1 : 0) + (r.guest ? 1 : 0),
      createdAt: r.createdAt
    });
  }
  res.json({ count: publicRooms.length, rooms: publicRooms });
});

app.get('/api/room/:code', (req, res) => {
  const code = (req.params.code || '').trim().toUpperCase();
  const r = rooms.get(code);
  if (!r) {
    return res.status(404).json({ error: 'Room not found' });
  }
  res.json({
    code: r.code,
    mode: r.mode,
    stageIdx: r.stageIdx,
    status: r.status,
    hasHost: !!r.host,
    hasGuest: !!r.guest,
    canJoin: !r.guest || r.guest.disconnected
  });
});

// Cloud Save Sync Endpoint (Optional backup)
const cloudSaves = new Map();
app.post('/api/save/cloud', (req, res) => {
  const { userId, saveData } = req.body || {};
  if (!userId || !saveData) {
    return res.status(400).json({ error: 'Missing userId or saveData' });
  }
  cloudSaves.set(userId, { data: saveData, savedAt: Date.now() });
  res.json({ success: true, savedAt: Date.now() });
});

app.get('/api/save/cloud/:userId', (req, res) => {
  const save = cloudSaves.get(req.params.userId);
  if (!save) return res.status(404).json({ error: 'No cloud save found' });
  res.json(save);
});

// Setup Socket.IO
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  pingInterval: 10000,
  pingTimeout: 5000
});

function serializeRoom(r) {
  if (!r) return null;
  return {
    code: r.code,
    mode: r.mode,
    stageIdx: r.stageIdx,
    status: r.status,
    host: r.host ? {
      name: r.host.name,
      ready: r.host.ready,
      disconnected: r.host.disconnected,
      stats: r.host.stats
    } : null,
    guest: r.guest ? {
      name: r.guest.name,
      ready: r.guest.ready,
      disconnected: r.guest.disconnected,
      stats: r.guest.stats
    } : null,
    turnState: r.turnState,
    coopState: {
      hostRole: r.coopState.hostRole,
      guestRole: r.coopState.guestRole
    }
  };
}

io.on('connection', (socket) => {
  let currentRoomCode = null;
  let currentSessionId = null;

  // Ping Latency check
  socket.on('latency_ping', (cb) => {
    if (typeof cb === 'function') cb(Date.now());
  });

  // Create Room
  socket.on('create_room', (data, cb) => {
    try {
      const playerName = (data && data.playerName ? String(data.playerName).trim() : 'Player') || 'Player';
      const sessionId = (data && data.sessionId) || 'sess_' + Math.random().toString(36).substr(2, 9);
      const code = generateRoomCode();

      const room = {
        code,
        createdAt: Date.now(),
        mode: 'race',
        stageIdx: 0,
        status: 'lobby', // 'lobby' | 'in_game' | 'finished'
        host: {
          socketId: socket.id,
          sessionId,
          name: playerName,
          ready: false,
          disconnected: false,
          stats: { tick: 0, score: 0, grade: '–', emissions: 0, lastAction: '–', report: null }
        },
        guest: null,
        turnState: {
          currentTurn: 'host',
          round: 1,
          maxRounds: 4,
          ticksPerRound: 25
        },
        coopState: {
          hostRole: 'Infrastructure & Energy',
          guestRole: 'Ecology & Community',
          sharedWorld: null
        },
        chatHistory: [],
        cleanupTimer: null
      };

      rooms.set(code, room);
      sessions.set(sessionId, { socketId: socket.id, roomCode: code, role: 'host', playerName, lastActive: Date.now() });

      currentRoomCode = code;
      currentSessionId = sessionId;

      socket.join(code);

      const resp = {
        success: true,
        code,
        role: 'host',
        sessionId,
        room: serializeRoom(room)
      };
      if (typeof cb === 'function') cb(resp);
      socket.emit('room_created', resp);
    } catch (err) {
      console.error('Error creating room:', err);
      if (typeof cb === 'function') cb({ success: false, error: 'Failed to create room' });
    }
  });

  // Join Room
  socket.on('join_room', (data, cb) => {
    try {
      const code = (data && data.roomCode ? String(data.roomCode).trim().toUpperCase() : '');
      const playerName = (data && data.playerName ? String(data.playerName).trim() : 'Guest') || 'Guest';
      const sessionId = (data && data.sessionId) || 'sess_' + Math.random().toString(36).substr(2, 9);

      const room = rooms.get(code);
      if (!room) {
        const err = { success: false, error: 'Room ' + code + ' not found' };
        if (typeof cb === 'function') cb(err);
        return socket.emit('join_error', err);
      }

      // Check if this is a reconnecting player
      if (room.host && room.host.sessionId === sessionId) {
        room.host.socketId = socket.id;
        room.host.disconnected = false;
        if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
        currentRoomCode = code;
        currentSessionId = sessionId;
        socket.join(code);

        const resp = { success: true, code, role: 'host', sessionId, room: serializeRoom(room), reconnected: true };
        if (typeof cb === 'function') cb(resp);
        socket.emit('room_joined', resp);
        socket.to(code).emit('peer_reconnected', { role: 'host', name: room.host.name });
        return;
      }

      if (room.guest && room.guest.sessionId === sessionId) {
        room.guest.socketId = socket.id;
        room.guest.disconnected = false;
        if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
        currentRoomCode = code;
        currentSessionId = sessionId;
        socket.join(code);

        const resp = { success: true, code, role: 'guest', sessionId, room: serializeRoom(room), reconnected: true };
        if (typeof cb === 'function') cb(resp);
        socket.emit('room_joined', resp);
        socket.to(code).emit('peer_reconnected', { role: 'guest', name: room.guest.name });
        return;
      }

      // If room is full
      if (room.guest && !room.guest.disconnected) {
        const err = { success: false, error: 'Room ' + code + ' is full' };
        if (typeof cb === 'function') cb(err);
        return socket.emit('join_error', err);
      }

      // Join as guest
      room.guest = {
        socketId: socket.id,
        sessionId,
        name: playerName,
        ready: false,
        disconnected: false,
        stats: { tick: 0, score: 0, grade: '–', emissions: 0, lastAction: '–', report: null }
      };

      sessions.set(sessionId, { socketId: socket.id, roomCode: code, role: 'guest', playerName, lastActive: Date.now() });
      currentRoomCode = code;
      currentSessionId = sessionId;

      socket.join(code);

      const resp = {
        success: true,
        code,
        role: 'guest',
        sessionId,
        room: serializeRoom(room)
      };

      if (typeof cb === 'function') cb(resp);
      socket.emit('room_joined', resp);

      // Notify host that guest joined
      socket.to(code).emit('peer_joined', {
        name: playerName,
        role: 'guest',
        room: serializeRoom(room)
      });
    } catch (err) {
      console.error('Error joining room:', err);
      if (typeof cb === 'function') cb({ success: false, error: 'Failed to join room' });
    }
  });

  // Reconnect Session
  socket.on('reconnect_session', (data, cb) => {
    try {
      const sessionId = data && data.sessionId;
      const sess = sessions.get(sessionId);
      if (!sess) {
        if (typeof cb === 'function') cb({ success: false, error: 'Session expired or not found' });
        return;
      }

      const room = rooms.get(sess.roomCode);
      if (!room) {
        sessions.delete(sessionId);
        if (typeof cb === 'function') cb({ success: false, error: 'Room expired' });
        return;
      }

      sess.socketId = socket.id;
      sess.lastActive = Date.now();
      currentRoomCode = sess.roomCode;
      currentSessionId = sessionId;
      socket.join(sess.roomCode);

      if (sess.role === 'host' && room.host) {
        room.host.socketId = socket.id;
        room.host.disconnected = false;
      } else if (sess.role === 'guest' && room.guest) {
        room.guest.socketId = socket.id;
        room.guest.disconnected = false;
      }

      if (room.cleanupTimer) {
        clearTimeout(room.cleanupTimer);
        room.cleanupTimer = null;
      }

      const resp = {
        success: true,
        code: sess.roomCode,
        role: sess.role,
        sessionId,
        room: serializeRoom(room),
        reconnected: true
      };

      if (typeof cb === 'function') cb(resp);
      socket.emit('room_joined', resp);
      socket.to(sess.roomCode).emit('peer_reconnected', { role: sess.role, name: sess.playerName });
    } catch (err) {
      console.error('Error in reconnect_session:', err);
      if (typeof cb === 'function') cb({ success: false, error: 'Reconnection failed' });
    }
  });

  // Settings Change (Host Only)
  socket.on('set_settings', (data) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room || !room.host || room.host.socketId !== socket.id) return;

    if (data.mode && ['race', 'coop', 'turn'].includes(data.mode)) {
      room.mode = data.mode;
    }
    if (typeof data.stageIdx === 'number' && data.stageIdx >= 0 && data.stageIdx <= 3) {
      room.stageIdx = data.stageIdx;
    }

    io.to(currentRoomCode).emit('settings_changed', {
      mode: room.mode,
      stageIdx: room.stageIdx,
      room: serializeRoom(room)
    });
  });

  // Ready State
  socket.on('set_ready', (data) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;

    const isHost = room.host && room.host.socketId === socket.id;
    const isGuest = room.guest && room.guest.socketId === socket.id;

    if (isHost) room.host.ready = !!data.ready;
    if (isGuest) room.guest.ready = !!data.ready;

    io.to(currentRoomCode).emit('peer_ready', {
      role: isHost ? 'host' : 'guest',
      ready: !!data.ready,
      room: serializeRoom(room)
    });
  });

  // Match Start (Host Only)
  socket.on('start_match', () => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room || !room.host || room.host.socketId !== socket.id) return;

    room.status = 'in_game';
    room.turnState.currentTurn = 'host';
    room.turnState.round = 1;

    // Reset player round stats
    if (room.host) room.host.stats = { tick: 0, score: 0, grade: '–', emissions: 0, lastAction: '–', report: null };
    if (room.guest) room.guest.stats = { tick: 0, score: 0, grade: '–', emissions: 0, lastAction: '–', report: null };

    io.to(currentRoomCode).emit('match_start', {
      mode: room.mode,
      stageIdx: room.stageIdx,
      turnState: room.turnState,
      coopState: room.coopState,
      room: serializeRoom(room)
    });
  });

  // Real-Time Telemetry Mirroring (1v1 Race & Live Hud)
  socket.on('telemetry_update', (data) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;

    const isHost = room.host && room.host.socketId === socket.id;
    const player = isHost ? room.host : room.guest;
    if (player && data) {
      player.stats = {
        tick: data.tick || 0,
        score: typeof data.score === 'number' ? data.score : 0,
        grade: data.grade || '–',
        emissions: typeof data.emissions === 'number' ? data.emissions : 0,
        lastAction: data.lastAction || '–',
        status: data.status || 'running'
      };
      socket.to(currentRoomCode).emit('opponent_update', player.stats);
    }
  });

  // Run Finish (Player completed run)
  socket.on('run_finish', (data) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;

    const isHost = room.host && room.host.socketId === socket.id;
    const player = isHost ? room.host : room.guest;
    if (player && data && data.report) {
      player.stats.report = data.report;
      player.stats.score = data.report.score;
      player.stats.grade = data.report.grade ? data.report.grade.letter : '–';
      player.stats.emissions = data.report.final ? data.report.final.emissions : 0;
      player.stats.status = 'finished';

      socket.to(currentRoomCode).emit('opponent_finished', {
        role: isHost ? 'host' : 'guest',
        report: data.report
      });

      // If both players have completed, determine verdict
      if (room.host && room.guest && room.host.stats.report && room.guest.stats.report) {
        room.status = 'finished';
        const hScore = room.host.stats.score || 0;
        const gScore = room.guest.stats.score || 0;
        const hEmiss = room.host.stats.emissions || 0;
        const gEmiss = room.guest.stats.emissions || 0;

        let winner = 'draw';
        if (hScore > gScore) winner = 'host';
        else if (gScore > hScore) winner = 'guest';
        else {
          if (hEmiss < gEmiss) winner = 'host';
          else if (gEmiss < hEmiss) winner = 'guest';
        }

        io.to(currentRoomCode).emit('match_finished', {
          winner,
          hostReport: room.host.stats.report,
          guestReport: room.guest.stats.report
        });
      }
    }
  });

  // Co-Op Shared Action Relay
  socket.on('coop_action', (data) => {
    if (!currentRoomCode) return;
    socket.to(currentRoomCode).emit('coop_action', {
      fromRole: (socket.id === (rooms.get(currentRoomCode)?.host?.socketId) ? 'host' : 'guest'),
      actionName: data.actionName,
      args: data.args,
      kwargs: data.kwargs,
      tick: data.tick
    });
  });

  // Turn-Based Duel Pass Turn
  socket.on('pass_turn', (data) => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room || room.mode !== 'turn') return;

    if (room.turnState.currentTurn === 'host') {
      room.turnState.currentTurn = 'guest';
    } else {
      room.turnState.currentTurn = 'host';
      room.turnState.round++;
    }

    const matchOver = room.turnState.round > room.turnState.maxRounds;
    if (matchOver) room.status = 'finished';

    io.to(currentRoomCode).emit('turn_passed', {
      turnState: room.turnState,
      lastReport: data.report || null,
      matchOver
    });
  });

  // Chat message
  socket.on('chat_message', (data) => {
    if (!currentRoomCode || !data || !data.text) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;

    const isHost = room.host && room.host.socketId === socket.id;
    const senderName = isHost ? room.host.name : (room.guest ? room.guest.name : 'Player');
    const entry = {
      from: senderName,
      text: String(data.text).slice(0, 200),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    room.chatHistory.push(entry);
    if (room.chatHistory.length > 50) room.chatHistory.shift();
    io.to(currentRoomCode).emit('chat', entry);
  });

  // Rematch request & accept
  socket.on('rematch_request', () => {
    if (!currentRoomCode) return;
    socket.to(currentRoomCode).emit('rematch_requested');
  });

  socket.on('rematch_accept', () => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;

    room.status = 'in_game';
    room.turnState.round = 1;
    room.turnState.currentTurn = 'host';
    if (room.host) room.host.stats = { tick: 0, score: 0, grade: '–', emissions: 0, lastAction: '–', report: null };
    if (room.guest) room.guest.stats = { tick: 0, score: 0, grade: '–', emissions: 0, lastAction: '–', report: null };

    io.to(currentRoomCode).emit('rematch_accepted', {
      mode: room.mode,
      stageIdx: room.stageIdx,
      turnState: room.turnState
    });
  });

  // Disconnection & Grace Period
  socket.on('disconnect', () => {
    if (!currentRoomCode) return;
    const room = rooms.get(currentRoomCode);
    if (!room) return;

    const isHost = room.host && room.host.socketId === socket.id;
    const isGuest = room.guest && room.guest.socketId === socket.id;

    if (isHost && room.host) room.host.disconnected = true;
    if (isGuest && room.guest) room.guest.disconnected = true;

    socket.to(currentRoomCode).emit('peer_disconnected', {
      role: isHost ? 'host' : 'guest',
      gracePeriodMs: RECONNECT_GRACE_MS
    });

    // If both disconnected or room empty, schedule cleanup
    const bothGone = (!room.host || room.host.disconnected) && (!room.guest || room.guest.disconnected);
    if (bothGone) {
      if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
      room.cleanupTimer = setTimeout(() => {
        rooms.delete(currentRoomCode);
        console.log(`Cleaned up idle room ${currentRoomCode}`);
      }, RECONNECT_GRACE_MS);
    }
  });
});

// Start Server
server.listen(PORT, '0.0.0.0', () => {
  console.log(`SDG Multiplayer Server running on http://0.0.0.0:${PORT}`);
});
