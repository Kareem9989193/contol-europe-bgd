/**
 * game.js — Game Logic + Socket.io Client
 * Handles lobby, game flow, combat, and server communication
 */

const Game = (() => {
  let socket = null;
  let playerName = '';
  let roomState = null;
  let selectedFrom = null;

  const PLAYER_COLORS_CSS = [
    '#00e5ff', '#ff4081', '#ffd740', '#76ff03', '#ff9100', '#b388ff',
  ];

  // ─── Socket Connection ───────────────────────────────────────────────
  function connect() {
    socket = io();

    socket.on('connect', () => {
      console.log('Connected:', socket.id);
    });

    socket.on('rooms-updated', (rooms) => {
      renderRoomsList(rooms);
    });

    socket.on('room-state', (state) => {
      roomState = state;
      updateGameUI();
      EuropeMap.setGameState(state);
    });

    socket.on('game-started', () => {
      showScreen('game-screen');
    });

    socket.on('combat-result', (result) => {
      showCombatAnimation(result);
      addCombatLogEntry(result);
    });

    socket.on('game-over', ({ winner, winnerName }) => {
      showVictory(winnerName, winner === socket.id);
    });

    socket.on('chat-message', (msg) => {
      addChatMessage(msg);
    });
  }

  // ─── Screen Management ───────────────────────────────────────────────
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }

  // ─── Lobby ───────────────────────────────────────────────────────────
  function enterLobby(name) {
    playerName = name;
    document.getElementById('lobby-player-name').textContent = `Commander: ${name}`;
    showScreen('lobby-screen');
    socket.emit('get-rooms', (rooms) => {
      renderRoomsList(rooms);
    });
  }

  function createRoom(roomName, maxPlayers) {
    socket.emit('create-room', { name: roomName, maxPlayers, playerName }, (res) => {
      if (res.success) {
        socket.emit('get-room-state', (state) => {
          roomState = state;
          showWaitingRoom();
        });
      }
    });
  }

  function joinRoom(roomId) {
    socket.emit('join-room', { roomId, playerName }, (res) => {
      if (res.success) {
        socket.emit('get-room-state', (state) => {
          roomState = state;
          showWaitingRoom();
        });
      } else {
        alert(res.error || 'Could not join room');
      }
    });
  }

  function renderRoomsList(rooms) {
    const list = document.getElementById('rooms-list');
    const waitingRooms = rooms.filter(r => r.state === 'waiting');

    if (waitingRooms.length === 0) {
      list.innerHTML = '<p class="no-rooms">No rooms available. Create one!</p>';
      return;
    }

    list.innerHTML = waitingRooms.map(room => `
      <div class="room-item" data-room-id="${room.id}">
        <div class="room-item-info">
          <div class="room-item-name">${escapeHtml(room.name)}</div>
          <div class="room-item-players">👥 ${room.players}/${room.maxPlayers} players</div>
        </div>
        <button class="btn btn-primary btn-sm join-room-btn" style="margin-top:0;width:auto;">JOIN</button>
      </div>
    `).join('');

    list.querySelectorAll('.join-room-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const roomId = e.target.closest('.room-item').dataset.roomId;
        joinRoom(roomId);
      });
    });
  }

  // ─── Waiting Room ────────────────────────────────────────────────────
  function showWaitingRoom() {
    showScreen('waiting-screen');
    updateWaitingRoom();
  }

  function updateWaitingRoom() {
    if (!roomState) return;

    document.getElementById('waiting-room-name').textContent = roomState.name;

    const playersDiv = document.getElementById('waiting-players');
    playersDiv.innerHTML = Object.values(roomState.players).map((p, i) => `
      <div class="waiting-player" style="animation-delay: ${i * 0.1}s">
        <div class="player-color-dot" style="color: ${PLAYER_COLORS_CSS[p.colorIndex]}; background: ${PLAYER_COLORS_CSS[p.colorIndex]};"></div>
        <span class="waiting-player-name">${escapeHtml(p.name)}</span>
        ${p.id === roomState.hostId ? '<span class="host-tag">HOST</span>' : ''}
      </div>
    `).join('');

    const startBtn = document.getElementById('start-game-btn');
    const isHost = roomState.hostId === socket.id;
    const hasEnoughPlayers = Object.keys(roomState.players).length >= 2;
    startBtn.style.display = isHost ? 'inline-flex' : 'none';
    startBtn.disabled = !hasEnoughPlayers;
    startBtn.style.opacity = hasEnoughPlayers ? 1 : 0.5;
  }

  // ─── Game UI ─────────────────────────────────────────────────────────
  function updateGameUI() {
    if (!roomState || roomState.state !== 'playing') {
      if (roomState?.state === 'waiting') {
        updateWaitingRoom();
      }
      return;
    }

    const currentPlayerId = roomState.currentPlayer;
    const currentPlayer = roomState.players[currentPlayerId];
    const isMyTurn = currentPlayerId === socket.id;

    // Turn info
    const nameEl = document.getElementById('current-player-name');
    nameEl.textContent = currentPlayer ? `${currentPlayer.name}'s Turn` : '—';
    nameEl.style.color = currentPlayer ? PLAYER_COLORS_CSS[currentPlayer.colorIndex] : 'inherit';

    const phaseEl = document.getElementById('current-phase');
    phaseEl.textContent = roomState.phase.toUpperCase();
    phaseEl.className = 'phase-badge ' + roomState.phase;

    // Reinforcements
    const rcEl = document.getElementById('reinforcements-counter');
    const rcCount = document.getElementById('reinforcements-count');
    if (roomState.phase === 'reinforce' && isMyTurn) {
      rcEl.style.display = 'flex';
      rcCount.textContent = roomState.reinforcementsLeft;
    } else {
      rcEl.style.display = 'none';
    }

    // End phase button
    const endBtn = document.getElementById('end-phase-btn');
    endBtn.style.display = isMyTurn ? 'inline-flex' : 'none';
    if (roomState.phase === 'reinforce') {
      endBtn.textContent = roomState.reinforcementsLeft > 0 ? 'SKIP REINFORCE →' : 'START ATTACK →';
    } else if (roomState.phase === 'attack') {
      endBtn.textContent = 'END ATTACK →';
    } else {
      endBtn.textContent = 'END TURN →';
    }

    // Players list
    updatePlayersPanel();
  }

  function updatePlayersPanel() {
    if (!roomState) return;
    const list = document.getElementById('game-players-list');
    const territoryCounts = {};

    Object.values(roomState.territories).forEach(t => {
      if (t.owner) {
        territoryCounts[t.owner] = (territoryCounts[t.owner] || 0) + 1;
      }
    });

    list.innerHTML = roomState.turnOrder.map(pid => {
      const p = roomState.players[pid];
      if (!p) return '';
      const isCurrent = pid === roomState.currentPlayer;
      const isAlive = p.alive !== false && (territoryCounts[pid] || 0) > 0;
      return `
        <div class="game-player-item ${isCurrent ? 'active-turn' : ''} ${!isAlive ? 'eliminated' : ''}">
          <div class="player-color-dot" style="color: ${PLAYER_COLORS_CSS[p.colorIndex]}; background: ${PLAYER_COLORS_CSS[p.colorIndex]};"></div>
          <span>${escapeHtml(p.name)}</span>
          <span class="player-territory-count">${territoryCounts[pid] || 0} 🏴</span>
        </div>
      `;
    }).join('');
  }

  // ─── Map Interaction ─────────────────────────────────────────────────
  function handleCountryClick(country) {
    if (!roomState || roomState.state !== 'playing') return;
    if (roomState.currentPlayer !== socket.id) return;

    const territory = roomState.territories[country];
    if (!territory) return;

    if (roomState.phase === 'reinforce') {
      // Place reinforcement on own territory
      if (territory.owner === socket.id && roomState.reinforcementsLeft > 0) {
        socket.emit('place-reinforcement', { country });
        EuropeMap.setSelected(country);
        setTimeout(() => EuropeMap.clearSelection(), 300);
      }
    } else if (roomState.phase === 'attack') {
      if (!selectedFrom) {
        // Select source (must be own territory with 2+ armies)
        if (territory.owner === socket.id && territory.armies >= 2) {
          selectedFrom = country;
          EuropeMap.setSelected(country);
        }
      } else {
        if (country === selectedFrom) {
          // Deselect
          selectedFrom = null;
          EuropeMap.clearSelection();
        } else if (territory.owner === socket.id) {
          // Switch selection to another own territory
          selectedFrom = country;
          EuropeMap.setSelected(country);
          EuropeMap.setTarget(null);
        } else {
          // Attack! Check adjacency
          const adj = roomState.adjacency[selectedFrom] || [];
          if (adj.includes(country)) {
            EuropeMap.setTarget(country);
            socket.emit('attack', { from: selectedFrom, to: country });
            // Keep selection for continuous attacks
          }
        }
      }
    } else if (roomState.phase === 'fortify') {
      if (!selectedFrom) {
        if (territory.owner === socket.id && territory.armies >= 2) {
          selectedFrom = country;
          EuropeMap.setSelected(country);
        }
      } else {
        if (country === selectedFrom) {
          selectedFrom = null;
          EuropeMap.clearSelection();
        } else if (territory.owner === socket.id) {
          // Fortify
          const adj = roomState.adjacency[selectedFrom] || [];
          if (adj.includes(country)) {
            const fromT = roomState.territories[selectedFrom];
            const armies = Math.max(1, Math.floor((fromT.armies - 1) / 2));
            socket.emit('fortify', { from: selectedFrom, to: country, armies });
            selectedFrom = null;
            EuropeMap.clearSelection();
          } else {
            // Switch selection
            if (territory.armies >= 2) {
              selectedFrom = country;
              EuropeMap.setSelected(country);
            }
          }
        }
      }
    }
  }

  function handleCountryHover(country, mx, my) {
    const tooltip = document.getElementById('country-tooltip');

    if (!country) {
      tooltip.style.display = 'none';
      return;
    }

    const territory = roomState?.territories?.[country];
    const owner = territory?.owner;
    const ownerPlayer = owner ? roomState.players[owner] : null;

    document.getElementById('tooltip-name').textContent = country;
    document.getElementById('tooltip-owner').textContent = ownerPlayer
      ? `Owner: ${ownerPlayer.name}`
      : 'Neutral';
    document.getElementById('tooltip-owner').style.color = ownerPlayer
      ? PLAYER_COLORS_CSS[ownerPlayer.colorIndex]
      : '#8892a4';
    document.getElementById('tooltip-armies').textContent = territory
      ? `⚔️ ${territory.armies} armies`
      : '';

    tooltip.style.display = 'block';
    tooltip.style.left = (mx + 16) + 'px';
    tooltip.style.top = (my - 10) + 'px';

    // Keep tooltip in viewport
    const rect = tooltip.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      tooltip.style.left = (mx - rect.width - 16) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      tooltip.style.top = (my - rect.height - 10) + 'px';
    }
  }

  // ─── Combat Animation ───────────────────────────────────────────────
  function showCombatAnimation(result) {
    const overlay = document.getElementById('combat-overlay');
    document.getElementById('combat-atk-name').textContent = result.from;
    document.getElementById('combat-def-name').textContent = result.to;

    // Dice
    const atkDiceEl = document.getElementById('combat-atk-dice');
    const defDiceEl = document.getElementById('combat-def-dice');
    atkDiceEl.innerHTML = result.atkDice.map(d => `<div class="dice atk">${d}</div>`).join('');
    defDiceEl.innerHTML = result.defDice.map(d => `<div class="dice def">${d}</div>`).join('');

    // Result text
    const resultText = document.getElementById('combat-result-text');
    if (result.conquered) {
      resultText.textContent = `🏴 ${result.from} CONQUERED!`;
      resultText.style.color = '#ffd740';
    } else {
      const parts = [];
      if (result.atkLoss > 0) parts.push(`Attacker lost ${result.atkLoss}`);
      if (result.defLoss > 0) parts.push(`Defender lost ${result.defLoss}`);
      resultText.textContent = parts.join(' • ');
      resultText.style.color = '#8892a4';
    }

    overlay.style.display = 'flex';

    setTimeout(() => {
      overlay.style.display = 'none';
    }, 2200);
  }

  function addCombatLogEntry(result) {
    const log = document.getElementById('combat-log');
    const entry = document.createElement('div');
    entry.className = 'combat-log-entry' + (result.conquered ? ' conquest' : '');

    const atkDiceStr = result.atkDice.map(d => `🎲${d}`).join(' ');
    const defDiceStr = result.defDice.map(d => `🎲${d}`).join(' ');

    entry.innerHTML = `
      <strong>${escapeHtml(result.from)}</strong> → <strong>${escapeHtml(result.to)}</strong><br/>
      ${atkDiceStr} vs ${defDiceStr}<br/>
      ${result.conquered
        ? '<span style="color:#ffd740;">🏴 Territory Conquered!</span>'
        : `<span style="color:#8892a4;">ATK -${result.atkLoss} / DEF -${result.defLoss}</span>`
      }
    `;

    log.insertBefore(entry, log.firstChild);

    // Keep only last 50 entries
    while (log.children.length > 50) {
      log.removeChild(log.lastChild);
    }
  }

  // ─── Chat ────────────────────────────────────────────────────────────
  function sendChat(message) {
    if (!message.trim()) return;
    socket.emit('send-chat', { message: message.trim() });
  }

  function addChatMessage(msg) {
    const container = document.getElementById('chat-messages');
    const el = document.createElement('div');
    el.className = 'chat-msg';
    el.innerHTML = `<span class="chat-msg-name" style="color:${PLAYER_COLORS_CSS[msg.colorIndex]}">${escapeHtml(msg.playerName)}:</span>${escapeHtml(msg.message)}`;
    container.appendChild(el);
    container.scrollTop = container.scrollHeight;

    // Show badge if collapsed
    const panel = document.getElementById('chat-panel');
    if (panel.classList.contains('collapsed')) {
      document.getElementById('chat-badge').style.display = 'flex';
    }
  }

  // ─── Victory ─────────────────────────────────────────────────────────
  function showVictory(winnerName, isMe) {
    const overlay = document.getElementById('victory-overlay');
    const message = document.getElementById('victory-message');
    message.textContent = isMe
      ? 'You have conquered all of Europe!'
      : `${winnerName} has conquered all of Europe!`;
    overlay.style.display = 'flex';
  }

  // ─── Utils ───────────────────────────────────────────────────────────
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function endPhase() {
    socket.emit('end-phase');
    selectedFrom = null;
    EuropeMap.clearSelection();
  }

  function startGameRequest() {
    socket.emit('start-game');
  }

  function leaveRoom() {
    if (socket) socket.disconnect();
    socket = null;
    connect();
    roomState = null;
    showScreen('lobby-screen');
    socket.emit('get-rooms', (rooms) => {
      renderRoomsList(rooms);
    });
  }

  function backToLobby() {
    if (socket) socket.disconnect();
    socket = null;
    connect();
    roomState = null;
    document.getElementById('victory-overlay').style.display = 'none';
    showScreen('lobby-screen');
    socket.emit('get-rooms', (rooms) => {
      renderRoomsList(rooms);
    });
  }

  function getSocket() { return socket; }
  function getPlayerName() { return playerName; }
  function getRoomState() { return roomState; }

  return {
    connect,
    enterLobby,
    createRoom,
    joinRoom,
    startGameRequest,
    leaveRoom,
    backToLobby,
    handleCountryClick,
    handleCountryHover,
    endPhase,
    sendChat,
    showScreen,
    getSocket,
    getPlayerName,
    getRoomState,
  };
})();
