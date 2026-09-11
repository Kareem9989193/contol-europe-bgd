/**
 * app.js — Clean & Direct Grand-Strategy Controller
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize Network
  Game.connect();

  // 2. Initialize Tactical Map
  const canvas = document.getElementById('game-canvas');
  if (canvas) {
    EuropeMap.init(canvas);
  }

  EuropeMap.onHover((country, sx, sy) => {
    Game.handleCountryHover(country, sx, sy);
  });

  EuropeMap.onClick((country) => {
    Game.handleCountryClick(country);
  });

  // ─── Main Menu Hotspots (Directly on Image 1) ─────────────────────────
  const btnCreateGame = document.getElementById('btn-create-game');
  const btnJoinGame = document.getElementById('btn-join-game');

  btnCreateGame?.addEventListener('click', () => {
    Game.openModal('modal-create-game');
  });

  btnJoinGame?.addEventListener('click', () => {
    Game.openModal('modal-join-game');
  });

  // Close modals
  document.querySelectorAll('.modal-close-x').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.getAttribute('data-close');
      if (modalId) Game.closeModal(modalId);
    });
  });

  // ─── Create Game Form ─────────────────────────────────────────────────
  const btnSubmitCreate = document.getElementById('btn-submit-create');
  btnSubmitCreate?.addEventListener('click', () => {
    const commanderName = document.getElementById('create-player-name')?.value.trim() || 'Commander';
    const roomName = document.getElementById('create-room-name')?.value.trim() || 'Europe Campaign';
    const maxPlayers = parseInt(document.getElementById('create-room-max')?.value, 10) || 4;
    const mode = document.querySelector('input[name="game-mode"]:checked')?.value || 'online';

    Game.createGame(roomName, maxPlayers, commanderName, mode);
  });

  // Mode Chips
  document.querySelectorAll('.clean-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.clean-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });

  // ─── Direct Code Join ─────────────────────────────────────────────────
  const btnJoinCodeDirect = document.getElementById('btn-join-code-direct');
  btnJoinCodeDirect?.addEventListener('click', () => {
    const code = document.getElementById('join-room-code-input')?.value.trim();
    const commanderName = document.getElementById('join-player-name')?.value.trim() || 'Commander';
    if (!code) {
      alert('Please enter a room code.');
      return;
    }
    Game.joinGame(code, commanderName);
  });

  // ─── Waiting Room ─────────────────────────────────────────────────────
  const btnLaunchGame = document.getElementById('btn-launch-game');
  btnLaunchGame?.addEventListener('click', () => {
    Game.launchOnlineConquest();
  });

  const btnLeaveLobby = document.getElementById('btn-leave-lobby');
  btnLeaveLobby?.addEventListener('click', () => {
    Game.closeModal('modal-waiting-room');
    Game.showScreen('main-menu-screen');
  });

  const btnCopyLink = document.getElementById('btn-copy-link');
  btnCopyLink?.addEventListener('click', () => {
    const input = document.getElementById('room-share-link');
    if (input) {
      input.select();
      navigator.clipboard?.writeText(input.value);
      btnCopyLink.textContent = 'COPIED! ✓';
      setTimeout(() => { btnCopyLink.textContent = 'COPY LINK'; }, 2000);
    }
  });

  // ─── Tactical Gameplay HUD ────────────────────────────────────────────
  const btnEndPhase = document.getElementById('btn-end-phase');
  btnEndPhase?.addEventListener('click', () => {
    Game.advancePhase();
  });

  const btnTacticalExit = document.getElementById('btn-tactical-exit');
  btnTacticalExit?.addEventListener('click', () => {
    if (confirm('Return to Main Menu?')) {
      Game.showScreen('main-menu-screen');
    }
  });

  const btnVictoryHQ = document.getElementById('btn-victory-hq');
  btnVictoryHQ?.addEventListener('click', () => {
    const victoryModal = document.getElementById('tactical-victory-modal');
    if (victoryModal) victoryModal.style.display = 'none';
    Game.showScreen('main-menu-screen');
  });

  // Keyboard Shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      Game.closeModal('modal-create-game');
      Game.closeModal('modal-join-game');
      EuropeMap.clearSelection();
    }
    if (e.key === ' ' && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      Game.advancePhase();
    }
  });

  // Auto-join query
  const urlParams = new URLSearchParams(window.location.search);
  const autoRoom = urlParams.get('room');
  if (autoRoom) {
    const joinInput = document.getElementById('join-room-code-input');
    if (joinInput) joinInput.value = autoRoom;
    Game.openModal('modal-join-game');
  }
});
