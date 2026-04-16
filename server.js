const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set('trust proxy', 1);
app.use(express.static(path.join(__dirname, 'public')));

// Simple in-memory rate limit for create-room (optional hardening)
const createRoomAttempts = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30;
function createRoomRateLimit(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let record = createRoomAttempts.get(key);
  if (!record || now > record.resetAt) {
    record = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    createRoomAttempts.set(key, record);
  }
  record.count++;
  if (record.count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: 'Too many rooms created, try again later' });
  }
  next();
}

// --- Room State ---
const rooms = new Map();

const ADJECTIVES = [
  'funky', 'cosmic', 'mighty', 'sneaky', 'turbo', 'radical', 'epic',
  'groovy', 'blazing', 'mystic', 'noble', 'swift', 'brave', 'clever'
];
const NOUNS = [
  'panda', 'falcon', 'dragon', 'phoenix', 'tiger', 'kraken', 'wizard',
  'ninja', 'pirate', 'robot', 'unicorn', 'yeti', 'raptor', 'sphinx'
];
const ALLOWED_AVATARS = ['🤖', '🥷', '👽', '🧙', '🦊', '🐙', '🦄', '🐲', '🎃', '🦅', '🐺', '🧛', '🐱', '🐶', '🐼', '🦁', '🐸', '🐵', '🦉', '🐧', '🦩', '🐢', '🦋', '🐝', '🍀', '🌟', '⚡', '🔥', '❄️', '🌈'];
const MAX_NAME_LENGTH = 20;
/** Pause after both picks are broadcast so spectators can read live weapons before reveal / result. */
const RPS_LIVE_SPECTATE_HOLD_MS = 1600;

function generateRoomCode() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const code = `${adj}-${noun}`;
  if (rooms.has(code)) return generateRoomCode();
  return code;
}

function generatePlayerId() {
  return Math.random().toString(36).substring(2, 10);
}

function getProxyPlayerById(room, playerId) {
  return (room.proxyPlayers || []).find((p) => p.id === playerId);
}

function getPublicRpsState(room) {
  const rs = room.rpsState;
  if (!rs) return { selected: [], round: 0, submittedIds: [] };
  return {
    selected: [...(rs.selected || [])],
    round: rs.round || 0,
    submittedIds: Object.keys(rs.choices || {}),
  };
}

function getRoomState(room) {
  const realPlayers = Array.from(room.players.values()).map(p => ({ ...p, isProxy: false }));
  const proxyPlayers = (room.proxyPlayers || []).map(p => ({
    ...p,
    socketId: null,
    isProxy: true,
  }));
  return {
    code: room.code,
    hostId: room.hostId,
    players: [...realPlayers, ...proxyPlayers],
    phase: room.phase,
    rpsState: getPublicRpsState(room),
    readyIds: room.readyIds ? [...room.readyIds] : [],
  };
}

/** Sockets that submit choices for the current RPS matchup (must not receive opponent live picks). */
function getSocketsThatSubmitRPSChoices(room) {
  const sockets = new Set();
  const [id1, id2] = room.rpsState?.selected || [];
  if (!id1 || !id2) return sockets;
  for (const pid of [id1, id2]) {
    const real = [...room.players.values()].find((p) => p.id === pid);
    if (real?.socketId) sockets.add(real.socketId);
    else {
      const proxy = getProxyPlayerById(room, pid);
      if (proxy && !proxy.isComputer && room.hostId) sockets.add(room.hostId);
    }
  }
  return sockets;
}

async function emitRpsWaiting(room, roomCode) {
  const submitted = Object.keys(room.rpsState.choices);
  const liveChoices = { ...room.rpsState.choices };
  const restricted = getSocketsThatSubmitRPSChoices(room);
  const socks = await io.in(roomCode).fetchSockets();
  for (const s of socks) {
    if (restricted.has(s.id)) {
      s.emit('rps-waiting', { submitted });
    } else {
      s.emit('rps-waiting', { submitted, liveChoices });
    }
  }
}

async function maybeDelayThenTryResolve(room, roomCode) {
  if (Object.keys(room.rpsState.choices).length !== 2) {
    tryResolveRPS(room, roomCode);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, RPS_LIVE_SPECTATE_HOLD_MS));
  const r = rooms.get(roomCode);
  if (!r || r.phase !== 'rps') return;
  if (Object.keys(r.rpsState.choices).length !== 2) return;
  tryResolveRPS(r, roomCode);
}

function resolveRPS(a, b) {
  if (a === b) return 'tie';
  if ((a === 'rock' && b === 'scissors') ||
      (a === 'paper' && b === 'rock') ||
      (a === 'scissors' && b === 'paper')) return 'a';
  return 'b';
}

function tryResolveRPS(room, roomCode) {
  if (Object.keys(room.rpsState.choices).length !== 2) return;
  const [id1, id2] = room.rpsState.selected;
  const c1 = room.rpsState.choices[id1];
  const c2 = room.rpsState.choices[id2];
  const result = resolveRPS(c1, c2);

  if (result === 'tie') {
    io.to(roomCode).emit('rps-result', {
      choices: { [id1]: c1, [id2]: c2 },
      result: 'tie',
      round: room.rpsState.round,
    });
    room.rpsState.choices = {};
    room.rpsState.round++;
    setTimeout(async () => {
      const r = rooms.get(roomCode);
      if (r?.phase === 'rps') {
        io.to(roomCode).emit('room-state', getRoomState(r));
        await emitRpsWaiting(r, roomCode);
      }
    }, 2500);
  } else {
    const winnerId = result === 'a' ? id1 : id2;
    const loserId = result === 'a' ? id2 : id1;
    room.phase = 'result';
    // Loser becomes the new host next round (exempt from roll); only real players can be host
    const loserPlayer = [...room.players.values()].find(p => p.id === loserId);
    if (loserPlayer?.socketId) {
      room.hostId = loserPlayer.socketId;
    }
    io.to(roomCode).emit('rps-result', {
      choices: { [id1]: c1, [id2]: c2 },
      result: 'decided',
      winnerId,
      loserId,
      round: room.rpsState.round,
    });
    io.to(roomCode).emit('new-host', { playerId: loserId });
    setTimeout(() => io.to(roomCode).emit('room-state', getRoomState(room)), 500);
  }
}

function doRoll(room, roomCode) {
  const allPlayers = getRoomState(room).players;
  const hostPlayerId = room.players.get(room.hostId)?.id;
  const eligible = allPlayers.filter(p => p.id !== hostPlayerId);

  if (eligible.length < 2) return false;

  const shuffled = [...eligible].sort(() => Math.random() - 0.5);
  const selected = [shuffled[0].id, shuffled[1].id];

  const sequence = [];
  for (let i = 0; i < 20; i++) {
    const r1 = eligible[Math.floor(Math.random() * eligible.length)];
    const r2 = eligible[Math.floor(Math.random() * eligible.length)];
    sequence.push([r1.id, r2.id]);
  }
  sequence.push(selected);

  room.phase = 'rolling';
  room.rpsState = { selected, choices: {}, round: 1 };
  room.readyIds = new Set();

  io.to(roomCode).emit('room-state', getRoomState(room));
  io.to(roomCode).emit('dice-result', { selected, sequence });

  setTimeout(async () => {
    const r = rooms.get(roomCode);
    if (!r || r.phase !== 'rolling') return;
    r.phase = 'rps';
    const RPS_OPTIONS = ['rock', 'paper', 'scissors'];
    const [id1, id2] = r.rpsState.selected;
    [id1, id2].forEach(id => {
      const proxy = getProxyPlayerById(r, id);
      if (proxy && proxy.isComputer) {
        r.rpsState.choices[id] = RPS_OPTIONS[Math.floor(Math.random() * 3)];
      }
    });
    io.to(roomCode).emit('room-state', getRoomState(r));
    await emitRpsWaiting(r, roomCode);
    await maybeDelayThenTryResolve(r, roomCode);
  }, 4500);

  return true;
}

// --- Routes ---
app.get('/health', (req, res) => {
  res.status(200).json({ ok: true });
});

app.get('/room/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.post('/api/create-room', createRoomRateLimit, (req, res) => {
  const code = generateRoomCode();
  rooms.set(code, {
    code,
    hostId: null,
    players: new Map(),
    proxyPlayers: [],
    readyIds: new Set(),
    phase: 'lobby',
    rpsState: { selected: [], choices: {}, round: 0 },
  });
  res.json({ code });
});

// --- Socket.IO ---
io.on('connection', (socket) => {
  let currentRoom = null;
  let playerId = null;

  socket.on('join-room', ({ roomCode, name, avatar, existingPlayerId }) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit('error-msg', { message: 'Room not found' });
      return;
    }

    const trimmed = (name || '').trim();
    if (!trimmed || trimmed.length > MAX_NAME_LENGTH) {
      socket.emit('error-msg', { message: `Name must be 1–${MAX_NAME_LENGTH} characters` });
      return;
    }
    if (!avatar || !ALLOWED_AVATARS.includes(avatar)) {
      socket.emit('error-msg', { message: 'Please pick a valid avatar' });
      return;
    }

    // Reuse existing player ID if reconnecting
    playerId = existingPlayerId && Array.from(room.players.values()).some(p => p.id === existingPlayerId)
      ? existingPlayerId
      : generatePlayerId();

    // Check if this player ID already exists (reconnecting)
    const existingPlayer = Array.from(room.players.entries()).find(([, p]) => p.id === playerId);
    if (existingPlayer) {
      // Remove old socket mapping
      room.players.delete(existingPlayer[0]);
    }

    const player = { id: playerId, name: trimmed, avatar, socketId: socket.id };
    room.players.set(socket.id, player);
    currentRoom = roomCode;

    // First player becomes host
    if (!room.hostId || !room.players.has(room.hostId)) {
      room.hostId = socket.id;
    }

    socket.join(roomCode);
    socket.emit('joined', { playerId, roomState: getRoomState(room) });
    socket.to(roomCode).emit('player-joined', { player });
    io.to(roomCode).emit('room-state', getRoomState(room));
  });

  socket.on('transfer-host', ({ playerId: targetPlayerId }) => {
    const room = rooms.get(currentRoom);
    if (!room || socket.id !== room.hostId) return;
    const targetPlayer = Array.from(room.players.values()).find(p => p.id === targetPlayerId);
    if (!targetPlayer || !targetPlayer.socketId) {
      socket.emit('error-msg', { message: 'Can only transfer host to a connected player' });
      return;
    }
    if (targetPlayer.socketId === socket.id) return; // already host
    room.hostId = targetPlayer.socketId;
    io.to(currentRoom).emit('room-state', getRoomState(room));
  });

  socket.on('player-ready', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'lobby') return;
    const player = room.players.get(socket.id);
    if (!player) return;

    if (!room.readyIds) room.readyIds = new Set();
    room.readyIds.add(player.id);
    io.to(currentRoom).emit('room-state', getRoomState(room));

    const realCount = room.players.size;
    const readyCount = room.readyIds.size;
    const hostPlayerId = room.players.get(room.hostId)?.id;
    const allPlayers = getRoomState(room).players;
    const eligible = allPlayers.filter(p => p.id !== hostPlayerId);

    if (readyCount === realCount && eligible.length >= 2) {
      doRoll(room, currentRoom);
    }
  });

  socket.on('add-proxy-player', ({ name, avatar, isComputer }) => {
    const room = rooms.get(currentRoom);
    if (!room || socket.id !== room.hostId) return;
    const trimmed = (name || '').trim();
    if (!trimmed || trimmed.length > MAX_NAME_LENGTH) {
      socket.emit('error-msg', { message: `Name must be 1–${MAX_NAME_LENGTH} characters` });
      return;
    }
    if (!avatar || !ALLOWED_AVATARS.includes(avatar)) {
      socket.emit('error-msg', { message: 'Please pick a valid avatar' });
      return;
    }
    const proxy = {
      id: generatePlayerId(),
      name: trimmed,
      avatar,
      isComputer: Boolean(isComputer),
    };
    room.proxyPlayers = room.proxyPlayers || [];
    room.proxyPlayers.push(proxy);
    io.to(currentRoom).emit('room-state', getRoomState(room));
  });

  socket.on('remove-proxy-player', ({ playerId: proxyId }) => {
    const room = rooms.get(currentRoom);
    if (!room || socket.id !== room.hostId) return;
    if (!room.proxyPlayers) return;
    const idx = room.proxyPlayers.findIndex(p => p.id === proxyId);
    if (idx === -1) return;
    room.proxyPlayers.splice(idx, 1);
    io.to(currentRoom).emit('room-state', getRoomState(room));
  });

  socket.on('roll-dice', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'lobby' && room.phase !== 'result') return;
    const hostPlayerId = room.players.get(room.hostId)?.id;
    const allPlayers = getRoomState(room).players;
    const eligible = allPlayers.filter(p => p.id !== hostPlayerId);
    if (eligible.length < 2) {
      socket.emit('error-msg', { message: 'Need at least 2 eligible players (host is exempt)' });
      return;
    }
    doRoll(room, currentRoom);
  });

  socket.on('rps-choice', ({ choice, forPlayerId }) => {
    const room = rooms.get(currentRoom);
    if (!room || room.phase !== 'rps') return;

    const validChoices = ['rock', 'paper', 'scissors'];
    if (!validChoices.includes(choice)) return;

    if (forPlayerId != null) {
      if (socket.id !== room.hostId) return;
      if (!room.rpsState.selected.includes(forPlayerId)) return;
      const proxy = getProxyPlayerById(room, forPlayerId);
      if (!proxy || proxy.isComputer) return;
      room.rpsState.choices[forPlayerId] = choice;
    } else {
      const player = room.players.get(socket.id);
      if (!player || !room.rpsState.selected.includes(player.id)) return;
      room.rpsState.choices[player.id] = choice;
    }

    emitRpsWaiting(room, currentRoom).then(() => maybeDelayThenTryResolve(room, currentRoom));
  });

  socket.on('play-again', () => {
    const room = rooms.get(currentRoom);
    if (!room || socket.id !== room.hostId) return;
    room.phase = 'lobby';
    room.rpsState = { selected: [], choices: {}, round: 0 };
    room.readyIds = new Set();
    io.to(currentRoom).emit('room-state', getRoomState(room));
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;
    const room = rooms.get(currentRoom);
    if (!room) return;

    room.players.delete(socket.id);

    // If room is empty, clean it up
    if (room.players.size === 0) {
      rooms.delete(currentRoom);
      return;
    }

    // If host disconnected, reassign host to another player
    if (room.hostId === socket.id) {
      const newHostSocketId = room.players.keys().next().value;
      room.hostId = newHostSocketId || null;
    }

    io.to(currentRoom).emit('room-state', getRoomState(room));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Who's Next? running on http://localhost:${PORT}`);
});
