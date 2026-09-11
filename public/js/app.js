/**
 * app.js — Entry Point
 * Initializes map, game, and wires up all UI events
 */

document.addEventListener('DOMContentLoaded', () => {
  // ─── Connect to Server ─────────────────────────────────────────────
  Game.connect();

  // ─── Login Screen ──────────────────────────────────────────────────
  const nameInput = document.getElementById('player-name-input');
  const enterBtn = document.getElementById('enter-lobby-btn');

  function handleLogin() {
    const name = nameInput.value.trim();
    if (name.length < 1) {
      nameInput.style.borderColor = '#ff4081';
      nameInput.focus();
      return;
    }
    nameInput.style.borderColor = '';
    Game.enterLobby(name);
  }

  enterBtn.addEventListener('click', handleLogin);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleLogin();
  });

  // Focus input on load
  setTimeout(() => nameInput.focus(), 500);

  // ─── Lobby Screen ──────────────────────────────────────────────────
  const createRoomBtn = document.getElementById('create-room-btn');
  const roomNameInput = document.getElementById('room-name-input');
  const maxPlayersInput = document.getElementById('max-players-input');

  createRoomBtn.addEventListener('click', () => {
    const roomName = roomNameInput.value.trim() || `${Game.getPlayerName()}'s Room`;
    const maxPlayers = parseInt(maxPlayersInput.value, 10);
    Game.createRoom(roomName, maxPlayers);
  });

  roomNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createRoomBtn.click();
  });

  // ─── Waiting Room ─────────────────────────────────────────────────
  document.getElementById('start-game-btn').addEventListener('click', () => {
    Game.startGameRequest();
  });

  document.getElementById('leave-room-btn').addEventListener('click', () => {
    Game.leaveRoom();
  });

  // ─── Game Screen ───────────────────────────────────────────────────
  const canvas = document.getElementById('game-canvas');

  // Init map when game screen is shown
  const observer = new MutationObserver(() => {
    const gameScreen = document.getElementById('game-screen');
    if (gameScreen.classList.contains('active')) {
      EuropeMap.init(canvas).then(() => {
        const state = Game.getRoomState();
        if (state) EuropeMap.setGameState(state);
      });
      observer.disconnect();
    }
  });
  observer.observe(document.getElementById('game-screen'), {
    attributes: true,
    attributeFilter: ['class'],
  });

  // Map callbacks
  EuropeMap.onHover((country, mx, my) => {
    Game.handleCountryHover(country, mx, my);
  });
  EuropeMap.onClick((country) => {
    Game.handleCountryClick(country);
  });

  // Phase controls
  document.getElementById('end-phase-btn').addEventListener('click', () => {
    Game.endPhase();
  });

  // Victory
  document.getElementById('back-to-lobby-btn').addEventListener('click', () => {
    Game.backToLobby();
  });

  // ─── Chat ──────────────────────────────────────────────────────────
  const chatToggle = document.getElementById('chat-toggle');
  const chatPanel = document.getElementById('chat-panel');
  const chatInput = document.getElementById('chat-input');
  const chatSendBtn = document.getElementById('chat-send-btn');

  chatToggle.addEventListener('click', () => {
    chatPanel.classList.toggle('collapsed');
    if (!chatPanel.classList.contains('collapsed')) {
      document.getElementById('chat-badge').style.display = 'none';
      chatInput.focus();
    }
  });

  chatSendBtn.addEventListener('click', () => {
    Game.sendChat(chatInput.value);
    chatInput.value = '';
    chatInput.focus();
  });

  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      Game.sendChat(chatInput.value);
      chatInput.value = '';
    }
  });

  // ─── Keyboard Shortcuts ────────────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    // Space or Enter to end phase
    if (e.key === ' ' && document.activeElement !== chatInput && document.activeElement !== nameInput && document.activeElement !== roomNameInput) {
      e.preventDefault();
      Game.endPhase();
    }
    // Escape to deselect
    if (e.key === 'Escape') {
      EuropeMap.clearSelection();
    }
  });
});
