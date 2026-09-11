/**
 * game.js — Grand Strategy Game Controller
 * Manages Socket.io networking, live Economy Ticks, City Management Drawer,
 * Country Selection, Technology Tree, Diplomacy, Formable Empires, and AI Bots.
 */

const Game = (() => {
  let socket = null;
  let playerName = 'Commander';
  let roomState = null;
  let myPlayerId = null;
  let selectedCityObj = null;

  // Cached Game Data
  let countriesData = {};
  let techsData = {};
  let formablesData = {};

  // ─── Initialize ─────────────────────────────────────────────────────────────
  async function init() {
    // Pre-load static data
    try {
      const [cRes, tRes, fRes] = await Promise.all([
        fetch('/data/countries.json').then(r => r.json()),
        fetch('/data/techs.json').then(r => r.json()),
        fetch('/data/formables.json').then(r => r.json()),
      ]);
      countriesData = cRes;
      techsData = tRes;
      formablesData = fRes;
    } catch (e) {
      console.warn('Could not preload game JSON files:', e);
    }

    connectSocket();
    setupEventListeners();
  }

  // ─── Networking ─────────────────────────────────────────────────────────────
  function connectSocket() {
    try {
      socket = io({
        reconnectionAttempts: 8,
        timeout: 10000,
      });

      socket.on('connect', () => {
        myPlayerId = socket.id;
        console.log('📡 Connected to Europe Grand-Strategy Server. ID:', myPlayerId);
      });

      socket.on('rooms-updated', (rooms) => {
        renderLobbyRooms(rooms);
      });

      socket.on('room-state', (state) => {
        roomState = state;
        myPlayerId = socket ? socket.id : myPlayerId;
        EuropeMap.setGameState(state, myPlayerId);
        updateTopHUD();
        updateFactionsPanel();
        updateBattleLog();
        checkCountryPicker();

        // Refresh city drawer if open
        if (selectedCityObj && roomState.cities?.[selectedCityObj.name]) {
          renderCityDrawer(roomState.cities[selectedCityObj.name]);
        }
      });

      socket.on('game-started', () => {
        closeAllModals();
        showScreen('game-screen');
        EuropeMap.fitMapToScreen();
      });

      socket.on('combat-result', (result) => {
        EuropeMap.triggerCombatEffect(result.toCity);
        triggerCombatClashModal(result);
      });

      socket.on('formable-claimed', (data) => {
        showToast(`👑 ${data.playerName} has formed the ${data.empireName}!`);
      });

      socket.on('game-over', ({ winner, winnerName, country }) => {
        triggerVictoryBanner(winnerName, country, winner === myPlayerId);
      });

      socket.on('notification', ({ message }) => {
        showToast(message);
      });
    } catch (e) {
      console.warn('Socket error, running offline fallback:', e);
    }
  }

  // ─── Setup User Interactions & Events ───────────────────────────────────────
  function setupEventListeners() {
    // Map callbacks
    EuropeMap.onCitySelect((city) => {
      selectedCityObj = city;
      if (city) {
        renderCityDrawer(city);
      } else {
        closeCityDrawer();
      }
    });

    EuropeMap.onMarch((fromCity, toCity) => {
      // Direct drag/click march trigger
      const fromObj = roomState?.cities?.[fromCity];
      if (!fromObj || fromObj.armies <= 1) {
        showToast('Not enough armies in this city to march!');
        return;
      }
      const count = Math.max(1, Math.floor(fromObj.armies * 0.6));
      marchTroops(fromCity, toCity, count);
    });

    // City Drawer Buttons
    document.getElementById('btn-close-city-drawer')?.addEventListener('click', closeCityDrawer);

    document.getElementById('btn-upgrade-market')?.addEventListener('click', () => {
      if (!selectedCityObj) return;
      socket?.emit('upgrade-city', { cityName: selectedCityObj.name, upgradeType: 'market' });
    });

    document.getElementById('btn-upgrade-barracks')?.addEventListener('click', () => {
      if (!selectedCityObj) return;
      socket?.emit('upgrade-city', { cityName: selectedCityObj.name, upgradeType: 'barracks' });
    });

    document.getElementById('btn-upgrade-fort')?.addEventListener('click', () => {
      if (!selectedCityObj) return;
      socket?.emit('upgrade-city', { cityName: selectedCityObj.name, upgradeType: 'fort' });
    });

    // Recruitment Steppers
    const recInput = document.getElementById('recruit-amount-input');
    document.getElementById('btn-rec-sub10')?.addEventListener('click', () => {
      if (recInput) recInput.value = Math.max(1, parseInt(recInput.value || 10) - 10);
      updateRecruitCostPreview();
    });
    document.getElementById('btn-rec-add10')?.addEventListener('click', () => {
      if (recInput) recInput.value = parseInt(recInput.value || 0) + 10;
      updateRecruitCostPreview();
    });
    document.getElementById('btn-rec-add50')?.addEventListener('click', () => {
      if (recInput) recInput.value = parseInt(recInput.value || 0) + 50;
      updateRecruitCostPreview();
    });
    recInput?.addEventListener('input', updateRecruitCostPreview);

    document.getElementById('btn-confirm-recruit')?.addEventListener('click', () => {
      if (!selectedCityObj || !recInput) return;
      const count = parseInt(recInput.value) || 10;
      socket?.emit('recruit-troops', { cityName: selectedCityObj.name, count });
    });

    // March Button in Drawer
    document.getElementById('btn-confirm-march')?.addEventListener('click', () => {
      if (!selectedCityObj) return;
      const targetSelect = document.getElementById('march-target-select');
      const amountInput = document.getElementById('march-amount-input');
      const toCity = targetSelect?.value;
      const count = parseInt(amountInput?.value || 5);

      if (!toCity) {
        showToast('Please select a destination city connected by supply routes.');
        return;
      }
      marchTroops(selectedCityObj.name, toCity, count);
    });

    // HUD Actions
    document.getElementById('btn-open-tech')?.addEventListener('click', () => {
      openTechTreeModal();
    });

    document.getElementById('btn-open-diplo')?.addEventListener('click', () => {
      openDiplomacyModal();
    });

    document.getElementById('btn-open-formables')?.addEventListener('click', () => {
      openFormablesModal();
    });

    document.getElementById('btn-recenter-map')?.addEventListener('click', () => {
      EuropeMap.fitMapToScreen();
    });

    document.getElementById('btn-tactical-exit')?.addEventListener('click', () => {
      if (confirm('Return to Strategic HQ Main Menu?')) {
        showScreen('main-menu-screen');
      }
    });

    // Factions Panel Toggle
    document.getElementById('factions-toggle')?.addEventListener('click', () => {
      const panel = document.getElementById('factions-panel');
      panel?.classList.toggle('collapsed');
    });

    // Victory Back button
    document.getElementById('btn-victory-hq')?.addEventListener('click', () => {
      document.getElementById('tactical-victory-modal').style.display = 'none';
      showScreen('main-menu-screen');
    });

    // Modal Close buttons
    document.querySelectorAll('.modal-close-x').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.getAttribute('data-close');
        if (targetId) closeModal(targetId);
      });
    });
  }

  // ─── Top HUD Updates ─────────────────────────────────────────────────────────
  function updateTopHUD() {
    if (!roomState) return;
    const myPlayer = roomState.players?.[myPlayerId];
    if (!myPlayer) return;

    // Player & Country info
    document.getElementById('hud-player-name').textContent = myPlayer.name;
    const countryEl = document.getElementById('hud-player-country');
    countryEl.textContent = myPlayer.country || 'Claiming Nation...';
    countryEl.style.color = myPlayer.color || '#38bdf8';

    // Money & Income
    document.getElementById('hud-money-val').textContent = `$${Math.round(myPlayer.money)}`;
    document.getElementById('hud-income-rate').textContent = `+$${myPlayer.incomeRate}/tick`;

    // Manpower & Mobilization rate
    document.getElementById('hud-manpower-val').textContent = `${Math.round(myPlayer.manpower)} 👥`;
    document.getElementById('hud-manpower-rate').textContent = `+${myPlayer.manpowerRate}/tick`;
  }

  function updateFactionsPanel() {
    if (!roomState?.players) return;
    const listEl = document.getElementById('intel-factions-list');
    const countEl = document.getElementById('commanders-count');
    if (!listEl) return;

    const players = Object.values(roomState.players);
    if (countEl) countEl.textContent = players.length;

    listEl.innerHTML = players.map(p => {
      const isMe = p.id === myPlayerId;
      const ownedCities = Object.values(roomState.cities || {}).filter(c => c.owner === p.id).length;
      return `
        <div class="faction-row ${isMe ? 'is-me' : ''} ${!p.alive ? 'eliminated' : ''}">
          <div class="faction-dot" style="background:${p.color}"></div>
          <div class="faction-meta">
            <span class="fname">${p.name} ${isMe ? '(You)' : ''}</span>
            <small class="fcountry">${p.country || 'Neutral'} • ${ownedCities} cities</small>
          </div>
          <div class="faction-wealth">$${Math.round(p.money)}</div>
        </div>
      `;
    }).join('');
  }

  function updateBattleLog() {
    if (!roomState?.combatLog) return;
    const logEl = document.getElementById('intel-battle-log');
    if (!logEl) return;

    logEl.innerHTML = roomState.combatLog.map(item => `
      <div class="log-entry">${item.text}</div>
    `).join('');
  }

  // ─── Country Selection ──────────────────────────────────────────────────────
  function checkCountryPicker() {
    if (!roomState || roomState.state !== 'playing') return;
    const myPlayer = roomState.players?.[myPlayerId];
    if (myPlayer && !myPlayer.country) {
      openCountryPickerModal();
    }
  }

  function openCountryPickerModal() {
    const modal = document.getElementById('modal-country-select');
    const grid = document.getElementById('country-cards-grid');
    if (!modal || !grid) return;

    const takenCountries = Object.values(roomState?.players || {}).map(p => p.country).filter(Boolean);

    grid.innerHTML = Object.entries(countriesData).map(([name, data]) => {
      const isTaken = takenCountries.includes(name);
      return `
        <div class="country-card ${isTaken ? 'taken' : ''}" style="border-top-color: ${data.color}">
          <div class="country-header">
            <h4>${name}</h4>
            <span class="difficulty-tag ${data.difficulty?.toLowerCase()}">${data.difficulty}</span>
          </div>
          <div class="country-stats">
            <div><span>Starting Treasury:</span> <strong>$${data.startMoney}</strong></div>
            <div><span>Manpower Pool:</span> <strong>${data.startManpower} 👥</strong></div>
            <div><span>Core Cities:</span> <small>${data.cities.slice(0, 3).join(', ')}${data.cities.length > 3 ? '...' : ''}</small></div>
          </div>
          <button class="btn-claim-nation" data-country="${name}" ${isTaken ? 'disabled' : ''}>
            ${isTaken ? 'CLAIMED' : 'CHOOSE NATION'}
          </button>
        </div>
      `;
    }).join('');

    // Attach click handlers
    grid.querySelectorAll('.btn-claim-nation').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const country = e.currentTarget.getAttribute('data-country');
        if (country) {
          socket?.emit('select-country', { country });
          closeModal('modal-country-select');
        }
      });
    });

    modal.style.display = 'flex';
  }

  // ─── City Drawer ────────────────────────────────────────────────────────────
  function renderCityDrawer(city) {
    selectedCityObj = city;
    const drawer = document.getElementById('city-drawer');
    if (!drawer) return;

    const isMine = city.owner === myPlayerId;
    const ownerPlayer = city.owner ? roomState?.players?.[city.owner] : null;

    // Header info
    document.getElementById('drawer-city-name').textContent = city.name.toUpperCase();
    document.getElementById('drawer-city-sub').textContent = `${city.isCapital ? '⭐ Capital of ' : ''}${city.country}`;
    document.getElementById('drawer-garrison-count').textContent = city.armies;

    const ownedContent = document.getElementById('drawer-owned-content');
    const hostileContent = document.getElementById('drawer-hostile-content');

    if (isMine) {
      ownedContent.style.display = 'block';
      hostileContent.style.display = 'none';

      // Upgrade Levels & Costs
      const myPlayer = roomState?.players?.[myPlayerId];
      const hasDiscount = myPlayer?.techs?.includes('industrialization');
      const discountMult = hasDiscount ? 0.75 : 1.0;

      const mLevel = city.levelMarket || 0;
      const bLevel = city.levelBarracks || 0;
      const fLevel = city.levelFort || 0;

      document.getElementById('drawer-market-level').textContent = `Level ${mLevel}/5`;
      document.getElementById('market-cost-label').textContent = mLevel >= 5 ? 'MAX' : `$${Math.round((mLevel + 1) * 100 * discountMult)}`;

      document.getElementById('drawer-barracks-level').textContent = `Level ${bLevel}/5`;
      document.getElementById('barracks-cost-label').textContent = bLevel >= 5 ? 'MAX' : `$${Math.round((bLevel + 1) * 120 * discountMult)}`;

      document.getElementById('drawer-fort-level').textContent = `Level ${fLevel}/5`;
      document.getElementById('fort-cost-label').textContent = fLevel >= 5 ? 'MAX' : `$${Math.round((fLevel + 1) * 150 * discountMult)}`;

      // Populate March Target selector with connected neighbors
      const targetSelect = document.getElementById('march-target-select');
      if (targetSelect) {
        const neighbors = roomState?.connections?.[city.name] || [];
        targetSelect.innerHTML = '<option value="">Select Target City...</option>' + neighbors.map(nName => {
          const nCity = roomState?.cities?.[nName];
          const nOwner = nCity?.owner ? roomState?.players?.[nCity.owner] : null;
          const status = nCity?.owner === myPlayerId ? '🛡️ Reinforce' : (nOwner ? `⚔️ Attack (${nOwner.name})` : '⚔️ Capture');
          return `<option value="${nName}">${nName} — ${status} [${nCity?.armies || 0} armies]</option>`;
        }).join('');
      }

      updateRecruitCostPreview();
    } else {
      ownedContent.style.display = 'none';
      hostileContent.style.display = 'block';

      document.getElementById('foreign-owner-name').textContent = ownerPlayer ? `${ownerPlayer.name} (${ownerPlayer.country})` : 'Neutral Garrison';
      document.getElementById('foreign-city-target').textContent = city.name;
    }

    drawer.style.display = 'block';
  }

  function closeCityDrawer() {
    selectedCityObj = null;
    EuropeMap.selectCity(null);
    const drawer = document.getElementById('city-drawer');
    if (drawer) drawer.style.display = 'none';
  }

  function updateRecruitCostPreview() {
    const input = document.getElementById('recruit-amount-input');
    const label = document.getElementById('recruit-cost-preview');
    if (!input || !label) return;
    const count = parseInt(input.value) || 10;
    label.textContent = `Cost: $${count * 2} | ${count} 👥`;
  }

  function marchTroops(fromCity, toCity, count) {
    if (!fromCity || !toCity || count <= 0) return;
    const fromObj = roomState?.cities?.[fromCity];
    if (!fromObj || fromObj.armies <= count) {
      showToast(`Cannot march all troops! At least 1 troop must remain to hold ${fromCity}.`);
      return;
    }

    socket?.emit('march-armies', { fromCity, toCity, count });
    showToast(`⚔️ March ordered: ${count} troops advancing on ${toCity}!`);
  }

  // ─── Technology Tree ────────────────────────────────────────────────────────
  function openTechTreeModal() {
    const modal = document.getElementById('modal-tech-tree');
    const milList = document.getElementById('tech-military-list');
    const ecoList = document.getElementById('tech-economic-list');
    if (!modal || !milList || !ecoList) return;

    const myPlayer = roomState?.players?.[myPlayerId];
    const researched = myPlayer?.techs || [];

    const renderTechItem = (t) => {
      const isDone = researched.includes(t.id);
      const canUnlock = !isDone && (!t.req || researched.includes(t.req));
      return `
        <div class="tech-card ${isDone ? 'researched' : (canUnlock ? 'available' : 'locked')}">
          <div class="tech-icon">${t.icon}</div>
          <div class="tech-details">
            <h5>${t.name}</h5>
            <p>${t.desc}</p>
            ${t.req ? `<small class="tech-req">Prereq: ${t.req}</small>` : ''}
          </div>
          <button class="btn-research" data-tech="${t.id}" ${!canUnlock || isDone ? 'disabled' : ''}>
            ${isDone ? '✓ MASTERED' : (canUnlock ? `RESEARCH ($${t.cost})` : 'LOCKED')}
          </button>
        </div>
      `;
    };

    milList.innerHTML = (techsData.military || []).map(renderTechItem).join('');
    ecoList.innerHTML = (techsData.economic || []).map(renderTechItem).join('');

    // Attach research handlers
    modal.querySelectorAll('.btn-research').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const techId = e.currentTarget.getAttribute('data-tech');
        if (techId) {
          socket?.emit('research-tech', { techId });
          setTimeout(openTechTreeModal, 200); // refresh modal state
        }
      });
    });

    modal.style.display = 'flex';
  }

  // ─── Diplomacy & Alliances ──────────────────────────────────────────────────
  function openDiplomacyModal() {
    const modal = document.getElementById('modal-diplomacy');
    const list = document.getElementById('diplomacy-players-list');
    if (!modal || !list) return;

    const otherPlayers = Object.values(roomState?.players || {}).filter(p => p.id !== myPlayerId);

    if (otherPlayers.length === 0) {
      list.innerHTML = '<div class="empty-msg">No other commanders present in this theater.</div>';
    } else {
      list.innerHTML = otherPlayers.map(p => {
        const isAlly = (roomState?.diplomacy?.alliances || []).some(pair =>
          (pair[0] === myPlayerId && pair[1] === p.id) || (pair[0] === p.id && pair[1] === myPlayerId)
        );

        return `
          <div class="diplomacy-card">
            <div class="diplo-identity">
              <div class="faction-dot" style="background:${p.color}"></div>
              <div>
                <strong>${p.name}</strong>
                <span>${p.country || 'Unknown Sovereign'}</span>
              </div>
            </div>
            <div class="diplo-status ${isAlly ? 'ally' : 'neutral'}">
              ${isAlly ? '🤝 ALLIED' : '⚔️ SOVEREIGN'}
            </div>
            <div class="diplo-actions">
              ${isAlly ? `
                <button class="btn-diplo break" data-action="break" data-target="${p.id}">Break Alliance</button>
              ` : `
                <button class="btn-diplo ally" data-action="ally" data-target="${p.id}">Propose Alliance</button>
              `}
              <button class="btn-diplo aid" data-action="aid" data-target="${p.id}">Send $50 Aid</button>
            </div>
          </div>
        `;
      }).join('');

      list.querySelectorAll('.btn-diplo').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const action = e.currentTarget.getAttribute('data-action');
          const targetId = e.currentTarget.getAttribute('data-target');
          if (action === 'ally') {
            socket?.emit('propose-alliance', { targetId });
          } else if (action === 'break') {
            socket?.emit('break-alliance', { targetId });
          } else if (action === 'aid') {
            socket?.emit('send-aid', { targetId, amount: 50 });
          }
          setTimeout(openDiplomacyModal, 200);
        });
      });
    }

    modal.style.display = 'flex';
  }

  // ─── Formable Historical Empires ────────────────────────────────────────────
  function openFormablesModal() {
    const modal = document.getElementById('modal-formables');
    const grid = document.getElementById('formables-cards-grid');
    if (!modal || !grid) return;

    const myPlayer = roomState?.players?.[myPlayerId];
    const claimedFormables = myPlayer?.formables || [];

    grid.innerHTML = Object.entries(formablesData).map(([fId, data]) => {
      const isClaimed = claimedFormables.includes(fId);

      // Check which cities are owned
      const cityChecks = data.cities.map(cName => {
        const city = roomState?.cities?.[cName];
        const owned = city && city.owner === myPlayerId;
        return `<span class="city-pill ${owned ? 'owned' : 'missing'}">${owned ? '✓' : '✗'} ${cName}</span>`;
      }).join(' ');

      const canClaim = !isClaimed && data.cities.every(cName => {
        const city = roomState?.cities?.[cName];
        return city && city.owner === myPlayerId;
      });

      return `
        <div class="formable-card ${isClaimed ? 'claimed' : (canClaim ? 'ready' : '')}">
          <div class="formable-header">
            <span class="f-icon">${data.icon}</span>
            <div>
              <h4>${data.name}</h4>
              <p>${data.description}</p>
            </div>
          </div>
          <div class="required-cities-box">
            <label>Required Strategic Centers:</label>
            <div class="city-pills-row">${cityChecks}</div>
          </div>
          <div class="formable-footer">
            <small class="rewards">Reward: +$${data.reward?.money} | +${data.reward?.manpower}👥 | +$${data.reward?.incomeBonus}/tick</small>
            <button class="btn-claim-empire" data-formable="${fId}" ${!canClaim ? 'disabled' : ''}>
              ${isClaimed ? '👑 FORMED' : (canClaim ? 'PROCLAIM EMPIRE' : 'REQUIREMENTS UNMET')}
            </button>
          </div>
        </div>
      `;
    }).join('');

    grid.querySelectorAll('.btn-claim-empire').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const formableId = e.currentTarget.getAttribute('data-formable');
        if (formableId) {
          socket?.emit('claim-formable', { formableId });
          closeModal('modal-formables');
        }
      });
    });

    modal.style.display = 'flex';
  }

  // ─── Modals, Screens, & Alerts ──────────────────────────────────────────────
  function showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId)?.classList.add('active');
  }

  function openModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'flex';
  }

  function closeModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'none';
  }

  function closeAllModals() {
    document.querySelectorAll('.clean-modal-backdrop').forEach(m => m.style.display = 'none');
  }

  function showToast(message) {
    const toast = document.getElementById('toast-notification');
    if (!toast) return;
    toast.textContent = message;
    toast.style.display = 'block';
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.style.display = 'none';
    }, 3500);
  }

  function triggerCombatClashModal(result) {
    const modal = document.getElementById('tactical-combat-modal');
    if (!modal) return;

    document.getElementById('clash-atk-name').textContent = result.attackerName;
    document.getElementById('clash-atk-armies').textContent = `${result.attackerArmies} troops (${result.attackerSurvived} survived)`;

    document.getElementById('clash-def-name').textContent = result.defenderName;
    document.getElementById('clash-def-armies').textContent = `${result.defenderArmies} troops (${result.defenderSurvived} survived)`;

    const outcomeEl = document.getElementById('clash-outcome-text');
    outcomeEl.textContent = result.conquered
      ? `💥 ${result.toCity.toUpperCase()} CAPTURED!`
      : `🛡️ DEFENDERS HELD ${result.toCity.toUpperCase()}!`;
    outcomeEl.style.color = result.conquered ? '#ffd700' : '#38bdf8';

    modal.style.display = 'flex';
    setTimeout(() => {
      modal.style.display = 'none';
    }, 2800);
  }

  function triggerVictoryBanner(winnerName, country, isMe) {
    const modal = document.getElementById('tactical-victory-modal');
    if (!modal) return;
    document.getElementById('victory-winner-announcement').textContent = isMe
      ? `Congratulations! You have unified the European continent under your supreme sovereignty!`
      : `${winnerName} (${country}) has conquered all opposition and united Europe!`;
    modal.style.display = 'flex';
  }

  function renderLobbyRooms(rooms) {
    const list = document.getElementById('modal-rooms-list');
    if (!list) return;

    if (!rooms || rooms.length === 0) {
      list.innerHTML = '<div class="no-rooms-msg">No active theaters. Create one to begin conquest!</div>';
      return;
    }

    list.innerHTML = rooms.map(r => `
      <div class="room-row-item">
        <div class="room-info">
          <strong>${r.name}</strong>
          <small>${r.players} / ${r.maxPlayers} Commanders • ${r.state.toUpperCase()}</small>
        </div>
        <button class="btn-join-room-act" data-room="${r.id}">JOIN</button>
      </div>
    `).join('');

    list.querySelectorAll('.btn-join-room-act').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const roomId = e.currentTarget.getAttribute('data-room');
        const pName = document.getElementById('join-player-name')?.value || 'Commander';
        socket?.emit('join-room', { roomId, playerName: pName }, (res) => {
          if (res?.success) {
            closeModal('modal-join-game');
            openWaitingRoom(roomId, 'Strategic Room', false);
          } else {
            showToast(res?.error || 'Failed to join');
          }
        });
      });
    });
  }

  function openWaitingRoom(roomId, roomName, isHost) {
    const modal = document.getElementById('modal-waiting-room');
    if (!modal) return;
    document.getElementById('waiting-room-title').textContent = roomName;
    document.getElementById('room-share-link').value = window.location.origin + '?room=' + roomId;

    const startBtn = document.getElementById('btn-launch-game');
    if (startBtn) {
      startBtn.style.display = isHost ? 'inline-block' : 'none';
      startBtn.onclick = () => {
        socket?.emit('start-game', { mode: 'online' });
      };
    }

    const leaveBtn = document.getElementById('btn-leave-lobby');
    if (leaveBtn) {
      leaveBtn.onclick = () => {
        closeModal('modal-waiting-room');
      };
    }

    modal.style.display = 'flex';
  }

  return {
    init,
    showScreen,
    openModal,
    closeModal,
    showToast,
    openWaitingRoom
  };
})();

document.addEventListener('DOMContentLoaded', () => {
  EuropeMap.init('game-canvas');
  Game.init();
});
