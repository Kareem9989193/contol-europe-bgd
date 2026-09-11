/**
 * app.js — Main Menu & UI Action Handlers
 */

document.addEventListener('DOMContentLoaded', () => {
  // Main Menu Hotspots (Directly on Menu Background)
  const btnCreateGame = document.getElementById('btn-create-game');
  const btnJoinGame = document.getElementById('btn-join-game');

  btnCreateGame?.addEventListener('click', () => {
    Game.openModal('modal-create-game');
  });

  btnJoinGame?.addEventListener('click', () => {
    Game.openModal('modal-join-game');
  });

  // Create Game Form
  const btnSubmitCreate = document.getElementById('btn-submit-create');
  btnSubmitCreate?.addEventListener('click', () => {
    const commanderName = document.getElementById('create-player-name')?.value.trim() || 'Commander';
    const roomName = document.getElementById('create-room-name')?.value.trim() || 'Europe Conquest Room';
    const maxPlayers = parseInt(document.getElementById('create-room-max')?.value, 10) || 6;
    const mode = document.querySelector('input[name="game-mode"]:checked')?.value || 'online';

    // Socket create
    window.io?.()?.emit?.('create-room', { name: roomName, maxPlayers, playerName: commanderName }, (res) => {
      if (res?.success) {
        Game.closeModal('modal-create-game');
        Game.openWaitingRoom(res.roomId, roomName, true);
      }
    });
  });

  // Direct Code Join
  const btnJoinCodeDirect = document.getElementById('btn-join-code-direct');
  btnJoinCodeDirect?.addEventListener('click', () => {
    const code = document.getElementById('join-room-code-input')?.value.trim();
    const commanderName = document.getElementById('join-player-name')?.value.trim() || 'Commander';
    if (!code) {
      Game.showToast('Please enter a room code.');
      return;
    }
    window.io?.()?.emit?.('join-room', { roomId: code, playerName: commanderName }, (res) => {
      if (res?.success) {
        Game.closeModal('modal-join-game');
        Game.openWaitingRoom(code, 'Europe Conquest Theater', false);
      } else {
        Game.showToast(res?.error || 'Failed to join theater.');
      }
    });
  });

  // Mode Chips
  document.querySelectorAll('.clean-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.clean-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });

  // Share Copy Link
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

  // Auto-join query
  const urlParams = new URLSearchParams(window.location.search);
  const autoRoom = urlParams.get('room');
  if (autoRoom) {
    const joinInput = document.getElementById('join-room-code-input');
    if (joinInput) joinInput.value = autoRoom;
    Game.openModal('modal-join-game');
  }
});
