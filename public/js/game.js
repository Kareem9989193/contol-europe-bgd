/**
 * game.js — Grand-Strategy Game Controller & Network Sync
 * Coordinates server rooms, AI skirmish fallback, turns, combat, and HUD
 */

const Game = (() => {
  let socket = null;
  let playerName = 'Commander Alpha';
  let roomState = null;
  let selectedFrom = null;
  let isBotGame = false;

  const FACTION_COLORS = ['#00f0ff', '#ef4444', '#ffd700', '#10f070', '#f59e0b', '#a855f7'];

  // ─── Network Connection ──────────────────────────────────────────────
  function connect() {
    try {
      socket = io({
        reconnectionAttempts: 5,
        timeout: 8000,
      });

      socket.on('connect', () => {
        console.log('📡 Connected to Europe Conquest Server:', socket.id);
      });

      socket.on('rooms-updated', (rooms) => {
        renderLobbyRooms(rooms);
      });

      socket.on('room-state', (state) => {
        roomState = state;
        updateTacticalHUD();
        EuropeMap.setGameState(state);
      });

      socket.on('game-started', () => {
        closeAllModals();
        showScreen('game-screen');
      });

      socket.on('combat-result', (result) => {
        triggerCombatClashModal(result);
        appendBattleIntel(result);
      });

      socket.on('game-over', ({ winner, winnerName }) => {
        triggerVictoryBanner(winnerName, winner === (socket ? socket.id : 'me'));
      });

      socket.on('chat-message', (msg) => {
        appendCommsMessage(msg);
      });

      socket.on('connect_error', () => {
        console.warn('⚠️ Server unreachable. AI Battle Mode available.');
      });
    } catch (e) {
      console.warn('Running in standalone/offline mode:', e);
    }
  }

  // ─── Screen & Modal Controls ─────────────────────────────────────────
  function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(screenId);
    if (target) target.classList.add('active');
  }

  function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'flex';
  }

  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'none';
  }

  function closeAllModals() {
    document.querySelectorAll('.tactical-modal-backdrop').forEach(m => m.style.display = 'none');
  }

  // ─── Game Creation & Joining ─────────────────────────────────────────
  function createGame(roomName, maxPlayers, commanderName, mode) {
    playerName = commanderName;
    isBotGame = (mode === 'bots');

    if (isBotGame || !socket || !socket.connected) {
      // Initialize Local AI Grand-Strategy Campaign
      startLocalCampaign(roomName, maxPlayers, commanderName);
      return;
    }

    socket.emit('create-room', { name: roomName, maxPlayers, playerName: commanderName }, (res) => {
      if (res && res.success) {
        openWaitingCouncil(res.roomId, roomName, true);
      }
    });
  }

  function joinGame(roomId, commanderName) {
    playerName = commanderName;

    if (!socket || !socket.connected) {
      // Start local room
      startLocalCampaign('Operation ' + roomId, 4, commanderName);
      return;
    }

    socket.emit('join-room', { roomId, playerName: commanderName }, (res) => {
      if (res && res.success) {
        openWaitingCouncil(roomId, 'Operation Theater', false);
      } else {
        alert(res?.error || 'Unable to join operation theater. Launching local campaign...');
        startLocalCampaign('Operation Overlord', 4, commanderName);
      }
    });
  }

  function openWaitingCouncil(roomId, roomName, isHost) {
    closeAllModals();
    openModal('modal-waiting-room');

    document.getElementById('waiting-room-title').textContent = `OPERATION: ${roomName.toUpperCase()}`;
    const shareInput = document.getElementById('room-share-link');
    if (shareInput) {
      shareInput.value = `${window.location.origin}?room=${roomId}`;
    }

    const startBtn = document.getElementById('btn-launch-game');
    if (startBtn) {
      startBtn.style.display = isHost ? 'inline-flex' : 'none';
    }

    updateWaitingPlayersGrid();
  }

  function updateWaitingPlayersGrid() {
    const grid = document.getElementById('waiting-commanders-grid');
    if (!grid) return;

    if (roomState?.players) {
      grid.innerHTML = Object.values(roomState.players).map(p => `
        <div class="waiting-commander-card ${p.id === socket?.id ? 'me' : ''} ${p.id === roomState.hostId ? 'host' : ''}">
          <span style="color: ${FACTION_COLORS[p.colorIndex % FACTION_COLORS.length]}">●</span>
          <span class="name">${escapeHtml(p.name)}</span>
          ${p.id === roomState.hostId ? '<span class="host-crown">👑 HOST</span>' : ''}
        </div>
      `).join('');
    } else {
      grid.innerHTML = `
        <div class="waiting-commander-card me host">
          <span style="color: #00f0ff">●</span>
          <span class="name">${escapeHtml(playerName)}</span>
          <span class="host-crown">👑 HOST</span>
        </div>
        <div class="waiting-commander-card">
          <span style="color: #ef4444">●</span>
          <span class="name">Allied Commander (Waiting...)</span>
        </div>
      `;
    }
  }

  function renderLobbyRooms(rooms) {
    const list = document.getElementById('modal-rooms-list');
    if (!list) return;

    if (!rooms || rooms.length === 0) {
      list.innerHTML = `<p style="color:#94a3b8; font-size:12px; text-align:center; padding:16px;">No active multiplayer theaters. Launch one with "CREATE GAME"!</p>`;
      return;
    }

    list.innerHTML = rooms.map(r => `
      <div class="modal-room-item" data-id="${r.id}">
        <div>
          <div style="font-weight:700; color:#fff;">${escapeHtml(r.name)}</div>
          <div style="font-size:10px; color:#94a3b8;">${r.players}/${r.maxPlayers} Commanders • Status: ${r.state.toUpperCase()}</div>
        </div>
        <button class="tactical-btn glow-cyan" style="padding:6px 14px; font-size:10px;" onclick="Game.joinGame('${r.id}', document.getElementById('join-player-name').value)">ENTER</button>
      </div>
    `).join('');
  }

  // ─── Local Campaign Mode (Fallback & Bot Play) ────────────────────────
  function startLocalCampaign(roomName, totalPlayers, commanderName) {
    isBotGame = true;
    const countries = Object.keys(EuropeMap.getNodes());
    const factions = [commanderName, 'Kaiser Recon (AI)', 'General Zhukov (AI)', 'Vanguard Alex (AI)'].slice(0, totalPlayers);

    const players = {};
    factions.forEach((name, i) => {
      const pid = i === 0 ? 'me' : `bot_${i}`;
      players[pid] = { id: pid, name, colorIndex: i, isBot: i > 0, alive: true };
    });

    // Distribute countries
    const territories = {};
    countries.forEach((country, idx) => {
      const ownerId = Object.keys(players)[idx % factions.length];
      territories[country] = {
        owner: ownerId,
        armies: Math.floor(Math.random() * 2) + 2,
      };
    });

    const turnOrder = Object.keys(players);

    roomState = {
      id: 'local_campaign',
      name: roomName,
      players,
      territories,
      turnOrder,
      currentTurnIndex: 0,
      currentPlayer: turnOrder[0],
      phase: 'reinforce',
      reinforcementsLeft: 5,
      adjacency: getAdjacencyMap(),
    };

    closeAllModals();
    showScreen('game-screen');
    updateTacticalHUD();
    EuropeMap.setGameState(roomState);
  }

  function getAdjacencyMap() {
    return {
      'Albania': ['Greece', 'Montenegro', 'Serbia'],
      'Austria': ['Germany', 'Switzerland', 'Italy', 'Hungary', 'Czechia', 'Slovakia'],
      'Belgium': ['France', 'Netherlands', 'Germany'],
      'Bosnia and Herzegovina': ['Croatia', 'Serbia'],
      'Bulgaria': ['Romania', 'Serbia', 'Greece', 'Turkey'],
      'Belarus': ['Poland', 'Lithuania', 'Latvia', 'Russia', 'Ukraine'],
      'Croatia': ['Hungary', 'Serbia', 'Bosnia and Herzegovina'],
      'Czechia': ['Germany', 'Poland', 'Slovakia', 'Austria'],
      'Denmark': ['Germany', 'Sweden', 'Norway'],
      'Estonia': ['Latvia', 'Finland', 'Russia'],
      'Finland': ['Norway', 'Sweden', 'Russia', 'Estonia'],
      'France': ['Spain', 'Belgium', 'Germany', 'Switzerland', 'Italy', 'United Kingdom'],
      'Germany': ['France', 'Belgium', 'Netherlands', 'Switzerland', 'Austria', 'Czechia', 'Poland', 'Denmark'],
      'Greece': ['Albania', 'Bulgaria', 'Turkey'],
      'Hungary': ['Austria', 'Slovakia', 'Ukraine', 'Romania', 'Serbia', 'Croatia'],
      'Iceland': ['United Kingdom', 'Norway'],
      'Ireland': ['United Kingdom'],
      'Italy': ['France', 'Switzerland', 'Austria'],
      'Latvia': ['Estonia', 'Lithuania', 'Russia', 'Belarus'],
      'Lithuania': ['Latvia', 'Poland', 'Belarus', 'Russia'],
      'Norway': ['Sweden', 'Finland', 'Russia', 'Denmark', 'Iceland'],
      'Poland': ['Germany', 'Czechia', 'Slovakia', 'Ukraine', 'Belarus', 'Lithuania', 'Russia'],
      'Portugal': ['Spain'],
      'Romania': ['Hungary', 'Ukraine', 'Bulgaria', 'Serbia'],
      'Russia': ['Norway', 'Finland', 'Estonia', 'Latvia', 'Lithuania', 'Poland', 'Belarus', 'Ukraine'],
      'Serbia': ['Hungary', 'Romania', 'Bulgaria', 'Albania', 'Bosnia and Herzegovina', 'Croatia'],
      'Slovakia': ['Czechia', 'Poland', 'Ukraine', 'Hungary', 'Austria'],
      'Spain': ['Portugal', 'France'],
      'Sweden': ['Norway', 'Finland', 'Denmark'],
      'Switzerland': ['France', 'Germany', 'Austria', 'Italy'],
      'Turkey': ['Bulgaria', 'Greece'],
      'Ukraine': ['Poland', 'Slovakia', 'Hungary', 'Romania', 'Belarus', 'Russia'],
      'United Kingdom': ['Ireland', 'France', 'Netherlands', 'Iceland', 'Norway'],
    };
  }

  // ─── Tactical Map Interaction ─────────────────────────────────────────
  function handleCountryClick(country) {
    if (!roomState) return;
    const isMyTurn = isBotGame
      ? roomState.currentPlayer === 'me'
      : roomState.currentPlayer === socket?.id;

    if (!isMyTurn) return;

    const myId = isBotGame ? 'me' : socket?.id;
    const territory = roomState.territories[country];
    if (!territory) return;

    // 1. REINFORCE PHASE
    if (roomState.phase === 'reinforce') {
      if (territory.owner === myId && roomState.reinforcementsLeft > 0) {
        territory.armies++;
        roomState.reinforcementsLeft--;
        if (!isBotGame && socket) {
          socket.emit('place-reinforcement', { country });
        }
        updateTacticalHUD();
        EuropeMap.setSelected(country);
        setTimeout(() => EuropeMap.clearSelection(), 300);
      }
    }
    // 2. ATTACK PHASE
    else if (roomState.phase === 'attack') {
      if (!selectedFrom) {
        if (territory.owner === myId && territory.armies >= 2) {
          selectedFrom = country;
          EuropeMap.setSelected(country);
        }
      } else {
        if (country === selectedFrom) {
          selectedFrom = null;
          EuropeMap.clearSelection();
        } else if (territory.owner === myId) {
          selectedFrom = country;
          EuropeMap.setSelected(country);
        } else {
          // Check adjacency
          const adj = roomState.adjacency[selectedFrom] || [];
          if (adj.includes(country)) {
            EuropeMap.setTarget(country);
            executeAttack(selectedFrom, country);
          }
        }
      }
    }
    // 3. FORTIFY PHASE
    else if (roomState.phase === 'fortify') {
      if (!selectedFrom) {
        if (territory.owner === myId && territory.armies >= 2) {
          selectedFrom = country;
          EuropeMap.setSelected(country);
        }
      } else {
        if (country === selectedFrom) {
          selectedFrom = null;
          EuropeMap.clearSelection();
        } else if (territory.owner === myId) {
          const adj = roomState.adjacency[selectedFrom] || [];
          if (adj.includes(country)) {
            const fromT = roomState.territories[selectedFrom];
            const moving = Math.floor(fromT.armies / 2);
            fromT.armies -= moving;
            territory.armies += moving;
            selectedFrom = null;
            EuropeMap.clearSelection();
            advancePhase();
          }
        }
      }
    }
  }

  function executeAttack(fromCountry, toCountry) {
    if (!isBotGame && socket?.connected) {
      socket.emit('attack', { from: fromCountry, to: toCountry });
      return;
    }

    // Local Combat Resolution
    const fromT = roomState.territories[fromCountry];
    const toT = roomState.territories[toCountry];

    const atkDice = rollDice(Math.min(3, fromT.armies - 1));
    const defDice = rollDice(Math.min(2, toT.armies));

    let atkLoss = 0;
    let defLoss = 0;
    const comparisons = Math.min(atkDice.length, defDice.length);

    for (let i = 0; i < comparisons; i++) {
      if (atkDice[i] > defDice[i]) {
        defLoss++;
      } else {
        atkLoss++;
      }
    }

    fromT.armies -= atkLoss;
    toT.armies -= defLoss;

    let conquered = false;
    if (toT.armies <= 0) {
      conquered = true;
      const move = Math.max(1, fromT.armies - 1);
      toT.owner = fromT.owner;
      toT.armies = move;
      fromT.armies -= move;
    }

    const result = {
      from: fromCountry,
      to: toCountry,
      atkDice,
      defDice,
      atkLoss,
      defLoss,
      conquered,
      attackerName: roomState.players[fromT.owner]?.name || 'Attacker',
      defenderName: roomState.players[toT.owner]?.name || 'Defender',
    };

    triggerCombatClashModal(result);
    appendBattleIntel(result);
    updateTacticalHUD();

    // Check Victory
    const owners = new Set(Object.values(roomState.territories).map(t => t.owner));
    if (owners.size === 1) {
      triggerVictoryBanner(result.attackerName, fromT.owner === 'me');
    }
  }

  function rollDice(count) {
    return Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1).sort((a, b) => b - a);
  }

  function advancePhase() {
    if (!roomState) return;

    if (!isBotGame && socket?.connected) {
      socket.emit('end-phase');
      selectedFrom = null;
      EuropeMap.clearSelection();
      return;
    }

    selectedFrom = null;
    EuropeMap.clearSelection();

    if (roomState.phase === 'reinforce') {
      roomState.phase = 'attack';
    } else if (roomState.phase === 'attack') {
      roomState.phase = 'fortify';
    } else if (roomState.phase === 'fortify') {
      // Advance to next commander
      roomState.currentTurnIndex = (roomState.currentTurnIndex + 1) % roomState.turnOrder.length;
      roomState.currentPlayer = roomState.turnOrder[roomState.currentTurnIndex];
      roomState.phase = 'reinforce';
      roomState.reinforcementsLeft = Math.max(3, Math.floor(
        Object.values(roomState.territories).filter(t => t.owner === roomState.currentPlayer).length / 3
      ));

      // If Next is Bot, trigger Bot Turn
      if (roomState.players[roomState.currentPlayer]?.isBot) {
        setTimeout(runBotTurn, 1000);
      }
    }
    updateTacticalHUD();
  }

  function runBotTurn() {
    if (!roomState || !roomState.players[roomState.currentPlayer]?.isBot) return;

    const botId = roomState.currentPlayer;
    // 1. Bot Reinforce
    const botCountries = Object.entries(roomState.territories)
      .filter(([, t]) => t.owner === botId)
      .map(([name]) => name);

    if (botCountries.length > 0) {
      const target = botCountries[Math.floor(Math.random() * botCountries.length)];
      roomState.territories[target].armies += roomState.reinforcementsLeft;
      roomState.reinforcementsLeft = 0;
    }

    // 2. Bot Attack
    for (const c of botCountries) {
      const armies = roomState.territories[c].armies;
      if (armies >= 3) {
        const neighbors = roomState.adjacency[c] || [];
        const enemyNeighbors = neighbors.filter(n => roomState.territories[n]?.owner !== botId);
        if (enemyNeighbors.length > 0) {
          const target = enemyNeighbors[0];
          executeAttack(c, target);
          break;
        }
      }
    }

    setTimeout(advancePhase, 1200);
  }

  // ─── HUD & Battle Intel ──────────────────────────────────────────────
  function updateTacticalHUD() {
    if (!roomState) return;

    const currentP = roomState.players[roomState.currentPlayer];
    const nameEl = document.getElementById('hud-commander-name');
    if (nameEl && currentP) {
      nameEl.textContent = currentP.name;
      nameEl.style.color = FACTION_COLORS[currentP.colorIndex % FACTION_COLORS.length];
    }

    const phaseEl = document.getElementById('hud-turn-phase');
    if (phaseEl) {
      phaseEl.textContent = roomState.phase.toUpperCase();
      phaseEl.className = 'hud-phase-pill ' + roomState.phase;
    }

    const isMyTurn = isBotGame
      ? roomState.currentPlayer === 'me'
      : roomState.currentPlayer === socket?.id;

    const rfBox = document.getElementById('reinforce-hud-box');
    const rfCount = document.getElementById('hud-reinforce-count');
    if (rfBox && rfCount) {
      if (roomState.phase === 'reinforce' && isMyTurn) {
        rfBox.style.display = 'flex';
        rfCount.textContent = roomState.reinforcementsLeft;
      } else {
        rfBox.style.display = 'none';
      }
    }

    const endBtn = document.getElementById('btn-end-phase');
    if (endBtn) {
      endBtn.style.display = isMyTurn ? 'inline-flex' : 'none';
      endBtn.textContent = roomState.phase === 'reinforce' ? 'ATTACK PHASE ❯' :
                           roomState.phase === 'attack' ? 'FORTIFY PHASE ❯' : 'END TURN ❯';
    }

    renderFactionsIntel();
  }

  function renderFactionsIntel() {
    const list = document.getElementById('intel-factions-list');
    if (!list || !roomState) return;

    const territoryCounts = {};
    Object.values(roomState.territories).forEach(t => {
      if (t.owner) {
        territoryCounts[t.owner] = (territoryCounts[t.owner] || 0) + 1;
      }
    });

    list.innerHTML = roomState.turnOrder.map(pid => {
      const p = roomState.players[pid];
      if (!p) return '';
      const count = territoryCounts[pid] || 0;
      const isCurrent = pid === roomState.currentPlayer;
      const color = FACTION_COLORS[p.colorIndex % FACTION_COLORS.length];

      return `
        <div class="faction-item ${isCurrent ? 'active' : ''} ${count === 0 ? 'eliminated' : ''}">
          <span class="faction-dot" style="background: ${color}; box-shadow: 0 0 8px ${color}"></span>
          <span>${escapeHtml(p.name)}</span>
          <span class="faction-count">${count} 🏴</span>
        </div>
      `;
    }).join('');
  }

  function handleCountryHover(country, sx, sy) {
    const tooltip = document.getElementById('tactical-country-tooltip');
    if (!tooltip) return;

    if (!country || !roomState) {
      tooltip.style.display = 'none';
      return;
    }

    const territory = roomState.territories[country];
    const ownerPlayer = territory ? roomState.players[territory.owner] : null;

    document.getElementById('tip-country-name').textContent = country.toUpperCase();
    document.getElementById('tip-country-owner').textContent = ownerPlayer ? ownerPlayer.name : 'Neutral Forces';
    document.getElementById('tip-country-armies').textContent = `${territory ? territory.armies : 0} Armies`;

    tooltip.style.display = 'block';
    tooltip.style.left = (sx + 18) + 'px';
    tooltip.style.top = (sy - 15) + 'px';

    const rect = tooltip.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      tooltip.style.left = (sx - rect.width - 18) + 'px';
    }
  }

  // ─── Combat & Victory Overlays ───────────────────────────────────────
  function triggerCombatClashModal(result) {
    const modal = document.getElementById('tactical-combat-modal');
    if (!modal) return;

    document.getElementById('clash-atk-name').textContent = result.from.toUpperCase();
    document.getElementById('clash-def-name').textContent = result.to.toUpperCase();

    const atkDiceBox = document.getElementById('clash-atk-dice');
    const defDiceBox = document.getElementById('clash-def-dice');

    atkDiceBox.innerHTML = result.atkDice.map(d => `<div class="tactical-die atk">🎲${d}</div>`).join('');
    defDiceBox.innerHTML = result.defDice.map(d => `<div class="tactical-die def">🎲${d}</div>`).join('');

    const outcome = document.getElementById('clash-outcome-text');
    if (result.conquered) {
      outcome.textContent = `🏴 ${result.to.toUpperCase()} CONQUERED!`;
      outcome.style.color = '#ffd700';
    } else {
      outcome.textContent = `CASUALTIES: ATK -${result.atkLoss} | DEF -${result.defLoss}`;
      outcome.style.color = '#94a3b8';
    }

    modal.style.display = 'flex';
    setTimeout(() => { modal.style.display = 'none'; }, 2200);
  }

  function appendBattleIntel(result) {
    const log = document.getElementById('intel-battle-log');
    if (!log) return;

    const entry = document.createElement('div');
    entry.className = `intel-msg ${result.conquered ? 'conquest' : 'clash'}`;
    const time = new Date().toTimeString().slice(0, 5);

    entry.innerHTML = `
      <span class="time">[${time}]</span> <strong>${escapeHtml(result.from)}</strong> attacked <strong>${escapeHtml(result.to)}</strong><br/>
      ${result.conquered
        ? '<span style="color:#10f070; font-weight:800;">★ Territory Subjugated!</span>'
        : `<span>Losses: Attacker -${result.atkLoss} / Defender -${result.defLoss}</span>`
      }
    `;

    log.insertBefore(entry, log.firstChild);
  }

  function appendCommsMessage(msg) {
    const log = document.getElementById('intel-battle-log');
    if (!log) return;

    const entry = document.createElement('div');
    entry.className = 'intel-msg';
    entry.innerHTML = `<strong style="color:${FACTION_COLORS[msg.colorIndex % FACTION_COLORS.length]}">${escapeHtml(msg.playerName)}:</strong> ${escapeHtml(msg.message)}`;
    log.insertBefore(entry, log.firstChild);
  }

  function sendComms(text) {
    if (!text || !text.trim()) return;
    if (socket?.connected) {
      socket.emit('send-chat', { message: text.trim() });
    } else {
      appendCommsMessage({
        playerName,
        colorIndex: 0,
        message: text.trim(),
      });
    }
  }

  function triggerVictoryBanner(winnerName, isMe) {
    const modal = document.getElementById('tactical-victory-modal');
    if (!modal) return;

    document.getElementById('victory-winner-announcement').textContent = isMe
      ? 'You have subjugated all rival European powers and forged an empire!'
      : `${winnerName} has conquered all of Europe!`;

    modal.style.display = 'flex';
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  function launchOnlineConquest() {
    if (socket && socket.connected) {
      socket.emit('start-game');
    } else {
      startLocalCampaign('Operation Overlord', 4, playerName);
    }
  }

  return {
    connect,
    showScreen,
    openModal,
    closeModal,
    createGame,
    joinGame,
    launchOnlineConquest,
    handleCountryClick,
    handleCountryHover,
    advancePhase,
    sendComms,
    getRoomState: () => roomState,
  };
})();
