/**
 * Control Europe — Grand Strategy Game Server
 * Full-featured conquest engine:
 * - 14-player support (Discord Activity ready)
 * - Country selection with starting cities, treasury & manpower
 * - 78 strategic European cities with Economy & Manpower growth ticks
 * - City upgrades: Commercial Market, Military Barracks, Defense Citadel
 * - Troop recruitment & real-time Marching Armies with combat calculation
 * - Technology research tree (Military & Economy branches)
 * - Formable empires & Diplomacy (Alliances, War, Aid)
 * - Bot AI for solo/skirmish mode
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

app.use(express.static(path.join(__dirname, 'public')));

// ─── Load Game Data ─────────────────────────────────────────────────────────
const CITIES_DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'public/data/cities.json'), 'utf8'));
const COUNTRIES_DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'public/data/countries.json'), 'utf8'));
const TECHS_DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'public/data/techs.json'), 'utf8'));
const FORMABLES_DATA = JSON.parse(fs.readFileSync(path.join(__dirname, 'public/data/formables.json'), 'utf8'));

// Build adjacency / road connections between cities based on proximity
const CITY_CONNECTIONS = {};
const cityNames = Object.keys(CITIES_DATA);
cityNames.forEach(c1 => {
  CITY_CONNECTIONS[c1] = [];
  const p1 = CITIES_DATA[c1];
  cityNames.forEach(c2 => {
    if (c1 === c2) return;
    const p2 = CITIES_DATA[c2];
    const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    // Connect cities within reasonable tactical distance or same country
    const maxDist = (p1.country === p2.country) ? 140 : 110;
    if (dist <= maxDist) {
      CITY_CONNECTIONS[c1].push(c2);
    }
  });
  // Ensure every city has at least 2 connections to closest neighbors
  if (CITY_CONNECTIONS[c1].length < 2) {
    const sorted = [...cityNames]
      .filter(c => c !== c1)
      .sort((a, b) => Math.hypot(p1.x - CITIES_DATA[a].x, p1.y - CITIES_DATA[a].y) - Math.hypot(p1.x - CITIES_DATA[b].x, p1.y - CITIES_DATA[b].y));
    for (let i = 0; i < 2; i++) {
      if (sorted[i] && !CITY_CONNECTIONS[c1].includes(sorted[i])) {
        CITY_CONNECTIONS[c1].push(sorted[i]);
      }
    }
  }
});

// Symmetrical connections
Object.keys(CITY_CONNECTIONS).forEach(c1 => {
  CITY_CONNECTIONS[c1].forEach(c2 => {
    if (!CITY_CONNECTIONS[c2].includes(c1)) {
      CITY_CONNECTIONS[c2].push(c1);
    }
  });
});

const PLAYER_PALETTES = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6',
  '#6366f1', '#a855f7', '#d946ef', '#0ea5e9'
];

// ─── Room & Game State ──────────────────────────────────────────────────────
const rooms = new Map();

function createRoom(name, maxPlayers, hostId, hostName) {
  const roomId = 'eur_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const room = {
    id: roomId,
    name: name || 'Europe Conquest',
    maxPlayers: Math.min(Math.max(maxPlayers || 6, 2), 14),
    hostId,
    state: 'waiting', // waiting | picking | playing | finished
    players: new Map(), // socketId -> Player
    cities: {}, // cityName -> CityState
    marches: [], // active marching armies
    diplomacy: { alliances: [], wars: [] }, // pairs of playerIds
    combatLog: [],
    tickTimer: null,
    tickCount: 0,
    startTime: Date.now()
  };

  room.players.set(hostId, {
    id: hostId,
    name: hostName || 'Commander',
    color: PLAYER_PALETTES[0],
    country: null,
    money: 250,
    manpower: 150,
    incomeRate: 0,
    manpowerRate: 0,
    techs: [],
    formables: [],
    alive: true,
    isBot: false,
    stats: { conquered: 0, battlesWon: 0 }
  });

  rooms.set(roomId, room);
  return room;
}

function initGameCities(room) {
  room.cities = {};
  Object.keys(CITIES_DATA).forEach(cityName => {
    const raw = CITIES_DATA[cityName];
    room.cities[cityName] = {
      name: cityName,
      x: raw.x,
      y: raw.y,
      country: raw.country,
      isCapital: !!raw.isCapital,
      baseIncome: raw.income,
      baseManpower: raw.manpower,
      owner: null, // neutral initially
      armies: raw.isCapital ? 5 : 3,
      levelMarket: 0,
      levelBarracks: 0,
      levelFort: 0
    };
  });

  // Assign player starting countries
  room.players.forEach(player => {
    if (player.country && COUNTRIES_DATA[player.country]) {
      const cData = COUNTRIES_DATA[player.country];
      player.money = cData.startMoney || 250;
      player.manpower = cData.startManpower || 150;
      player.color = cData.color || player.color;

      cData.cities.forEach(cName => {
        if (room.cities[cName]) {
          room.cities[cName].owner = player.id;
          room.cities[cName].armies = room.cities[cName].isCapital ? 12 : 5;
        }
      });
    }
  });

  recalculateRates(room);
}

function recalculateRates(room) {
  room.players.forEach(player => {
    let income = 0;
    let manpower = 0;

    Object.values(room.cities).forEach(city => {
      if (city.owner === player.id) {
        // Market bonus: +40% per level
        const cityIncome = city.baseIncome * (1 + (city.levelMarket || 0) * 0.4);
        income += cityIncome;

        // Barracks bonus: +40% per level
        const cityManpower = city.baseManpower * (1 + (city.levelBarracks || 0) * 0.4);
        manpower += cityManpower;
      }
    });

    // Tech multiplier: Central Banking (+30% income)
    if (player.techs.includes('central_banking')) {
      income *= 1.30;
    }
    // Tech multiplier: Universal Conscription (+50% manpower)
    if (player.techs.includes('universal_conscription')) {
      manpower *= 1.50;
    }

    // Formables permanent bonus
    player.formables.forEach(fId => {
      const formable = FORMABLES_DATA[fId];
      if (formable && formable.reward && formable.reward.incomeBonus) {
        income += formable.reward.incomeBonus;
      }
    });

    player.incomeRate = Math.round(income);
    player.manpowerRate = Math.round(manpower);
  });
}

function processEconomicTick(room) {
  room.tickCount++;
  recalculateRates(room);

  // Add resources to players
  room.players.forEach(player => {
    if (!player.alive) return;
    player.money += Math.max(2, Math.round(player.incomeRate * 0.5));
    player.manpower += Math.max(1, Math.round(player.manpowerRate * 0.5));
  });

  // Process marching armies
  const now = Date.now();
  const finishedMarches = [];

  for (let i = room.marches.length - 1; i >= 0; i--) {
    const march = room.marches[i];
    if (now >= march.arriveTime) {
      finishedMarches.push(march);
      room.marches.splice(i, 1);
    }
  }

  finishedMarches.forEach(march => {
    resolveMarchArrival(room, march);
  });

  // Bot AI decision cycle every 2 ticks
  if (room.tickCount % 2 === 0) {
    runBotAI(room);
  }

  // Check victory condition
  checkVictory(room);

  io.to(room.id).emit('room-state', serializeRoom(room));
}

function resolveMarchArrival(room, march) {
  const targetCity = room.cities[march.toCity];
  if (!targetCity) return;

  const attacker = room.players.get(march.owner);
  const defender = targetCity.owner ? room.players.get(targetCity.owner) : null;
  const attackerName = attacker ? attacker.name : 'Unknown Army';
  const defenderName = defender ? defender.name : (targetCity.country + ' Garrison');

  // Friendly reinforcement
  if (targetCity.owner === march.owner || areAllies(room, march.owner, targetCity.owner)) {
    targetCity.armies += march.count;
    addCombatLog(room, `🛡️ ${attackerName} reinforced ${march.toCity} with ${march.count} troops.`);
    return;
  }

  // Combat calculation!
  let atkCombatBonus = 1.0;
  if (attacker?.techs?.includes('advanced_weaponry')) atkCombatBonus += 0.20;
  if (attacker?.techs?.includes('heavy_artillery') && (targetCity.levelFort || 0) > 0) atkCombatBonus += 0.40;

  let defCombatBonus = 1.0;
  if (defender?.techs?.includes('advanced_weaponry')) defCombatBonus += 0.20;
  if (targetCity.levelFort > 0) defCombatBonus += targetCity.levelFort * 0.35; // Fortress defense bonus

  const atkPower = march.count * atkCombatBonus * (0.85 + Math.random() * 0.3);
  const defPower = targetCity.armies * defCombatBonus * (0.85 + Math.random() * 0.3);

  let attackerSurvived = 0;
  let defenderSurvived = 0;
  let conquered = false;

  if (atkPower > defPower) {
    // Attacker wins
    conquered = true;
    const lossRatio = Math.min(0.8, defPower / (atkPower * 1.5));
    attackerSurvived = Math.max(1, Math.round(march.count * (1 - lossRatio)));
    const oldOwner = targetCity.owner;
    targetCity.owner = march.owner;
    targetCity.armies = attackerSurvived;

    if (attacker) attacker.stats.conquered++;
    addCombatLog(room, `⚔️ ${attackerName} conquered ${march.toCity} from ${defenderName}!`);

    // Check if old owner was eliminated
    if (oldOwner) {
      const remainingCities = Object.values(room.cities).filter(c => c.owner === oldOwner).length;
      if (remainingCities === 0) {
        const defeatedPlayer = room.players.get(oldOwner);
        if (defeatedPlayer) {
          defeatedPlayer.alive = false;
          addCombatLog(room, `💀 ${defeatedPlayer.name} has been eliminated!`);
        }
      }
    }
  } else {
    // Defender holds
    const lossRatio = Math.min(0.8, atkPower / (defPower * 1.5));
    defenderSurvived = Math.max(1, Math.round(targetCity.armies * (1 - lossRatio)));
    targetCity.armies = defenderSurvived;
    if (defender) defender.stats.battlesWon++;
    addCombatLog(room, `🛡️ ${defenderName} defended ${march.toCity} against ${attackerName}!`);
  }

  io.to(room.id).emit('combat-result', {
    fromCity: march.fromCity,
    toCity: march.toCity,
    attackerName,
    defenderName,
    conquered,
    attackerArmies: march.count,
    defenderArmies: targetCity.armies,
    attackerSurvived,
    defenderSurvived
  });

  recalculateRates(room);
}

function runBotAI(room) {
  room.players.forEach(bot => {
    if (!bot.isBot || !bot.alive) return;

    const botCities = Object.values(room.cities).filter(c => c.owner === bot.id);
    if (botCities.length === 0) return;

    // 1. Upgrade cities if wealthy
    botCities.forEach(city => {
      if (bot.money >= 180 && city.levelMarket < 3 && Math.random() < 0.4) {
        bot.money -= 120;
        city.levelMarket++;
      } else if (bot.money >= 200 && city.levelBarracks < 3 && Math.random() < 0.3) {
        bot.money -= 140;
        city.levelBarracks++;
      } else if (bot.money >= 220 && city.levelFort < 2 && Math.random() < 0.25) {
        bot.money -= 160;
        city.levelFort++;
      }
    });

    // 2. Recruit troops
    const recruitCandidate = botCities.reduce((prev, curr) => (curr.armies < prev.armies ? curr : prev), botCities[0]);
    if (recruitCandidate && bot.money >= 50 && bot.manpower >= 30) {
      const recruitAmt = Math.min(Math.floor(bot.money / 2), Math.floor(bot.manpower / 2), 25);
      if (recruitAmt > 5) {
        bot.money -= recruitAmt * 2;
        bot.manpower -= recruitAmt;
        recruitCandidate.armies += recruitAmt;
      }
    }

    // 3. Launch attacks / expansion
    botCities.forEach(city => {
      if (city.armies >= 15 && Math.random() < 0.5) {
        const neighbors = CITY_CONNECTIONS[city.name] || [];
        const targets = neighbors
          .map(name => room.cities[name])
          .filter(target => target && target.owner !== bot.id && !areAllies(room, bot.id, target.owner));

        if (targets.length > 0) {
          // Prefer weaker targets or neutral cities
          targets.sort((a, b) => a.armies - b.armies);
          const target = targets[0];
          const marchCount = Math.floor(city.armies * 0.7);
          city.armies -= marchCount;

          const p1 = CITIES_DATA[city.name];
          const p2 = CITIES_DATA[target.name];
          const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
          const duration = Math.max(3000, Math.min(12000, dist * 60));

          room.marches.push({
            id: 'm_' + Date.now() + Math.random().toString(36).slice(2, 5),
            owner: bot.id,
            ownerColor: bot.color,
            fromCity: city.name,
            toCity: target.name,
            count: marchCount,
            startTime: Date.now(),
            arriveTime: Date.now() + duration,
            duration
          });
        }
      }
    });
  });
}

function checkVictory(room) {
  const alivePlayers = Array.from(room.players.values()).filter(p => p.alive);
  if (alivePlayers.length === 1 && room.state === 'playing') {
    room.state = 'finished';
    const winner = alivePlayers[0];
    if (room.tickTimer) clearInterval(room.tickTimer);
    io.to(room.id).emit('game-over', { winner: winner.id, winnerName: winner.name, country: winner.country });
    addCombatLog(room, `👑 ${winner.name} (${winner.country}) has unified Europe!`);
  }
}

function areAllies(room, p1, p2) {
  if (!p1 || !p2 || p1 === p2) return false;
  return room.diplomacy.alliances.some(pair =>
    (pair[0] === p1 && pair[1] === p2) || (pair[0] === p2 && pair[1] === p1)
  );
}

function addCombatLog(room, msg) {
  room.combatLog.unshift({ text: msg, time: Date.now() });
  if (room.combatLog.length > 50) room.combatLog.pop();
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
    state: room.state,
    players,
    cities: room.cities,
    marches: room.marches,
    connections: CITY_CONNECTIONS,
    combatLog: room.combatLog.slice(0, 15),
    diplomacy: room.diplomacy,
  };
}

// ─── Socket.io Events ───────────────────────────────────────────────────────
io.on('connection', (socket) => {
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

    const colorIdx = room.players.size % PLAYER_PALETTES.length;
    room.players.set(socket.id, {
      id: socket.id,
      name: playerName || 'Commander',
      color: PLAYER_PALETTES[colorIdx],
      country: null,
      money: 250,
      manpower: 150,
      incomeRate: 0,
      manpowerRate: 0,
      techs: [],
      formables: [],
      alive: true,
      isBot: false,
      stats: { conquered: 0, battlesWon: 0 }
    });

    currentRoomId = roomId;
    socket.join(roomId);
    io.to(roomId).emit('room-state', serializeRoom(room));
    io.emit('rooms-updated', getRoomList());
    if (typeof cb === 'function') cb({ success: true });
  });

  socket.on('start-game', ({ mode }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.hostId !== socket.id) return;

    // Fill remaining slots with AI Bots if requested
    if (mode === 'bots' || room.players.size < 2) {
      const countryKeys = Object.keys(COUNTRIES_DATA);
      const chosenCountries = Array.from(room.players.values()).map(p => p.country).filter(Boolean);
      const availableCountries = countryKeys.filter(c => !chosenCountries.includes(c));

      const botNames = ['General Otto', 'Field Marshal Zhukov', 'General De Gaulle', 'Commander Wellington', 'Marshal Ney', 'Emperor Franz'];
      const neededBots = Math.min(room.maxPlayers - room.players.size, 5);

      for (let i = 0; i < neededBots; i++) {
        const botId = 'bot_' + Math.random().toString(36).slice(2, 7);
        const botCountry = availableCountries[i] || 'Germany';
        const colorIdx = (room.players.size + i) % PLAYER_PALETTES.length;

        room.players.set(botId, {
          id: botId,
          name: botNames[i] || `Bot Commander ${i + 1}`,
          color: PLAYER_PALETTES[colorIdx],
          country: botCountry,
          money: 300,
          manpower: 200,
          incomeRate: 0,
          manpowerRate: 0,
          techs: [],
          formables: [],
          alive: true,
          isBot: true,
          stats: { conquered: 0, battlesWon: 0 }
        });
      }
    }

    room.state = 'playing';
    initGameCities(room);

    // Start 4-second economic ticks
    if (room.tickTimer) clearInterval(room.tickTimer);
    room.tickTimer = setInterval(() => {
      processEconomicTick(room);
    }, 4000);

    io.to(currentRoomId).emit('room-state', serializeRoom(room));
    io.to(currentRoomId).emit('game-started');
    io.emit('rooms-updated', getRoomList());
  });

  socket.on('select-country', ({ country }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;

    // Ensure country isn't taken by another human
    const isTaken = Array.from(room.players.values()).some(p => p.id !== socket.id && p.country === country);
    if (isTaken) {
      return socket.emit('notification', { message: 'This nation is already claimed by another commander!' });
    }

    player.country = country;
    if (COUNTRIES_DATA[country]) {
      player.color = COUNTRIES_DATA[country].color || player.color;
    }

    // If game already started, update city ownership
    if (room.state === 'playing') {
      const cData = COUNTRIES_DATA[country];
      if (cData) {
        cData.cities.forEach(cName => {
          if (room.cities[cName]) {
            room.cities[cName].owner = player.id;
            room.cities[cName].armies = room.cities[cName].isCapital ? 12 : 5;
          }
        });
      }
      recalculateRates(room);
    }

    io.to(currentRoomId).emit('room-state', serializeRoom(room));
  });

  socket.on('recruit-troops', ({ cityName, count }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.state !== 'playing') return;
    const player = room.players.get(socket.id);
    const city = room.cities[cityName];

    if (!player || !city || city.owner !== socket.id) return;
    const troopCount = Math.max(1, Math.min(count, 500));
    const moneyCost = troopCount * 2;
    const manpowerCost = troopCount;

    if (player.money < moneyCost || player.manpower < manpowerCost) {
      return socket.emit('notification', { message: 'Insufficient funds or manpower to recruit!' });
    }

    player.money -= moneyCost;
    player.manpower -= manpowerCost;
    city.armies += troopCount;

    addCombatLog(room, `🪖 ${player.name} mobilized ${troopCount} soldiers in ${cityName}.`);
    io.to(currentRoomId).emit('room-state', serializeRoom(room));
  });

  socket.on('upgrade-city', ({ cityName, upgradeType }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.state !== 'playing') return;
    const player = room.players.get(socket.id);
    const city = room.cities[cityName];

    if (!player || !city || city.owner !== socket.id) return;

    let discount = player.techs.includes('industrialization') ? 0.75 : 1.0;
    let cost = 100;

    if (upgradeType === 'market') {
      if ((city.levelMarket || 0) >= 5) return;
      cost = Math.round((city.levelMarket + 1) * 100 * discount);
      if (player.money < cost) return;
      player.money -= cost;
      city.levelMarket = (city.levelMarket || 0) + 1;
      addCombatLog(room, `🏪 ${city.name} expanded commercial markets to Level ${city.levelMarket}.`);
    } else if (upgradeType === 'barracks') {
      if ((city.levelBarracks || 0) >= 5) return;
      cost = Math.round((city.levelBarracks + 1) * 120 * discount);
      if (player.money < cost) return;
      player.money -= cost;
      city.levelBarracks = (city.levelBarracks || 0) + 1;
      addCombatLog(room, `🪖 ${city.name} built barracks facilities to Level ${city.levelBarracks}.`);
    } else if (upgradeType === 'fort') {
      if ((city.levelFort || 0) >= 5) return;
      cost = Math.round((city.levelFort + 1) * 150 * discount);
      if (player.money < cost) return;
      player.money -= cost;
      city.levelFort = (city.levelFort || 0) + 1;
      addCombatLog(room, `🏰 ${city.name} fortified defenses to Level ${city.levelFort}.`);
    }

    recalculateRates(room);
    io.to(currentRoomId).emit('room-state', serializeRoom(room));
  });

  socket.on('march-armies', ({ fromCity, toCity, count }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.state !== 'playing') return;
    const player = room.players.get(socket.id);
    const from = room.cities[fromCity];
    const to = room.cities[toCity];

    if (!player || !from || !to || from.owner !== socket.id) return;
    if (from.armies <= count || count <= 0) return;

    // Check connectivity
    const neighbors = CITY_CONNECTIONS[fromCity] || [];
    if (!neighbors.includes(toCity)) {
      return socket.emit('notification', { message: 'No direct supply route between these cities!' });
    }

    from.armies -= count;

    // Calculate march duration based on distance & tech
    const p1 = CITIES_DATA[fromCity];
    const p2 = CITIES_DATA[toCity];
    const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    let duration = Math.max(3000, Math.min(14000, dist * 70));
    if (player.techs.includes('mechanized_logistics')) {
      duration *= 0.70; // 30% faster
    }

    const march = {
      id: 'm_' + Date.now() + Math.random().toString(36).slice(2, 5),
      owner: player.id,
      ownerColor: player.color,
      fromCity,
      toCity,
      count,
      startTime: Date.now(),
      arriveTime: Date.now() + duration,
      duration
    };

    room.marches.push(march);
    io.to(currentRoomId).emit('room-state', serializeRoom(room));
  });

  socket.on('research-tech', ({ techId }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.state !== 'playing') return;
    const player = room.players.get(socket.id);
    if (!player || player.techs.includes(techId)) return;

    // Find tech
    const allTechs = [...(TECHS_DATA.military || []), ...(TECHS_DATA.economic || [])];
    const tech = allTechs.find(t => t.id === techId);
    if (!tech) return;

    // Check prerequisite
    if (tech.req && !player.techs.includes(tech.req)) {
      return socket.emit('notification', { message: 'Prerequisite technology not researched yet!' });
    }

    if (player.money < tech.cost) {
      return socket.emit('notification', { message: 'Insufficient funds to research this tech!' });
    }

    player.money -= tech.cost;
    player.techs.push(techId);
    addCombatLog(room, `🧪 ${player.name} mastered ${tech.name}!`);

    recalculateRates(room);
    io.to(currentRoomId).emit('room-state', serializeRoom(room));
  });

  socket.on('claim-formable', ({ formableId }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.state !== 'playing') return;
    const player = room.players.get(socket.id);
    const formable = FORMABLES_DATA[formableId];
    if (!player || !formable || player.formables.includes(formableId)) return;

    // Check if player owns all required cities
    const hasAll = formable.cities.every(cName => {
      const city = room.cities[cName];
      return city && city.owner === player.id;
    });

    if (!hasAll) {
      return socket.emit('notification', { message: 'You have not conquered all required cities for this empire!' });
    }

    player.formables.push(formableId);
    if (formable.reward) {
      player.money += formable.reward.money || 0;
      player.manpower += formable.reward.manpower || 0;
    }
    if (formable.color) {
      player.color = formable.color;
    }

    addCombatLog(room, `👑 ${player.name} proclaimed the ${formable.name}! All hail the Emperor!`);
    io.to(currentRoomId).emit('formable-claimed', {
      playerName: player.name,
      empireName: formable.name,
      icon: formable.icon
    });

    recalculateRates(room);
    io.to(currentRoomId).emit('room-state', serializeRoom(room));
  });

  socket.on('propose-alliance', ({ targetId }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const p1 = socket.id;
    const p2 = targetId;
    if (areAllies(room, p1, p2)) return;

    room.diplomacy.alliances.push([p1, p2]);
    const name1 = room.players.get(p1)?.name || 'Commander';
    const name2 = room.players.get(p2)?.name || 'Commander';
    addCombatLog(room, `🤝 Alliance formed between ${name1} and ${name2}!`);
    io.to(currentRoomId).emit('room-state', serializeRoom(room));
  });

  socket.on('break-alliance', ({ targetId }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    room.diplomacy.alliances = room.diplomacy.alliances.filter(pair =>
      !( (pair[0] === socket.id && pair[1] === targetId) || (pair[0] === targetId && pair[1] === socket.id) )
    );
    const name1 = room.players.get(socket.id)?.name || 'Commander';
    const name2 = room.players.get(targetId)?.name || 'Commander';
    addCombatLog(room, `⚠️ ${name1} broke the alliance with ${name2}! War is imminent.`);
    io.to(currentRoomId).emit('room-state', serializeRoom(room));
  });

  socket.on('send-aid', ({ targetId, amount }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;
    const sender = room.players.get(socket.id);
    const receiver = room.players.get(targetId);
    if (!sender || !receiver || sender.money < amount || amount <= 0) return;

    sender.money -= amount;
    receiver.money += amount;
    addCombatLog(room, `💸 ${sender.name} sent $${amount} in foreign aid to ${receiver.name}.`);
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
      color: player.color,
      message,
      timestamp: Date.now(),
    });
  });

  socket.on('disconnect', () => {
    if (currentRoomId) {
      const room = rooms.get(currentRoomId);
      if (room) {
        const player = room.players.get(socket.id);
        if (player) player.alive = false;

        room.players.delete(socket.id);

        if (room.players.size === 0) {
          if (room.tickTimer) clearInterval(room.tickTimer);
          rooms.delete(currentRoomId);
        } else {
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🌍 Control Europe Grand-Strategy Server running at http://localhost:${PORT}\n`);
});
