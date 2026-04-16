// === State ===
const state = {
  socket: null,
  playerId: null,
  roomCode: null,
  roomState: null,
  selectedAvatar: null,
  proxySelectedAvatar: null,
  currentPlayForPlayerId: null,
  /** Server includes liveChoices on rps-waiting only for true spectators. */
  canSpectateLiveRps: false,
  rpsSpectateLive: false,
  rpsLiveChoices: {},
};

const AVATARS = ['🤖', '🥷', '👽', '🧙', '🦊', '🐙', '🦄', '🐲', '🎃', '🦅', '🐺', '🧛', '🐱', '🐶', '🐼', '🦁', '🐸', '🐵', '🦉', '🐧', '🦩', '🐢', '🦋', '🐝', '🍀', '🌟', '⚡', '🔥', '❄️', '🌈'];
const RPS_EMOJI = { rock: '🪨', paper: '📄', scissors: '✂️' };

// === DOM Helpers ===
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function showScreen(id) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  $(`#screen-${id}`).classList.add('active');
}

// === Init ===
function init() {
  state.socket = io();

  initTheme();

  // Check if we're joining a room via URL
  const pathMatch = window.location.pathname.match(/^\/room\/(.+)$/);
  if (pathMatch) {
    state.roomCode = pathMatch[1];
    const saved = sessionStorage.getItem(`player-${state.roomCode}`);
    if (saved) {
      const { name, avatar, playerId } = JSON.parse(saved);
      state.selectedAvatar = avatar;
      state.playerId = playerId;
      joinRoom(name, avatar, playerId);
    } else {
      showJoinScreen();
    }
  } else {
    showScreen('landing');
  }

  setupEventListeners();
  setupSocketHandlers();
}

function initTheme() {
  const stored = localStorage.getItem('standup-picker-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = stored || (prefersDark ? 'dark' : 'light');
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

function setTheme(theme) {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  localStorage.setItem('standup-picker-theme', theme);
}

// === Event Listeners ===
function setupEventListeners() {
  // Theme toggle
  $('#btn-theme-toggle')?.addEventListener('click', () => {
    const isLight = document.documentElement.getAttribute('data-theme') === 'light';
    setTheme(isLight ? 'dark' : 'light');
  });

  // Create room
  $('#btn-create').addEventListener('click', async () => {
    SFX.unlock();
    SFX.click();
    const res = await fetch('/api/create-room', { method: 'POST' });
    const { code } = await res.json();
    state.roomCode = code;
    window.history.pushState({}, '', `/room/${code}`);
    showJoinScreen();
  });

  // Avatar grid
  const grid = $('#avatar-grid');
  AVATARS.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = 'avatar-option';
    btn.textContent = emoji;
    btn.addEventListener('click', () => {
      SFX.unlock();
      SFX.click();
      $$('.avatar-option').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.selectedAvatar = emoji;
      updateJoinButton();
    });
    grid.appendChild(btn);
  });

  // Name input
  $('#input-name').addEventListener('input', updateJoinButton);
  $('#input-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !$('#btn-join').disabled) {
      $('#btn-join').click();
    }
  });

  // Join room
  $('#btn-join').addEventListener('click', () => {
    SFX.click();
    const name = $('#input-name').value.trim();
    if (!name || !state.selectedAvatar) return;
    joinRoom(name, state.selectedAvatar);
  });

  // Copy link
  $('#btn-copy-link').addEventListener('click', () => {
    const link = `${window.location.origin}/room/${state.roomCode}`;
    navigator.clipboard.writeText(link).then(() => {
      SFX.copy();
      const btn = $('#btn-copy-link');
      btn.textContent = '✅ Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = '📋 Copy Link';
        btn.classList.remove('copied');
      }, 2000);
    });
  });

  // Ready (lobby) — when everyone is ready, dice roll automatically
  $('#btn-ready')?.addEventListener('click', () => {
    SFX.click();
    state.socket.emit('player-ready');
  });

  // RPS buttons
  $$('.rps-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      SFX.rpsLock();
      const choice = btn.dataset.choice;
      const payload = { choice };
      if (state.currentPlayForPlayerId) payload.forPlayerId = state.currentPlayForPlayerId;
      state.socket.emit('rps-choice', payload);
      $$('.rps-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      // Disable all buttons after picking
      $$('.rps-btn').forEach(b => { b.disabled = true; });
      // Show waiting state
      showRPSSection('waiting');
      $('#rps-waiting-text').textContent = 'Waiting for opponent...';
      state.currentPlayForPlayerId = null;
    });
  });

  // Play again
  $('#btn-play-again').addEventListener('click', () => {
    SFX.click();
    state.socket.emit('play-again');
  });

  // Add proxy player (host only)
  const proxyAvatarGrid = $('#proxy-avatar-grid');
  if (proxyAvatarGrid) {
    AVATARS.forEach(emoji => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'avatar-option';
      btn.textContent = emoji;
      btn.addEventListener('click', () => {
        SFX.click();
        $$('.proxy-avatar-grid .avatar-option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        state.proxySelectedAvatar = emoji;
      });
      proxyAvatarGrid.appendChild(btn);
    });
  }
  $('#btn-add-proxy')?.addEventListener('click', () => {
    const name = $('#proxy-name')?.value?.trim();
    const avatar = state.proxySelectedAvatar;
    const isComputer = $('#proxy-is-computer')?.checked ?? false;
    if (!name) {
      alert('Enter a name');
      return;
    }
    if (!avatar) {
      alert('Pick an avatar');
      return;
    }
    SFX.click();
    state.socket.emit('add-proxy-player', { name, avatar, isComputer });
    $('#proxy-name').value = '';
    state.proxySelectedAvatar = null;
    $$('.proxy-avatar-grid .avatar-option').forEach(b => b.classList.remove('selected'));
    $('#proxy-is-computer').checked = false;
  });

  $('#btn-toggle-add-proxy')?.addEventListener('click', () => {
    const section = $('#add-proxy-section');
    const btn = $('#btn-toggle-add-proxy');
    const icon = section?.querySelector('.add-proxy-toggle-icon');
    if (!section || !btn) return;
    SFX.click();
    section.classList.toggle('collapsed');
    const isExpanded = !section.classList.contains('collapsed');
    btn.setAttribute('aria-expanded', isExpanded);
    if (icon) icon.textContent = isExpanded ? '▲' : '▼';
  });

  $('#btn-rps-spectate')?.addEventListener('click', () => {
    SFX.click();
    state.rpsSpectateLive = !state.rpsSpectateLive;
    const btn = $('#btn-rps-spectate');
    if (btn) {
      btn.setAttribute('aria-pressed', state.rpsSpectateLive ? 'true' : 'false');
      btn.textContent = state.rpsSpectateLive ? 'Stop spectating' : 'Spectate live picks';
    }
    renderRpsLiveWeapons();
  });
}

function updateJoinButton() {
  const name = $('#input-name').value.trim();
  $('#btn-join').disabled = !name || !state.selectedAvatar;
}

// === Socket Handlers ===
function setupSocketHandlers() {
  const { socket } = state;

  socket.on('joined', ({ playerId, roomState }) => {
    state.playerId = playerId;
    state.roomState = roomState;
    sessionStorage.setItem(`player-${state.roomCode}`, JSON.stringify({
      name: getMyPlayer()?.name || $('#input-name').value.trim(),
      avatar: state.selectedAvatar,
      playerId,
    }));
    renderLobby();
    showScreen('lobby');
  });

  socket.on('room-state', (roomState) => {
    state.roomState = roomState;
    if (roomState.phase !== 'rps') {
      state.rpsSpectateLive = false;
      state.canSpectateLiveRps = false;
      state.rpsLiveChoices = {};
      const btn = $('#btn-rps-spectate');
      if (btn) {
        btn.setAttribute('aria-pressed', 'false');
        btn.textContent = 'Spectate live picks';
      }
    }
    updateHostStatus();
    renderByPhase();
  });

  socket.on('player-joined', () => {
    SFX.playerJoin();
  });

  socket.on('dice-result', ({ selected, sequence }) => {
    showScreen('rolling');
    animateSlotMachine(sequence, selected);
  });

  socket.on('rps-waiting', (payload) => {
    if (state.roomState?.phase !== 'rps') return;
    const { submitted, liveChoices } = payload;
    state.canSpectateLiveRps = Object.prototype.hasOwnProperty.call(payload, 'liveChoices');
    if (state.canSpectateLiveRps) {
      state.rpsLiveChoices = { ...liveChoices };
    } else {
      state.rpsLiveChoices = {};
    }

    const me = getMyPlayer();
    const selected = state.roomState.rpsState.selected || [];
    const isParticipant = me && selected.includes(me.id);
    if (!isParticipant || submitted.includes(me.id)) {
      const count = submitted.length;
      $('#rps-waiting-text').textContent = count === 1
        ? 'One player has chosen... waiting for the other'
        : 'Waiting for both players...';
    }

    if ($('#rps-waiting') && !$('#rps-waiting').classList.contains('hidden')) {
      syncRpsSpectatePanel();
      renderRpsLiveWeapons();
    }
  });

  socket.on('rps-result', ({ choices, result, winnerId, loserId, round }) => {
    showRPSReveal(choices, result, winnerId, loserId, round);
  });

  socket.on('new-host', ({ playerId }) => {
    setTimeout(() => showResultScreen(playerId), 900);
  });

  socket.on('error-msg', ({ message }) => {
    alert(message);
  });
}

// === Join Flow ===
function showJoinScreen() {
  $('#join-room-code').textContent = state.roomCode;
  showScreen('join');
  setTimeout(() => $('#input-name').focus(), 100);
}

function joinRoom(name, avatar, existingPlayerId) {
  state.socket.emit('join-room', {
    roomCode: state.roomCode,
    name,
    avatar,
    existingPlayerId,
  });
}

// === Helpers ===
function getMyPlayer() {
  if (!state.roomState) return null;
  return state.roomState.players.find(p => p.id === state.playerId);
}

function getPlayerById(id) {
  if (!state.roomState) return null;
  return state.roomState.players.find(p => p.id === id);
}

function updateHostStatus() {
  const room = state.roomState;
  if (!room) return;
  const me = getMyPlayer();
  const isHost = me && room.players.find(p => p.socketId === state.socket.id)?.socketId === room.hostId;
  document.body.classList.toggle('is-host', isHost);
}

function renderByPhase() {
  const room = state.roomState;
  if (!room) return;

  switch (room.phase) {
    case 'lobby':
      renderLobby();
      showScreen('lobby');
      break;
    case 'rolling':
      // Handled by dice-result event
      break;
    case 'rps':
      renderRPS();
      showScreen('rps');
      break;
    case 'result':
      if ($('#screen-result').classList.contains('active')) break;
      if (!$('#screen-rps').classList.contains('active') && !$('#screen-rolling').classList.contains('active')) {
        const loserPlayer = room.players.find(p => p.socketId === room.hostId);
        if (loserPlayer) showResultScreen(loserPlayer.id);
      }
      break;
  }
}

// === Lobby Rendering ===
function renderLobby() {
  const room = state.roomState;
  if (!room) return;

  $('#lobby-room-code').textContent = room.code;

  const grid = $('#player-grid');
  grid.innerHTML = '';

  const me = getMyPlayer();
  const isHost = me && room.players.find(p => p.socketId === state.socket.id)?.socketId === room.hostId;

  room.players.forEach(player => {
    const card = document.createElement('div');
    card.className = 'player-card';

    if (player.id === state.playerId) card.classList.add('is-you');
    if (isHost) card.classList.add('clickable');

    // Host badge (only real players have socketId)
    if (player.socketId === room.hostId) {
      const hb = document.createElement('span');
      hb.className = 'host-badge';
      hb.textContent = 'Host';
      card.appendChild(hb);
    }

    // Remove button (top right, proxy only)
    if (isHost && player.isProxy) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn-remove-proxy';
      removeBtn.innerHTML = '×';
      removeBtn.title = 'Remove this player';
      removeBtn.setAttribute('aria-label', 'Remove');
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        SFX.click();
        state.socket.emit('remove-proxy-player', { playerId: player.id });
      });
      card.appendChild(removeBtn);
    }

    const avatar = document.createElement('span');
    avatar.className = 'player-avatar';
    avatar.textContent = player.avatar;
    card.appendChild(avatar);

    const name = document.createElement('span');
    name.className = 'player-name';
    name.textContent = player.name + (player.id === state.playerId ? ' (You)' : '');
    card.appendChild(name);

    // Ready indicator (only for connected players, not proxy)
    if (!player.isProxy && room.readyIds && room.readyIds.includes(player.id)) {
      const readySpan = document.createElement('span');
      readySpan.className = 'ready-badge';
      readySpan.textContent = 'Ready';
      card.appendChild(readySpan);
    }

    if (player.isProxy) card.classList.add('has-proxy-badge');
    // Proxy badge at bottom (in flow, flushed to bottom of card)
    if (player.isProxy) {
      const pb = document.createElement('span');
      pb.className = 'proxy-badge';
      pb.textContent = player.isComputer ? 'Computer' : 'Absent';
      card.appendChild(pb);
    }

    if (isHost) {
      card.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-remove-proxy')) return;
        if (player.socketId === room.hostId) return; // already host
        if (player.isProxy) return; // can't transfer to proxy
        SFX.setFacilitator();
        state.socket.emit('transfer-host', { playerId: player.id });
      });
    }

    grid.appendChild(card);
  });

  // Ready button vs waiting text
  const readyIds = room.readyIds || [];
  const imReady = readyIds.includes(state.playerId);
  const btnReady = $('#btn-ready');
  const waitingText = $('#lobby-waiting-text');
  if (btnReady) btnReady.classList.toggle('hidden', imReady);
  if (waitingText) waitingText.classList.toggle('hidden', !imReady);
}

// === Slot Machine Animation ===
function animateSlotMachine(sequence, selected) {
  const slot1 = $('#slot-1');
  const slot2 = $('#slot-2');
  slot1.classList.remove('landed');
  slot2.classList.remove('landed');

  let i = 0;
  const totalFrames = sequence.length;

  function tick() {
    if (i >= totalFrames) {
      // Final — land on selected
      slot1.classList.add('landed');
      slot2.classList.add('landed');
      SFX.slotLand();
      return;
    }

    SFX.slotTick();
    const [id1, id2] = sequence[i];
    const p1 = getPlayerById(id1);
    const p2 = getPlayerById(id2);

    if (p1) {
      slot1.querySelector('.slot-avatar').textContent = p1.avatar;
      slot1.querySelector('.slot-name').textContent = p1.name;
    }
    if (p2) {
      slot2.querySelector('.slot-avatar').textContent = p2.avatar;
      slot2.querySelector('.slot-name').textContent = p2.name;
    }

    // Slow down towards the end
    const progress = i / totalFrames;
    const delay = 80 + progress * progress * 300;

    i++;
    setTimeout(tick, delay);
  }

  tick();
}

function syncRpsSpectatePanel() {
  const panel = $('#rps-spectate-panel');
  if (!panel) return;
  panel.classList.toggle('hidden', !state.canSpectateLiveRps);
}

function renderRpsLiveWeapons() {
  const wrap = $('#rps-live-weapons');
  if (!wrap) return;
  const show = state.rpsSpectateLive && state.canSpectateLiveRps;
  if (!show) {
    wrap.classList.add('hidden');
    wrap.innerHTML = '';
    return;
  }
  const room = state.roomState;
  const sel = room?.rpsState?.selected;
  if (!sel || sel.length !== 2) return;
  const choices = state.rpsLiveChoices;
  wrap.innerHTML = '';
  sel.forEach((pid) => {
    const row = document.createElement('div');
    row.className = 'rps-live-weapon-row';
    const nameEl = document.createElement('span');
    nameEl.className = 'rps-live-weapon-name';
    nameEl.textContent = getPlayerById(pid)?.name ?? '?';
    const emojiEl = document.createElement('span');
    emojiEl.className = 'rps-live-weapon-emoji';
    emojiEl.setAttribute('aria-hidden', 'true');
    const ch = choices[pid];
    emojiEl.textContent = ch ? (RPS_EMOJI[ch] || '?') : '…';
    row.appendChild(nameEl);
    row.appendChild(emojiEl);
    wrap.appendChild(row);
  });
  wrap.classList.remove('hidden');
}

// === RPS Rendering ===
function renderRPS() {
  const room = state.roomState;
  if (!room || !room.rpsState) return;

  const [id1, id2] = room.rpsState.selected;
  const p1 = getPlayerById(id1);
  const p2 = getPlayerById(id2);

  if (p1) {
    $('#rps-player-1 .rps-avatar').textContent = p1.avatar;
    $('#rps-player-1 .rps-name').textContent = p1.name;
  }
  if (p2) {
    $('#rps-player-2 .rps-avatar').textContent = p2.avatar;
    $('#rps-player-2 .rps-name').textContent = p2.name;
  }

  const round = room.rpsState.round || 1;
  $('#rps-round-badge').textContent = round > 1 ? `Round ${round} — Sudden Death!` : 'Round 1';

  const me = getMyPlayer();
  const submittedIds = room.rpsState.submittedIds || [];
  const isParticipant = me && room.rpsState.selected.includes(me.id);
  const isHost = me && me.socketId === room.hostId;

  // Which selected player (if any) is a proxy that needs the host to play for them?
  const playForPlayerId = [id1, id2].find((id) => {
    const p = getPlayerById(id);
    return p && p.isProxy && !p.isComputer && !submittedIds.includes(id);
  });
  const playForPlayer = playForPlayerId ? getPlayerById(playForPlayerId) : null;

  const needOwnPick = isParticipant && !submittedIds.includes(me.id);

  // Reset RPS buttons
  $$('.rps-btn').forEach(b => {
    b.classList.remove('selected');
    b.disabled = false;
  });

  if (needOwnPick) {
    state.currentPlayForPlayerId = null;
    $('#rps-pick p').textContent = 'Make your move!';
    showRPSSection('pick');
    SFX.newRound();
  } else if (isHost && playForPlayer) {
    state.currentPlayForPlayerId = playForPlayerId;
    $('#rps-pick p').textContent = `Play for ${playForPlayer.name}!`;
    showRPSSection('pick');
    SFX.newRound();
  } else {
    state.currentPlayForPlayerId = null;
    showRPSSection('waiting');
    $('#rps-waiting-text').textContent = isParticipant
      ? 'Waiting for opponent...'
      : 'Waiting for both players...';
    syncRpsSpectatePanel();
    renderRpsLiveWeapons();
  }
}

function showRPSSection(section) {
  $('#rps-pick').classList.toggle('hidden', section !== 'pick');
  $('#rps-waiting').classList.toggle('hidden', section !== 'waiting');
  $('#rps-reveal').classList.toggle('hidden', section !== 'reveal');
}

function showRPSReveal(choices, result, winnerId, loserId, round) {
  showRPSSection('reveal');
  SFX.rpsReveal();

  const room = state.roomState;
  const [id1, id2] = room.rpsState.selected;

  $('#reveal-1 .reveal-emoji').textContent = RPS_EMOJI[choices[id1]] || '?';
  $('#reveal-2 .reveal-emoji').textContent = RPS_EMOJI[choices[id2]] || '?';

  const revealText = $('#reveal-text');
  if (result === 'tie') {
    revealText.textContent = "It's a tie! Going again...";
    revealText.className = 'reveal-text tie';
    setTimeout(() => SFX.tie(), 400);
  } else {
    const winner = getPlayerById(winnerId);
    revealText.textContent = `${winner?.name} wins!`;
    revealText.className = 'reveal-text decided';
    setTimeout(() => SFX.victory(), 400);
  }
}

// === Result Screen ===
function showResultScreen(facilitatorId) {
  const player = getPlayerById(facilitatorId);
  if (!player) return;

  // Find the winner (the other selected player)
  const room = state.roomState;
  const winnerId = room.rpsState.selected.find(id => id !== facilitatorId);
  const winner = getPlayerById(winnerId);

  $('#result-player .result-avatar').textContent = player.avatar;
  $('#result-player .result-name').textContent = player.name;

  if (winner) {
    $('#winner-avatar').textContent = winner.avatar;
    $('#winner-name').textContent = winner.name;
  }

  showScreen('result');
  spawnConfetti();
  SFX.celebrate();
  // Play the loser sound after a beat
  setTimeout(() => SFX.loser(), 800);
}

// === Confetti ===
function spawnConfetti() {
  const container = $('#confetti-container');
  container.innerHTML = '';

  const colors = ['#e94560', '#7c5cfc', '#0eca6e', '#ffc107', '#00d4ff', '#ff6b6b'];

  for (let i = 0; i < 80; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + 'vw';
    piece.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    piece.style.width = (Math.random() * 8 + 6) + 'px';
    piece.style.height = (Math.random() * 8 + 6) + 'px';
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    piece.style.animationDuration = (Math.random() * 2 + 2) + 's';
    piece.style.animationDelay = (Math.random() * 1.5) + 's';
    container.appendChild(piece);
  }

  // Clean up after animation
  setTimeout(() => { container.innerHTML = ''; }, 5000);
}

// === Start ===
init();
