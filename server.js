/**
 * Control Europe — Game Server
 * Express + Socket.io multiplayer strategy game
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── Adjacency Map ──────────────────────────────────────────────────────────
const ADJACENCY = {
  'Albania': ['Greece', 'North Macedonia', 'Montenegro', 'Serbia'],
  'Austria': ['Germany', 'Switzerland', 'Italy', 'Slovenia', 'Hungary', 'Czechia', 'Slovakia'],
  'Belgium': ['France', 'Netherlands', 'Luxembourg', 'Germany'],
  'Bosnia and Herzegovina': ['Croatia', 'Serbia', 'Montenegro'],
  'Bulgaria': ['Romania', 'Serbia', 'North Macedonia', 'Greece', 'Turkey'],
  'Belarus': ['Poland', 'Lithuania', 'Latvia', 'Russia', 'Ukraine'],
  'Croatia': ['Slovenia', 'Hungary', 'Serbia', 'Bosnia and Herzegovina', 'Montenegro'],
  'Czechia': ['Germany', 'Poland', 'Slovakia', 'Austria'],
  'Denmark': ['Germany', 'Sweden', 'Norway'],
  'Estonia': ['Latvia', 'Finland', 'Russia'],
  'Finland': ['Norway', 'Sweden', 'Russia', 'Estonia'],
  'France': ['Spain', 'Belgium', 'Luxembourg', 'Germany', 'Switzerland', 'Italy', 'United Kingdom'],
  'Germany': ['France', 'Belgium', 'Netherlands', 'Luxembourg', 'Switzerland', 'Austria', 'Czechia', 'Poland', 'Denmark'],
  'Greece': ['Albania', 'North Macedonia', 'Bulgaria', 'Turkey'],
  'Hungary': ['Austria', 'Slovakia', 'Ukraine', 'Romania', 'Serbia', 'Croatia', 'Slovenia'],
  'Iceland': ['United Kingdom', 'Norway'],
  'Ireland': ['United Kingdom'],
  'Italy': ['France', 'Switzerland', 'Austria', 'Slovenia'],
  'Latvia': ['Estonia', 'Lithuania', 'Russia', 'Belarus'],
  'Lithuania': ['Latvia', 'Poland', 'Belarus', 'Russia'],
  'Luxembourg': ['France', 'Belgium', 'Germany'],
  'Moldova': ['Romania', 'Ukraine'],
  'Montenegro': ['Serbia', 'Albania', 'Bosnia and Herzegovina', 'Croatia'],
  'North Macedonia': ['Greece', 'Bulgaria', 'Serbia', 'Albania'],
  'Netherlands': ['Belgium', 'Germany', 'United Kingdom'],
  'Norway': ['Sweden', 'Finland', 'Russia', 'Denmark', 'Iceland'],
  'Poland': ['Germany', 'Czechia', 'Slovakia', 'Ukraine', 'Belarus', 'Lithuania', 'Russia'],
  'Portugal': ['Spain'],
  'Romania': ['Hungary', 'Ukraine', 'Moldova', 'Bulgaria', 'Serbia'],
  'Russia': ['Norway', 'Finland', 'Estonia', 'Latvia', 'Lithuania', 'Poland', 'Belarus', 'Ukraine'],
  'Serbia': ['Hungary', 'Romania', 'Bulgaria', 'North Macedonia', 'Albania', 'Montenegro', 'Bosnia and Herzegovina', 'Croatia'],
  'Slovakia': ['Czechia', 'Poland', 'Ukraine', 'Hungary', 'Austria'],
  'Slovenia': ['Austria', 'Italy', 'Hungary', 'Croatia'],
  'Spain': ['Portugal', 'France'],
  'Sweden': ['Norway', 'Finland', 'Denmark'],
  'Switzerland': ['France', 'Germany', 'Austria', 'Italy'],
  'Turkey': ['Bulgaria', 'Greece'],
  'Ukraine': ['Poland', 'Slovakia', 'Hungary', 'Romania', 'Moldova', 'Belarus', 'Russia'],
  'United Kingdom': ['Ireland', 'France', 'Netherlands', 'Iceland', 'Norway'],
};

// ─── Player Colors ───────────────────────────────────────────────────────────
const PLAYER_COLORS = [
  { name: 'Cyan',    fill: '#00e5ff', dark: '#006978' },
  { name: 'Magenta', fill: '#ff4081', dark: '#8e0038' },
  { name: 'Gold',    fill: '#ffd740', dark: '#c8a600' },
  { name: 'Lime',    fill: '#76ff03', dark: '#32cb00' },
  { name: 'Orange',  fill: '#ff9100', dark: '#c56200' },
  { name: 'Purple',  fill: '#b388ff', dark: '#6200ea' },
];

// ─── Game State ──────────────────────────────────────────────────────────────
const rooms = new Map(); // roomId -> Room

function createRoom(name, maxPlayers, hostId, hostName) {
  const roomId = 'room_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const room = {
    id: roomId,
    name,
    maxPlayers: Math.min(Math.max(maxPlayers, 2), 6),
    hostId,
    players: new Map(),
    state: 'waiting', // waiting | playing | finished
    territories: {},  // countryName -> { owner: playerId, armies: number }
    turnOrder: [],
    currentTurnIndex: 0,
    phase: 'reinforce', // reinforce | attack | fortify
    reinforcementsLeft: 0,
    selectedTerritory: null,
    combatLog: [],
    turnTimeLimit: 120, // seconds
    turnTimer: null,
  };
  room.players.set(hostId, { id: hostId, name: hostName, colorIndex: 0, alive: true });
  rooms.set(roomId, room);
  return room;
}

function getRoomList() {
  const list = [];
  rooms.forEach(room => {
    list.push({
      id: room.id,
      name: room.name,
      players: room.players.size,
      maxPlayers: room.maxPlayers,
      state: room.state,
    });
  });
  return list;
}

function getCountryNames() {
  return Object.keys(ADJACENCY);
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function rollDice(count) {
  return Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1).sort((a, b) => b - a);
}

function startGame(room) {
  room.state = 'playing';
  const countries = getCountryNames();
  const playerIds = Array.from(room.players.keys());
  room.turnOrder = shuffleArray([...playerIds]);

  // Assign colors
  let colorIdx = 0;
  room.players.forEach(p => {
    p.colorIndex = colorIdx++;
  });

  // Distribute countries randomly
  const shuffled = shuffleArray([...countries]);
  shuffled.forEach((country, i) => {
    const ownerId = playerIds[i % playerIds.length];
    room.territories[country] = {
      owner: ownerId,
      armies: 1,
    };
  });

  // Give bonus starting armies
  const bonusArmies = Math.floor(countries.length / playerIds.length);
  playerIds.forEach(pid => {
    const ownedCountries = Object.entries(room.territories)
      .filter(([, t]) => t.owner === pid)
      .map(([name]) => name);
    // Distribute extra armies randomly on owned territories
    for (let i = 0; i < Math.floor(bonusArmies * 0.5); i++) {
      const c = ownedCountries[Math.floor(Math.random() * ownedCountries.length)];
      room.territories[c].armies++;
    }
  });

  room.currentTurnIndex = 0;
  room.phase = 'reinforce';
  room.reinforcementsLeft = calcReinforcements(room, room.turnOrder[0]);
}

function calcReinforcements(room, playerId) {
  const owned = Object.values(room.territories).filter(t => t.owner === playerId).length;
  return Math.max(3, Math.floor(owned / 3));
}

function getCurrentPlayer(room) {
  return room.turnOrder[room.currentTurnIndex];
}

function nextTurn(room) {
  // Check for eliminated players
  room.turnOrder = room.turnOrder.filter(pid => {
    const alive = Object.values(room.territories).some(t => t.owner === pid);
    if (!alive) {
      const player = room.players.get(pid);
      if (player) player.alive = false;
    }
    return alive;
  });

  // Check win
  const alivePlayers = room.turnOrder.length;
  if (alivePlayers <= 1) {
    room.state = 'finished';
    return;
  }

  room.currentTurnIndex = (room.currentTurnIndex) % room.turnOrder.length;
  // Actually advance
  room.currentTurnIndex = (room.currentTurnIndex + 1) % room.turnOrder.length;
  room.phase = 'reinforce';
  room.reinforcementsLeft = calcReinforcements(room, getCurrentPlayer(room));
}

function resolveCombat(attackerArmies, defenderArmies) {
  const atkDice = rollDice(Math.min(3, attackerArmies - 1));
  const defDice = rollDice(Math.min(2, defenderArmies));
  const comparisons = Math.min(atkDice.length, defDice.length);
  let atkLoss = 0;
  let defLoss = 0;

  for (let i = 0; i < comparisons; i++) {
    if (atkDice[i] > defDice[i]) {
      defLoss++;
    } else {
      atkLoss++;
    }
  }

  return { atkDice, defDice, atkLoss, defLoss };
}

function serializeRoom(room) {
  const players = {};
  room.players.forEach((p, id) => {
    players[id] = { ...p };
  });
  return {
    id: room.id,
    name: room.name,
    maxPlayers: room.maxPlayers,
    hostId: room.hostId,
    players,
    state: room.state,
    territories: room.territories,
    turnOrder: room.turnOrder,
    currentTurnIndex: room.currentTurnIndex,
    currentPlayer: room.state === 'playing' ? getCurrentPlayer(room) : null,
    phase: room.phase,
    reinforcementsLeft: room.reinforcementsLeft,
    adjacency: ADJACENCY,
    playerColors: PLAYER_COLORS,
  };
}

// ─── Socket.io ───────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);
  let currentRoomId = null;

  socket.on('get-rooms', (cb) => {
    if (typeof cb === 'function') cb(getRoomList());
  });

  socket.on('create-room', ({ name, maxPlayers, playerName }, cb) => {
    const room = createRoom(name, maxPlayers, socket.id, playerName);
    currentRoomId = room.id;
    socket.join(room.id);
    io.emit('rooms-updated', getRoomList());
    if (typeof cb === 'function') cb({ success: true, roomId: room.id });
  });

  socket.on('join-room', ({ roomId, playerName }, cb) => {
    const room = rooms.get(roomId);
    if (!room) return cb({ success: false, error: 'Room not found' });
    if (room.state !== 'waiting') return cb({ success: false, error: 'Game already started' });
    if (room.players.size >= room.maxPlayers) return cb({ success: false, error: 'Room is full' });

    room.players.set(socket.id, {
      id: socket.id,
      name: playerName,
      colorIndex: room.players.size,
      alive: true,
    });
    currentRoomId = roomId;
    socket.join(roomId);
    io.to(roomId).emit('room-state', serializeRoom(room));
    io.emit('rooms-updated', getRoomList());
    if (typeof cb === 'function') cb({ success: true });
  });

  socket.on('get-room-state', (cb) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    if (typeof cb === 'function') cb(serializeRoom(room));
  });

  socket.on('start-game', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.hostId !== socket.id) return;
    if (room.players.size < 2) return;
    startGame(room);
    io.to(currentRoomId).emit('room-state', serializeRoom(room));
    io.to(currentRoomId).emit('game-started');
    io.emit('rooms-updated', getRoomList());
  });

  socket.on('place-reinforcement', ({ country }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.state !== 'playing') return;
    if (getCurrentPlayer(room) !== socket.id) return;
    if (room.phase !== 'reinforce') return;
    if (!room.territories[country] || room.territories[country].owner !== socket.id) return;
    if (room.reinforcementsLeft <= 0) return;

    room.territories[country].armies++;
    room.reinforcementsLeft--;
    io.to(currentRoomId).emit('room-state', serializeRoom(room));
  });

  socket.on('attack', ({ from, to }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.state !== 'playing') return;
    if (getCurrentPlayer(room) !== socket.id) return;
    if (room.phase !== 'attack') return;

    const fromT = room.territories[from];
    const toT = room.territories[to];
    if (!fromT || !toT) return;
    if (fromT.owner !== socket.id) return;
    if (toT.owner === socket.id) return;
    if (fromT.armies < 2) return;

    // Check adjacency
    const neighbors = ADJACENCY[from] || [];
    if (!neighbors.includes(to)) return;

    const result = resolveCombat(fromT.armies, toT.armies);
    fromT.armies -= result.atkLoss;
    toT.armies -= result.defLoss;

    let conquered = false;
    if (toT.armies <= 0) {
      // Conquer
      const movingArmies = Math.min(fromT.armies - 1, 3);
      toT.owner = socket.id;
      toT.armies = movingArmies;
      fromT.armies -= movingArmies;
      conquered = true;
    }

    const attackerName = room.players.get(socket.id)?.name || 'Unknown';
    const defenderName = room.players.get(toT.owner)?.name || 'Unknown';

    const combatResult = {
      from,
      to,
      atkDice: result.atkDice,
      defDice: result.defDice,
      atkLoss: result.atkLoss,
      defLoss: result.defLoss,
      conquered,
      attackerName,
      defenderName,
    };

    io.to(currentRoomId).emit('combat-result', combatResult);

    // Check win
    const owners = new Set(Object.values(room.territories).map(t => t.owner));
    if (owners.size === 1) {
      room.state = 'finished';
      io.to(currentRoomId).emit('game-over', { winner: socket.id, winnerName: attackerName });
    }

    io.to(currentRoomId).emit('room-state', serializeRoom(room));
  });

  socket.on('fortify', ({ from, to, armies }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.state !== 'playing') return;
    if (getCurrentPlayer(room) !== socket.id) return;
    if (room.phase !== 'fortify') return;

    const fromT = room.territories[from];
    const toT = room.territories[to];
    if (!fromT || !toT) return;
    if (fromT.owner !== socket.id || toT.owner !== socket.id) return;
    if (fromT.armies <= armies || armies < 1) return;

    const neighbors = ADJACENCY[from] || [];
    if (!neighbors.includes(to)) return;

    fromT.armies -= armies;
    toT.armies += armies;
    io.to(currentRoomId).emit('room-state', serializeRoom(room));
  });

  socket.on('end-phase', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.state !== 'playing') return;
    if (getCurrentPlayer(room) !== socket.id) return;

    if (room.phase === 'reinforce') {
      room.reinforcementsLeft = 0;
      room.phase = 'attack';
    } else if (room.phase === 'attack') {
      room.phase = 'fortify';
    } else if (room.phase === 'fortify') {
      nextTurn(room);
    }

    io.to(currentRoomId).emit('room-state', serializeRoom(room));
  });

  socket.on('send-chat', ({ message }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;
    io.to(currentRoomId).emit('chat-message', {
      playerName: player.name,
      colorIndex: player.colorIndex,
      message,
      timestamp: Date.now(),
    });
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    if (currentRoomId) {
      const room = rooms.get(currentRoomId);
      if (room) {
        room.players.delete(socket.id);

        if (room.state === 'playing') {
          // Transfer territories to neutral or remove player
          Object.values(room.territories).forEach(t => {
            if (t.owner === socket.id) {
              t.owner = null; // neutral
            }
          });

          // Check if game should end
          const alivePlayers = room.turnOrder.filter(pid =>
            Object.values(room.territories).some(t => t.owner === pid)
          );
          if (alivePlayers.length <= 1) {
            room.state = 'finished';
            if (alivePlayers.length === 1) {
              const winner = room.players.get(alivePlayers[0]);
              io.to(currentRoomId).emit('game-over', {
                winner: alivePlayers[0],
                winnerName: winner?.name || 'Unknown',
              });
            }
          }

          // If it was this player's turn, advance
          if (room.turnOrder[room.currentTurnIndex] === socket.id) {
            room.turnOrder = room.turnOrder.filter(id => id !== socket.id);
            if (room.turnOrder.length > 0) {
              room.currentTurnIndex = room.currentTurnIndex % room.turnOrder.length;
              room.phase = 'reinforce';
              room.reinforcementsLeft = calcReinforcements(room, getCurrentPlayer(room));
            }
          } else {
            room.turnOrder = room.turnOrder.filter(id => id !== socket.id);
            // Recalculate currentTurnIndex
            const currentPlayerId = getCurrentPlayer(room);
            room.currentTurnIndex = room.turnOrder.indexOf(currentPlayerId);
            if (room.currentTurnIndex < 0) room.currentTurnIndex = 0;
          }
        }

        if (room.players.size === 0) {
          rooms.delete(currentRoomId);
        } else {
          // Transfer host
          if (room.hostId === socket.id) {
            room.hostId = room.players.keys().next().value;
          }
          io.to(currentRoomId).emit('room-state', serializeRoom(room));
        }
        io.emit('rooms-updated', getRoomList());
      }
    }
  });
});

// ─── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🌍 Control Europe server running at http://localhost:${PORT}\n`);
});
