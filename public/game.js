// Client-side state
const state = {
  socket: null,
  myId: null,
  myName: '',
  isHost: false,
  roomCode: '',
  phase: 'lobby',   // 'lobby' | 'waiting' | 'game'
  myHand: [],       // my 3 cards ['AH','KD','QS']
  isBlind: true,
  myChips: 0,
  isMuted: false,
  chatOpen: false,
  unreadChat: 0,
  currentOptions: null,  // options from game:yourTurn
  isMyTurn: false,
  timerInterval: null,
  players: [],      // public player list from server
  pot: 0,
  currentBet: 0,
  roundNumber: 0,
};

// --- Hand Strength ---
const RANK_VALUES = {'2':2,'3':3,'4':4,'5':5,'6':6,'7':7,'8':8,'9':9,'T':10,'J':11,'Q':12,'K':13,'A':14};

function parseCard(card) {
  return { rank: card.slice(0,-1), suit: card.slice(-1), value: RANK_VALUES[card.slice(0,-1)] };
}

function rankHand(cards) {
  const parsed = cards.map(parseCard).sort((a, b) => b.value - a.value);
  const vals = parsed.map(c => c.value);
  const su = parsed.map(c => c.suit);

  const isFlush = su[0] === su[1] && su[1] === su[2];
  
  let isSeq = false;
  let seqVals = [...vals];
  if (vals[0] === vals[1] + 1 && vals[1] === vals[2] + 1) {
    isSeq = true;
  } else if (vals[0] === 14 && vals[1] === 3 && vals[2] === 2) {
    isSeq = true;
    seqVals = [3, 2, 14];
  }

  const isTrail = vals[0] === vals[1] && vals[1] === vals[2];
  
  let isPair = false;
  if (vals[0] === vals[1]) { isPair = true; }
  else if (vals[1] === vals[2]) { isPair = true; }
  else if (vals[0] === vals[2]) { isPair = true; }

  if (isTrail) return { rank: 1, label: 'Trail' };
  if (isSeq && isFlush) return { rank: 2, label: 'Pure Sequence' };
  if (isSeq) return { rank: 3, label: 'Sequence' };
  if (isFlush) return { rank: 4, label: 'Color' };
  if (isPair) return { rank: 5, label: 'Pair' };
  return { rank: 6, label: 'High Card' };
}

function getHandStrength(cards) {
  const r = rankHand(cards);
  let percentile, emoji, description;
  switch (r.rank) {
    case 1:
      percentile = 95; emoji = '🔥'; description = 'Three of a Kind! You have three of a kind. This is the best hand in Teen Patti — you are almost certainly winning!';
      break;
    case 2:
      percentile = 85; emoji = '💎'; description = 'Pure Sequence! You have a straight flush. Amazing hand, bet confidently!';
      break;
    case 3:
      percentile = 70; emoji = '⚡'; description = 'Sequence! You have a straight. Very strong hand in Teen Patti.';
      break;
    case 4:
      percentile = 50; emoji = '👍'; description = 'Color! You have a flush. Good hand, but be careful of sequences.';
      break;
    case 5:
      percentile = 30; emoji = '🤔'; description = 'Pair! You have a pair. Play cautiously.';
      break;
    case 6:
      percentile = 10; emoji = '😬'; description = 'High Card. This is the weakest hand type. Consider staying Blind to save chips!';
      break;
  }
  return { rank: r.rank, label: r.label, description, percentile, emoji };
}

// --- Sound Effects ---
const SOUNDS = {};
const soundFiles = ['deal','chip','fold','raise','tick','win'];

function initSounds() {
  soundFiles.forEach(name => {
    const audio = new Audio(`/sounds/${name}.mp3`);
    audio.preload = 'auto';
    // Silently ignore load errors — sound files may not exist yet
    audio.addEventListener('error', () => {});
    SOUNDS[name] = audio;
  });
}

function playSound(name) {
  if (state.isMuted) return;
  const snd = SOUNDS[name];
  if (!snd) return;
  // Clone to allow overlapping plays
  try {
    const clone = snd.cloneNode();
    clone.volume = name === 'win' ? 1.0 : 0.6;
    clone.play().catch(() => {});
  } catch(e) {}
}

// --- Card Rendering ---
const SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RED_SUITS = new Set(['H','D']);

function cardHTML(cardStr, faceDown = false) {
  if (faceDown) {
    return `<div class="card back"></div>`;
  }
  const { rank, suit } = parseCard(cardStr);
  const sym = SUIT_SYMBOLS[suit];
  const red = RED_SUITS.has(suit) ? ' red' : '';
  // rank display: T->10, J->J, Q->Q, K->K, A->A
  const display = rank === 'T' ? '10' : rank;
  return `
    <div class="card${red}">
      <div class="rank-top">${display}${sym}</div>
      <div class="suit-center">${sym}</div>
      <div class="rank-bottom">${display}${sym}</div>
    </div>
  `;
}

// --- Seat Positioning ---
function getSeatPositions(numPlayers) {
  const positions = [];
  const angleStep = 360 / numPlayers;
  for (let i = 0; i < numPlayers; i++) {
    // Start from bottom (270 degrees = bottom center), go clockwise
    const angle = (270 + i * angleStep) % 360;
    const rad = (angle * Math.PI) / 180;
    const x = 50 + 38 * Math.cos(rad);  // % from center
    const y = 50 + 38 * Math.sin(rad);  // % from center
    positions.push({ left: `${x}%`, top: `${y}%` });
  }
  return positions;
}

function renderSeats(players) {
  const container = document.getElementById('player-seats');
  container.innerHTML = '';
  const positions = getSeatPositions(players.length);
  players.forEach((player, i) => {
    const pos = positions[i];
    const isMe = player.id === state.myId;
    const isFolded = player.state === 'folded';
    const isActive = player.id === state.players[state.currentPlayerIndex]?.id;
    const div = document.createElement('div');
    div.className = `seat${isMe ? ' me' : ''}${isFolded ? ' folded' : ''}${isActive ? ' active' : ''}`;
    div.id = `seat-${player.id}`;
    div.style.left = pos.left;
    div.style.top = pos.top;
    div.style.transform = 'translate(-50%, -50%)';
    // Cards: face down for others, face up for me (if seen)
    let cardsHTML = '';
    if (isMe && state.myHand.length > 0 && !state.isBlind) {
      cardsHTML = state.myHand.map(c => cardHTML(c)).join('');
    } else {
      // Show back of card for each card count
      for(let j = 0; j < (player.handSize || 3); j++) {
        cardsHTML += cardHTML(null, true);
      }
    }
    div.innerHTML = `
      <div class="seat-name">${isMe ? '⭐ ' : ''}${player.name}${player.state === 'blind' ? ' 🙈' : player.state === 'seen' ? ' 👁️' : ''}</div>
      <div class="seat-cards">${cardsHTML}</div>
      <div class="seat-chips">₹${player.chips}</div>
      <div class="seat-state">${isFolded ? 'Folded' : player.state || ''}</div>
    `;
    container.appendChild(div);
  });
}

// --- GSAP Animations ---
function animateDeal() {
  const table = document.getElementById('game-table');
  const tableRect = table.getBoundingClientRect();
  const centerX = tableRect.left + tableRect.width / 2;
  const centerY = tableRect.top + tableRect.height / 2;

  document.querySelectorAll('.seat .card').forEach((card, i) => {
    const cardRect = card.getBoundingClientRect();
    const dx = centerX - cardRect.left;
    const dy = centerY - cardRect.top;
    if (window.gsap) {
      gsap.from(card, {
        x: dx, y: dy,
        scale: 0.2,
        opacity: 0,
        duration: 0.5,
        delay: i * 0.08,
        ease: 'power2.out'
      });
    }
  });
  playSound('deal');
}

function animateFold(playerId) {
  const seat = document.getElementById(`seat-${playerId}`);
  if (!seat) return;
  playSound('fold');
  if (window.gsap) {
    gsap.to(seat.querySelectorAll('.card'), {
      opacity: 0.2,
      rotation: 15,
      y: 15,
      duration: 0.4,
      ease: 'power2.in'
    });
  }
}

function animateChipToPot(playerId) {
  playSound('chip');
  const seat = document.getElementById(`seat-${playerId}`);
  const pot = document.getElementById('pot-display');
  if (!seat || !pot || !window.gsap) return;
  const chip = document.createElement('div');
  chip.className = 'flying-chip';
  chip.textContent = '₹';
  chip.style.cssText = `position:fixed;z-index:999;width:24px;height:24px;border-radius:50%;background:#f0c040;color:#1a1a1a;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:bold;pointer-events:none;`;
  document.body.appendChild(chip);
  const seatRect = seat.getBoundingClientRect();
  const potRect = pot.getBoundingClientRect();
  chip.style.left = seatRect.left + seatRect.width/2 + 'px';
  chip.style.top = seatRect.top + seatRect.height/2 + 'px';
  gsap.to(chip, {
    left: potRect.left + potRect.width/2,
    top: potRect.top + potRect.height/2,
    scale: 0.3,
    opacity: 0,
    duration: 0.6,
    ease: 'power2.in',
    onComplete: () => chip.remove()
  });
}

function animateWin(winnerId, winnerName) {
  playSound('win');
  const seat = document.getElementById(`seat-${winnerId}`);
  if (seat && window.gsap) {
    gsap.to(seat.querySelectorAll('.card'), {
      scale: 1.15,
      duration: 0.3,
      yoyo: true,
      repeat: 5,
      ease: 'power1.inOut'
    });
  }
  showConfetti();
}

function showConfetti() {
  const colors = ['#f0c040','#2ecc71','#e74c3c','#3498db','#9b59b6'];
  for (let i = 0; i < 50; i++) {
    const c = document.createElement('div');
    c.className = 'confetti-piece';
    c.style.cssText = `
      position:fixed;z-index:999;width:8px;height:8px;
      background:${colors[i % colors.length]};
      left:${Math.random()*100}vw;
      top:-10px;
      border-radius:${Math.random() > 0.5 ? '50%' : '0'};
      pointer-events:none;
    `;
    document.body.appendChild(c);
    if (window.gsap) {
      gsap.to(c, {
        y: window.innerHeight + 20,
        x: (Math.random()-0.5)*200,
        rotation: Math.random()*720,
        duration: 2 + Math.random()*2,
        delay: Math.random()*1,
        ease: 'power1.in',
        onComplete: () => c.remove()
      });
    } else {
      setTimeout(() => c.remove(), 4000);
    }
  }
}

// --- Turn Timer ---
function startTimer(seconds) {
  stopTimer();
  const timerEl = document.getElementById('turn-timer');
  const timerText = timerEl?.querySelector('.timer-text');
  const ring = document.getElementById('timer-ring');
  if (!ring) return;
  
  const radius = 20;
  const circumference = 2 * Math.PI * radius;
  ring.setAttribute('r', radius);
  ring.setAttribute('cx', 25);
  ring.setAttribute('cy', 25);
  ring.style.strokeDasharray = circumference;

  let remaining = seconds;
  function tick() {
    if (timerText) timerText.textContent = remaining;
    const offset = circumference * (1 - remaining / seconds);
    ring.style.strokeDashoffset = offset;
    ring.style.stroke = remaining <= 10 ? '#e74c3c' : '#f0c040';
    if (remaining <= 10 && remaining > 0) playSound('tick');
    if (remaining <= 0) { stopTimer(); return; }
    remaining--;
  }
  tick();
  state.timerInterval = setInterval(tick, 1000);
}

function stopTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

// --- UI Helpers ---
function showView(viewName) {
  document.querySelectorAll('[id^="view-"]').forEach(v => v.style.display = 'none');
  const el = document.getElementById(`view-${viewName}`);
  if (el) el.style.display = viewName === 'game' ? 'block' : 'flex';
  state.phase = viewName;
}

function showError(elementId, msg) {
  const el = document.getElementById(elementId);
  if (el) { el.textContent = msg; el.style.display = 'block'; }
  setTimeout(() => { if (el) el.style.display = 'none'; }, 4000);
}

function updatePot(amount) {
  state.pot = amount;
  const el = document.getElementById('pot-display');
  if (el) el.innerHTML = `<div class="pot-label">POT</div><div class="pot-amount">₹${amount}</div>`;
}

function updateMyChips(amount) {
  state.myChips = amount;
  const el = document.getElementById('my-chips');
  if (el) el.textContent = `₹${amount}`;
}

function updateHandStrength(cards) {
  if (!cards || cards.length === 0) return;
  const strength = getHandStrength(cards);
  const fill = document.getElementById('hand-strength-fill');
  const label = document.getElementById('hand-strength-label');
  const desc = document.getElementById('hand-strength-desc');
  if (fill) fill.style.left = `${strength.percentile}%`;
  if (label) label.textContent = `${strength.emoji} ${strength.label}`;
  if (desc) desc.textContent = strength.description;
}

function setActionButtons(options) {
  state.currentOptions = options;
  state.isMyTurn = true;
  const panel = document.getElementById('action-panel');
  if (panel) panel.style.display = 'flex';

  const btnCall = document.getElementById('btn-call');
  const btnRaise = document.getElementById('btn-raise');
  const btnFold = document.getElementById('btn-fold');
  const btnShow = document.getElementById('btn-show');
  const btnSideshow = document.getElementById('btn-sideshow');

  if (btnCall) {
    btnCall.disabled = !options.canCall;
    const amount = options.callAmount || options.currentBet;
    btnCall.textContent = options.isBlind ? `Chaal ₹${amount} 🙈` : `Chaal ₹${amount} 👁️`;
  }
  if (btnRaise) btnRaise.disabled = !options.canRaise;
  if (btnFold) btnFold.disabled = !options.canFold;
  if (btnShow) {
    btnShow.disabled = !options.canShow;
    btnShow.style.display = options.canShow ? 'block' : 'none';
  }
  if (btnSideshow) {
    btnSideshow.disabled = !options.canSideshow;
    btnSideshow.style.display = options.canSideshow ? 'block' : 'none';
  }

  const slider = document.getElementById('raise-slider');
  const raiseDisplay = document.getElementById('raise-display');
  if (slider && options.minRaise) {
    slider.min = options.minRaise;
    slider.max = Math.min(options.myChips, options.minRaise * 10);
    slider.value = options.minRaise;
    if (raiseDisplay) raiseDisplay.textContent = `₹${slider.value}`;
  }
}

function hideActionButtons() {
  state.isMyTurn = false;
  const panel = document.getElementById('action-panel');
  if (panel) panel.style.display = 'none';
  const raisePanel = document.getElementById('raise-panel');
  if (raisePanel) raisePanel.style.display = 'none';
}

function renderWaitingPlayers(players, hostId) {
  const list = document.getElementById('waiting-players-list') || document.getElementById('players-list');
  if (!list) return;
  list.innerHTML = players.map(p => `
    <div class="waiting-player">
      <div class="player-avatar" style="background:${nameToColor(p.name)}">${p.name[0].toUpperCase()}</div>
      <span class="player-name">${p.name}${p.id === state.myId ? ' (You)' : ''}${p.id === hostId ? ' 👑' : ''}</span>
      <span class="ready-badge ${p.ready ? 'ready' : 'not-ready'}">${p.ready ? '✅ Ready' : '⏳ Waiting'}</span>
    </div>
  `).join('');
}

function nameToColor(name) {
  let hash = 0;
  for (const c of name) hash = c.charCodeAt(0) + ((hash << 5) - hash);
  return `hsl(${hash % 360}, 60%, 40%)`;
}

function addChatMessage(name, text, time) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'chat-msg';
  const t = new Date(time).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  div.innerHTML = `<span class="chat-name">${name}</span> <span class="chat-time">${t}</span><br>${text}`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  if (!state.chatOpen) {
    state.unreadChat++;
    const badge = document.getElementById('chat-badge');
    if (badge) { badge.textContent = state.unreadChat; badge.style.display = 'block'; }
  }
}

function showWinOverlay(winnerId, winnerName, winnerHand, allHands, pot) {
  const overlay = document.getElementById('win-overlay');
  if (!overlay) return;
  const strength = winnerHand ? getHandStrength(winnerHand) : null;
  document.getElementById('win-name').textContent = `🎉 ${winnerName} wins!`;
  document.getElementById('win-hand-label').textContent = strength ? `${strength.emoji} ${strength.label}` : '';
  document.getElementById('win-pot').textContent = `₹${pot}`;
  
  const cardsDisplay = document.getElementById('win-cards-display');
  if (cardsDisplay && allHands) {
    cardsDisplay.innerHTML = allHands.map(h => `
      <div class="reveal-player">
        <div class="reveal-name">${h.name}${h.state === 'folded' ? ' (folded)' : ''}</div>
        <div class="reveal-cards">
          ${h.hand && h.state !== 'folded' ? h.hand.map(c => cardHTML(c)).join('') : '<span class="text-muted">folded</span>'}
        </div>
        ${h.hand && h.state !== 'folded' ? `<div class="reveal-label">${getHandStrength(h.hand).emoji} ${getHandStrength(h.hand).label}</div>` : ''}
      </div>
    `).join('');
  }
  const nextBtn = document.getElementById('btn-next-round');
  if (nextBtn) nextBtn.style.display = state.isHost ? 'block' : 'none';
  overlay.style.display = 'flex';
}

function getBackendUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  const paramUrl = urlParams.get('server');
  if (paramUrl) {
    localStorage.setItem('teen_patti_backend', paramUrl);
    return paramUrl;
  }
  const saved = localStorage.getItem('teen_patti_backend');
  if (saved) return saved;
  if (window.location.hostname.includes('vercel.app')) {
    return 'https://teen-pati.onrender.com';
  }
  return undefined;
}

// --- Socket.io Event Handlers ---
function initSocket() {
  const backend = getBackendUrl();
  state.socket = backend ? io(backend, { transports: ['websocket', 'polling'] }) : io();
  const socket = state.socket;

  socket.on('connect', () => {
    const statusEl = document.getElementById('connection-status');
    if (statusEl) statusEl.style.display = 'none';
  });

  socket.on('connect_error', () => {
    const statusEl = document.getElementById('connection-status');
    if (statusEl) {
      statusEl.textContent = 'Connecting to backend... (If Render just started, it takes ~30s to wake up)';
      statusEl.style.display = 'block';
    }
  });

  socket.on('room:joined', ({ room, playerId, isHost }) => {
    state.myId = playerId;
    state.isHost = isHost;
    state.roomCode = room.code;
    updateRoomUI(room);
    showView('waiting');
    
    const shareLink = document.getElementById('share-link');
    if (shareLink) shareLink.value = `${window.location.origin}/${room.code}`;
    const codeDisplay = document.getElementById('room-code-display');
    if (codeDisplay) codeDisplay.textContent = room.code;
    
    const settingsPanel = document.getElementById('settings-panel');
    if (settingsPanel) settingsPanel.style.display = isHost ? 'block' : 'none';
    const btnStart = document.getElementById('btn-start');
    if (btnStart) btnStart.style.display = isHost ? 'block' : 'none';
    const btnReady = document.getElementById('btn-ready');
    if (btnReady) btnReady.style.display = isHost ? 'none' : 'block';
  });

  socket.on('room:updated', (room) => {
    updateRoomUI(room);
  });

  socket.on('room:error', ({ message }) => {
    showError('lobby-error', message);
  });

  socket.on('game:dealt', ({ hand, publicState }) => {
    const winOverlay = document.getElementById('win-overlay');
    if (winOverlay) winOverlay.style.display = 'none';
    state.myHand = hand;
    state.isBlind = true;
    showView('game');
    updateGameState(publicState);
    setTimeout(() => animateDeal(), 100);
    updateHandStrength(hand);
    const peekBtn = document.getElementById('btn-peek');
    if (peekBtn) peekBtn.style.display = 'block';
    const myHandEl = document.getElementById('my-hand');
    if (myHandEl) {
      myHandEl.innerHTML = hand.map(() => cardHTML(null, true)).join('');
    }
    const myState = document.getElementById('my-state');
    if (myState) myState.textContent = '🙈 Blind';
    hideActionButtons();
  });

  socket.on('game:yourTurn', ({ options, timeLimit }) => {
    setActionButtons(options);
    startTimer(timeLimit || 35);
    document.querySelectorAll('.seat').forEach(s => s.classList.remove('active'));
    const mySeat = document.getElementById(`seat-${state.myId}`);
    if (mySeat) mySeat.classList.add('active');
  });

  socket.on('game:action', ({ playerId, name, action, amount, publicState }) => {
    stopTimer();
    updateGameState(publicState);
    hideActionButtons();
    if (action === 'fold') {
      animateFold(playerId);
    } else if (action === 'call' || action === 'raise') {
      animateChipToPot(playerId);
      if (action === 'raise') playSound('raise');
    }
    showActionToast(name, action, amount);
  });

  socket.on('game:sideshow_request', ({ requesterName, targetName }) => {
    addChatMessage('🃏 Game', `${requesterName} requested a sideshow with ${targetName}!`, Date.now());
  });

  socket.on('game:sideshow_respond', () => {
    const panel = document.getElementById('sideshow-panel');
    if (panel) panel.style.display = 'flex';
    const msg = document.getElementById('sideshow-message');
    if (msg) msg.textContent = 'Someone wants a sideshow with you!';
  });

  socket.on('game:sideshow_result', ({ requesterName, targetName, loserName, publicState }) => {
    const panel = document.getElementById('sideshow-panel');
    if (panel) panel.style.display = 'none';
    updateGameState(publicState);
    addChatMessage('🃏 Game', `Sideshow result: ${loserName} folds!`, Date.now());
  });

  socket.on('game:sideshow_declined', () => {
    const panel = document.getElementById('sideshow-panel');
    if (panel) panel.style.display = 'none';
    addChatMessage('🃏 Game', 'Sideshow declined.', Date.now());
  });

  socket.on('game:over', ({ winnerId, winnerName, winnerHand, allHands, pot, publicState }) => {
    stopTimer();
    hideActionButtons();
    updateGameState(publicState);
    animateWin(winnerId, winnerName);
    setTimeout(() => showWinOverlay(winnerId, winnerName, winnerHand, allHands, pot), 1500);
  });

  socket.on('game:nextRound', ({ publicState }) => {
    const overlay = document.getElementById('win-overlay');
    if (overlay) overlay.style.display = 'none';
    state.myHand = [];
    state.isBlind = true;
    updateGameState(publicState);
    hideActionButtons();
  });

  socket.on('chat:message', ({ name, text, time }) => {
    addChatMessage(name, text, time);
  });

  socket.on('player:disconnected', ({ name }) => {
    addChatMessage('🔌 System', `${name} disconnected.`, Date.now());
  });
}

function updateRoomUI(room) {
  state.players = room.players;
  state.pot = room.pot || 0;
  state.roundNumber = room.roundNumber || 0;
  if (state.isHost && room.settings) {
    const chipsInput = document.getElementById('settings-chips');
    const bootInput = document.getElementById('settings-boot');
    if (chipsInput) chipsInput.value = room.settings.startingChips;
    if (bootInput) bootInput.value = room.settings.boot;
  }
  renderWaitingPlayers(room.players, room.host);
  const allReady = room.players.filter(p => p.id !== room.host).every(p => p.ready);
  const btnStart = document.getElementById('btn-start');
  if (btnStart) {
    btnStart.disabled = !allReady || room.players.length < 3;
    btnStart.title = room.players.length < 3 ? 'Need at least 3 players' : (allReady ? '' : 'Waiting for players to ready up');
  }
  const status = document.getElementById('waiting-status');
  if (status) {
    const readyCount = room.players.filter(p => p.ready || p.id === room.host).length;
    status.textContent = `${readyCount}/${room.players.length} ready`;
  }
}

function updateGameState(publicState) {
  if (!publicState) return;
  state.players = publicState.players;
  state.pot = publicState.pot;
  state.currentBet = publicState.currentBet;
  state.roundNumber = publicState.roundNumber;
  state.currentPlayerIndex = publicState.currentPlayerIndex;
  updatePot(publicState.pot);
  const rnEl = document.getElementById('round-number');
  if (rnEl) rnEl.textContent = `Round ${publicState.roundNumber}`;
  renderSeats(publicState.players);
  const me = publicState.players.find(p => p.id === state.myId);
  if (me) updateMyChips(me.chips);
  const currentPlayer = publicState.players[publicState.currentPlayerIndex];
  const turnEl = document.getElementById('turn-indicator');
  if (turnEl && currentPlayer) {
    turnEl.textContent = currentPlayer.id === state.myId ? "Your turn!" : `${currentPlayer.name}'s turn`;
  }
}

// --- Event Listeners (DOM) ---
function initUI() {
  const currentBackend = getBackendUrl();
  const backendDisplay = document.getElementById('current-backend-display');
  if (backendDisplay) backendDisplay.textContent = currentBackend || 'Same Host';
  document.getElementById('btn-change-server')?.addEventListener('click', () => {
    const newUrl = prompt('Enter your Render backend URL (e.g. https://teen-pati.onrender.com):', currentBackend || 'https://teen-pati.onrender.com');
    if (newUrl !== null) {
      if (newUrl.trim()) {
        localStorage.setItem('teen_patti_backend', newUrl.trim().replace(/\/+$/, ''));
      } else {
        localStorage.removeItem('teen_patti_backend');
      }
      window.location.reload();
    }
  });

  document.getElementById('btn-create')?.addEventListener('click', () => {
    const name = document.getElementById('input-name')?.value.trim();
    if (!name) { showError('lobby-error', 'Please enter your name!'); return; }
    state.myName = name;
    state.socket.emit('room:create', { name });
  });

  document.getElementById('btn-join')?.addEventListener('click', () => {
    const name = document.getElementById('input-name')?.value.trim();
    const code = document.getElementById('input-code')?.value.trim().toUpperCase();
    if (!name) { showError('lobby-error', 'Please enter your name!'); return; }
    if (!code || code.length !== 4) { showError('lobby-error', 'Enter a valid 4-letter room code!'); return; }
    state.myName = name;
    state.socket.emit('room:join', { code, name });
  });

  document.getElementById('input-code')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-join')?.click();
  });
  
  document.getElementById('input-name')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const code = document.getElementById('input-code')?.value.trim();
      if (code) document.getElementById('btn-join')?.click();
      else document.getElementById('btn-create')?.click();
    }
  });

  document.getElementById('btn-copy-link')?.addEventListener('click', () => {
    const link = document.getElementById('share-link')?.value;
    if (link) navigator.clipboard.writeText(link).then(() => {
      const btn = document.getElementById('btn-copy-link');
      if (btn) { btn.textContent = 'Copied! ✅'; setTimeout(() => btn.textContent = 'Copy Link', 2000); }
    });
  });

  document.getElementById('btn-ready')?.addEventListener('click', () => {
    state.socket.emit('room:ready');
    const btn = document.getElementById('btn-ready');
    if (btn) btn.textContent = btn.textContent === 'Ready' ? 'Cancel Ready' : 'Ready';
  });

  document.getElementById('btn-start')?.addEventListener('click', () => {
    state.socket.emit('game:start');
  });

  document.getElementById('btn-apply-settings')?.addEventListener('click', () => {
    const chips = parseInt(document.getElementById('settings-chips')?.value);
    const boot = parseInt(document.getElementById('settings-boot')?.value);
    if (isNaN(chips) || isNaN(boot)) return;
    state.socket.emit('room:settings', { startingChips: chips, boot });
  });

  document.getElementById('btn-fold')?.addEventListener('click', () => {
    if (!state.isMyTurn) return;
    stopTimer();
    state.socket.emit('game:action', { type: 'fold' });
    hideActionButtons();
  });

  document.getElementById('btn-call')?.addEventListener('click', () => {
    if (!state.isMyTurn) return;
    stopTimer();
    state.socket.emit('game:action', { type: 'call' });
    hideActionButtons();
  });

  document.getElementById('btn-raise')?.addEventListener('click', () => {
    if (!state.isMyTurn) return;
    const raisePanel = document.getElementById('raise-panel');
    if (raisePanel) raisePanel.style.display = raisePanel.style.display === 'flex' ? 'none' : 'flex';
  });

  document.getElementById('btn-raise-confirm')?.addEventListener('click', () => {
    if (!state.isMyTurn) return;
    const amount = parseInt(document.getElementById('raise-slider')?.value);
    if (isNaN(amount)) return;
    stopTimer();
    state.socket.emit('game:action', { type: 'raise', amount });
    hideActionButtons();
    const raisePanel = document.getElementById('raise-panel');
    if (raisePanel) raisePanel.style.display = 'none';
  });

  document.getElementById('btn-raise-cancel')?.addEventListener('click', () => {
    const raisePanel = document.getElementById('raise-panel');
    if (raisePanel) raisePanel.style.display = 'none';
  });

  document.getElementById('raise-slider')?.addEventListener('input', e => {
    const display = document.getElementById('raise-display');
    if (display) display.textContent = `₹${e.target.value}`;
  });

  document.getElementById('btn-show')?.addEventListener('click', () => {
    if (!state.isMyTurn || !state.currentOptions?.canShow) return;
    stopTimer();
    state.socket.emit('game:action', { type: 'show' });
    hideActionButtons();
  });

  document.getElementById('btn-sideshow')?.addEventListener('click', () => {
    if (!state.isMyTurn || !state.currentOptions?.canSideshow) return;
    stopTimer();
    state.socket.emit('game:action', { type: 'sideshow_request' });
    hideActionButtons();
  });

  document.getElementById('btn-sideshow-accept')?.addEventListener('click', () => {
    state.socket.emit('game:sideshow_respond', { accept: true });
    document.getElementById('sideshow-panel').style.display = 'none';
  });

  document.getElementById('btn-sideshow-decline')?.addEventListener('click', () => {
    state.socket.emit('game:sideshow_respond', { accept: false });
    document.getElementById('sideshow-panel').style.display = 'none';
  });

  document.getElementById('btn-peek')?.addEventListener('click', () => {
    state.isBlind = false;
    state.socket?.emit('game:peek');
    const myHandEl = document.getElementById('my-hand');
    if (myHandEl && state.myHand.length > 0) {
      myHandEl.innerHTML = state.myHand.map(c => cardHTML(c)).join('');
    }
    const myState = document.getElementById('my-state');
    if (myState) myState.textContent = '👁️ Seen';
    const peekBtn = document.getElementById('btn-peek');
    if (peekBtn) peekBtn.style.display = 'none';
    const mySeat = document.getElementById(`seat-${state.myId}`);
    if (mySeat) {
      const cardsEl = mySeat.querySelector('.seat-cards');
      if (cardsEl) cardsEl.innerHTML = state.myHand.map(c => cardHTML(c)).join('');
    }
    updateHandStrength(state.myHand);
  });

  document.getElementById('btn-chat-toggle')?.addEventListener('click', () => {
    state.chatOpen = !state.chatOpen;
    const drawer = document.getElementById('chat-drawer');
    if (drawer) drawer.classList.toggle('open', state.chatOpen);
    if (state.chatOpen) {
      state.unreadChat = 0;
      const badge = document.getElementById('chat-badge');
      if (badge) badge.style.display = 'none';
    }
  });

  document.getElementById('btn-chat-send')?.addEventListener('click', sendChat);
  document.getElementById('chat-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') sendChat();
  });

  document.getElementById('btn-rules')?.addEventListener('click', () => openModal('rules'));
  document.getElementById('btn-help')?.addEventListener('click', () => openModal('help'));
  document.getElementById('modal-overlay')?.addEventListener('click', closeModal);
  document.querySelectorAll('.modal-close').forEach(btn => btn.addEventListener('click', closeModal));

  document.querySelectorAll('.modal-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(tabName)?.classList.add('active');
    });
  });

  document.getElementById('btn-mute')?.addEventListener('click', () => {
    state.isMuted = !state.isMuted;
    const btn = document.getElementById('btn-mute');
    if (btn) btn.textContent = state.isMuted ? '🔇' : '🔊';
  });

  document.getElementById('btn-next-round')?.addEventListener('click', () => {
    state.socket.emit('game:start');
    document.getElementById('win-overlay').style.display = 'none';
  });

  document.getElementById('btn-leave-game')?.addEventListener('click', () => {
    window.location.reload();
  });
}

function sendChat() {
  const input = document.getElementById('chat-input');
  const text = input?.value.trim();
  if (!text) return;
  state.socket.emit('chat:send', { text });
  input.value = '';
}

function openModal(name) {
  const overlay = document.getElementById('modal-overlay');
  const modal = document.getElementById(`modal-${name}`);
  if (overlay) overlay.style.display = 'flex';
  if (modal) {
    document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
    modal.style.display = 'block';
  }
  const firstTab = document.querySelector('#modal-rules .modal-tab');
  if (firstTab && name === 'rules') firstTab.click();
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.style.display = 'none';
  document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
}

function showActionToast(name, action, amount) {
  const messages = {
    fold: `${name} folded 😮`,
    call: `${name} called ₹${amount}`,
    raise: `${name} raised to ₹${amount} 🔥`,
    show: `${name} called Show!`,
    sideshow_request: `${name} requested a sideshow`,
  };
  const msg = messages[action] || `${name}: ${action}`;
  const toast = document.createElement('div');
  toast.className = 'action-toast';
  toast.textContent = msg;
  toast.style.cssText = `
    position:fixed;top:80px;left:50%;transform:translateX(-50%);
    background:rgba(0,0,0,0.8);color:white;padding:8px 20px;
    border-radius:20px;z-index:500;font-size:0.9rem;
    border:1px solid rgba(240,192,64,0.3);
    animation: slideUp 0.3s ease;
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2500);
}

// --- Initialization ---
function checkURLForCode() {
  const path = window.location.pathname.replace('/', '').trim().toUpperCase();
  if (path.length === 4 && /^[A-Z]+$/.test(path)) {
    const codeInput = document.getElementById('input-code');
    if (codeInput) codeInput.value = path;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initSounds();
  initSocket();
  initUI();
  checkURLForCode();
  showView('lobby');
  const style = document.createElement('style');
  style.textContent = `
    .waiting-player { display:flex; align-items:center; gap:12px; padding:10px; border-radius:8px; background:rgba(255,255,255,0.04); margin-bottom:8px; }
    .player-avatar { width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;color:white;flex-shrink:0; }
    .ready-badge { margin-left:auto; font-size:0.8rem; padding:3px 10px; border-radius:12px; }
    .ready-badge.ready { background:#1e6b3a; color:#2ecc71; }
    .ready-badge.not-ready { background:#3a1a1a; color:#e74c3c; }
    .action-toast { animation: slideUp 0.3s ease; }
    .reveal-player { text-align:center; margin:0 8px; }
    .reveal-name { font-size:0.8rem; margin-bottom:4px; color:#a09880; }
    .reveal-cards { display:flex; gap:4px; justify-content:center; }
    .reveal-label { font-size:0.75rem; margin-top:4px; color:#f0c040; }
  `;
  document.head.appendChild(style);
});
