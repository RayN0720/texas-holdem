'use strict';

// ─── Global state ───────────────────────────────────────────────────────
const state = {
  ws: null,
  myId: null,
  isHost: false,
  roomCode: null,
  game: null,          // latest game state
  myCards: [],
  currentRequest: null, // action_request payload for me
  mySeat: -1,
};

// ─── DOM helpers ────────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(name + '-screen').classList.add('active');
}

// ─── Card rendering ─────────────────────────────────────────────────────
function cardHTML(cardStr, cls = '') {
  if (!cardStr) return '';
  const rank = cardStr[0];
  const suit = cardStr[1];
  const suitSym = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const red = suit === 'h' || suit === 'd';
  return `<div class="${cls} ${red ? 'red' : 'black'}"><span class="rank">${rank}</span><span class="suit">${suitSym[suit]}</span></div>`;
}

function miniCardHTML(cardStr) {
  if (!cardStr) return `<div class="mini-card back"></div>`;
  const rank = cardStr[0];
  const suit = cardStr[1];
  const suitSym = { s: '♠', h: '♥', d: '♦', c: '♣' };
  const red = suit === 'h' || suit === 'd';
  return `<div class="mini-card ${red ? 'red' : 'black'}">${rank}${suitSym[suit]}</div>`;
}

// ─── Connection ─────────────────────────────────────────────────────────
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const wsUrl = `${proto}://${location.host}/ws`;
  const ws = new WebSocket(wsUrl);
  state.ws = ws;

  ws.onopen = () => {
    // if we're reconnecting and already in a room, resend join
    const pendingName = localStorage.getItem('th_name') || '';
    if (state.roomCode && pendingName) {
      ws.send(JSON.stringify({ type: 'join_room', roomCode: state.roomCode, name: pendingName }));
    }
  };

  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleMessage(msg);
  };

  ws.onclose = () => {
    toast('连接断开，尝试重连...');
    setTimeout(connect, 2000);
  };
}

// ─── Message handling ───────────────────────────────────────────────────
function handleMessage(msg) {
  switch (msg.type) {
    case 'room_created':
      state.myId = msg.playerId;
      state.isHost = true;
      state.roomCode = msg.roomCode;
      enterLobbyRoom();
      break;

    case 'joined':
      state.myId = msg.playerId;
      state.isHost = false;
      state.roomCode = msg.roomCode;
      enterLobbyRoom();
      break;

    case 'room_state':
      renderLobby(msg);
      break;

    case 'game_start':
      state.game = { phase: 'IDLE', players: msg.players, community: [], pot: 0 };
      state.myCards = [];
      showScreen('game');
      $('#room-code-tiny').textContent = state.roomCode;
      renderPlayers(msg.players);
      renderCommunity([]);
      break;

    case 'deal_card':
      // private card sent to this player
      if (state.game) {
        state.myCards.push(msg.card);
        renderMyCards();
      }
      break;

    case 'community_cards':
      if (state.game) {
        state.game.community = msg.cards;
        renderCommunity(msg.cards);
        $('#phase-display').textContent = phaseName(msg.phase);
      }
      break;

    case 'phase_changed':
      $('#phase-display').textContent = phaseName(msg.phase);
      break;

    case 'pot_update':
      if (state.game) state.game.pot = msg.mainPot;
      $('#pot-display').textContent = `底池: ${msg.mainPot}`;
      break;

    case 'state_changed':
      applyGameState(msg);
      break;

    case 'action_request':
      state.currentRequest = msg;
      showActionBar(msg);
      break;

    case 'turn_changed':
      updateTurnHighlight(msg.playerId);
      break;

    case 'action_announce':
      announceAction(msg);
      break;

    case 'blind_posted':
      if (state.game) {
        const p = state.game.players.find(x => x.id === msg.playerId);
        if (p) { p.roundBet += msg.amount; p.totalBet += msg.amount; }
        renderPlayers(state.game.players);
      }
      break;

    case 'showdown_start':
      break;

    case 'showdown':
      showShowdownModal(msg.pots);
      break;

    case 'hand_ended':
      toast(msg.reason === 'everyone_folded' ? '所有对手弃牌，你赢下底池！' : '本手结束');
      if (msg.winners && msg.winners.length > 0) {
        const w = msg.winners[0];
        if (w.id === state.myId) toast(`🎉 你赢了 ${w.amount}`);
      }
      hideActionBar();
      break;

    case 'error':
      toast('⚠️ ' + msg.message);
      break;

    case 'pong':
      break;
  }
}

function phaseName(phase) {
  return {
    'PRE_FLOP': '翻牌前', 'FLOP': '翻牌', 'TURN': '转牌',
    'RIVER': '河牌', 'SHOWDOWN': '摊牌', 'IDLE': '等待',
  }[phase] || phase;
}

// ─── Game state rendering ───────────────────────────────────────────────
function applyGameState(gs) {
  if (!state.game) state.game = {};
  state.game = Object.assign(state.game, gs);
  renderPlayers(gs.players || []);
  renderCommunity(gs.community || []);
  if (gs.pot !== undefined) $('#pot-display').textContent = `底池: ${gs.pot}`;
  if (gs.phase) $('#phase-display').textContent = phaseName(gs.phase);
  updateTurnHighlight(gs.whoseTurn);
  // If it's my turn but I'm AI... nothing; server handles AI.
}

function renderPlayers(players) {
  if (!players || !players.length) return;
  const meIdx = players.findIndex(p => p.id === state.myId);
  // order: start from my seat for display
  const ordered = [];
  for (let i = 0; i < players.length; i++) {
    const idx = (meIdx + i) % players.length;
    ordered.push(players[idx]);
  }
  const container = $('#players-row');
  container.innerHTML = ordered.map(p => {
    const isMe = p.id === state.myId;
    const hasCards = p.folded ? '' : (state.game && state.game.phase !== 'IDLE' ? 'back' : '');
    const cardsHTML = state.game && state.game.phase !== 'IDLE'
      ? (isMe ? (state.myCards.length >= 2 ? state.myCards.map(miniCardHTML).join('') : '<div class="mini-card back"></div><div class="mini-card back"></div>')
        : (p.folded ? '' : `<div class="mini-card back"></div><div class="mini-card back"></div>`))
      : '';
    const equity = p.equity ? `<div class="p-equity">${(p.equity*100).toFixed(0)}%</div>` : '';
    const dealerBtn = state.game && state.game.dealerIdx !== undefined && state.game.dealerIdx === players.indexOf(p) ? '<div class="dealer-btn">D</div>' : '';
    const lastAct = p.lastAction ? `<div class="last-action">${actionLabel(p.lastAction)}</div>` : '';
    const debt = p.stack < 0;
    return `
      <div class="player-tile ${isMe ? 'me' : ''} ${p.folded ? 'folded' : ''}" data-id="${p.id}">
        ${dealerBtn}${equity}
        <div class="p-name">${escapeHtml(p.name)}${isMe ? ' (你)' : ''}</div>
        <div class="p-cards">${cardsHTML}</div>
        <div class="p-stack ${debt ? 'debt' : ''}">${p.stack}</div>
        ${debt ? '<div class="debt-tag">欠款</div>' : ''}
        <div class="p-bet">${p.roundBet > 0 ? '下注 ' + p.roundBet : ''}</div>
        ${lastAct}
      </div>`;
  }).join('');
}

function actionLabel(a) {
  return { fold: '弃牌', check: '过牌', call: '跟注', raise: '加注', allin: '全压' }[a] || a;
}

function renderCommunity(cards) {
  const slots = $$('#community .card-slot');
  slots.forEach((slot, i) => {
    const card = cards[i];
    if (card) {
      slot.innerHTML = cardHTML(card);
      slot.classList.add('filled');
    } else {
      slot.innerHTML = '';
      slot.classList.remove('filled');
    }
  });
}

function renderMyCards() {
  const container = $('#my-cards');
  if (!state.myCards.length) { container.innerHTML = ''; return; }
  container.innerHTML = state.myCards.map(c => cardHTML(c, 'big-card')).join('');
}

function updateTurnHighlight(playerId) {
  document.querySelectorAll('.player-tile').forEach(el => {
    el.classList.toggle('current', el.dataset.id === playerId);
  });
}

function announceAction(msg) {
  const name = state.game && state.game.players.find(p => p.id === msg.playerId)?.name || '玩家';
  const amt = msg.amount ? ` ${msg.amount}` : '';
  toast(`${name} ${actionLabel(msg.action)}${amt}`);
}

// ─── Action bar ─────────────────────────────────────────────────────────
function showActionBar(req) {
  const bar = $('#action-bar');
  bar.classList.remove('hidden');
  $('#act-fold').classList.toggle('hidden', !req.options.includes('fold'));
  $('#act-check').classList.toggle('hidden', !req.options.includes('check'));
  $('#act-call').classList.toggle('hidden', !req.options.includes('call'));
  $('#act-allin').classList.toggle('hidden', !req.options.includes('allin'));
  const canRaise = req.options.includes('raise');
  $('#raise-row').classList.toggle('hidden', !canRaise);
  $('#act-raise').classList.toggle('hidden', !canRaise);

  const callBtn = $('#act-call');
  if (req.options.includes('call')) {
    $('#call-amount').textContent = req.toCall;
    callBtn.classList.remove('hidden');
  } else {
    callBtn.classList.add('hidden');
  }

  // raise slider
  if (canRaise) {
    const slider = $('#raise-slider');
    const min = req.minRaiseTo || req.toCall;
    // With unlimited debt there's no stack cap; offer a generous range so
    // players can bet big. Base it on pot + current bet, min 3x minRaise.
    const pot = state.game?.pot || 0;
    const cap = Math.max(min * 3, Math.round((pot + req.toCall) * 2) + req.toCall);
    slider.min = min;
    slider.max = cap;
    slider.value = Math.min(cap, min);
    updateRaiseLabel(req);
    slider.oninput = () => updateRaiseLabel(req);
  }
}

function updateRaiseLabel(req) {
  const slider = $('#raise-slider');
  $('#raise-amount').textContent = slider.value;
}

function hideActionBar() {
  $('#action-bar').classList.add('hidden');
}

// ─── Lobby rendering ────────────────────────────────────────────────────
function enterLobbyRoom() {
  showScreen('lobby');
  $('#lobby-home').classList.add('hidden');
  $('#lobby-room').classList.remove('hidden');
  $('#room-code').textContent = state.roomCode;
  $('#conn-info').textContent = `${location.hostname}:${location.port}`;
  $('#btn-add-ai').classList.toggle('hidden', !state.isHost);
  $('#btn-start').classList.toggle('hidden', !state.isHost);
  localStorage.setItem('th_name', $('#name-input').value || 'Player');
}

function renderLobby(room) {
  if (!room) return;
  state.roomCode = room.roomCode;
  $('#room-code').textContent = room.roomCode;
  const list = $('#player-list');
  list.innerHTML = room.players.map(p => `
    <div class="player-row">
      <span>${escapeHtml(p.name)}${p.id === state.myId ? ' (你)' : ''}</span>
      ${p.isAI ? '<span class="is-ai">AI</span>' : ''}
    </div>
  `).join('');
  const canStart = room.players.length >= 2;
  $('#btn-start').disabled = !canStart;
  if (state.isHost) {
    $('#btn-start').textContent = canStart ? '开始游戏' : '等待玩家加入 (至少2人)';
  }
}

// ─── Showdown modal ─────────────────────────────────────────────────────
function showShowdownModal(pots) {
  const container = $('#showdown-results');
  container.innerHTML = pots.map(pot => {
    const winners = pot.winners.map(w => `
      <div class="winner-row">
        <span class="w-name">${escapeHtml(w.name)}</span>
        <span class="w-hand">${escapeHtml(w.handType)}</span>
        <span class="w-amount">+${pot.amount}</span>
      </div>`).join('');
    return winners;
  }).join('');
  // 重置"继续"按钮为初始状态（房主需二次确认才发下一局）
  const btn = $('#btn-continue');
  btn.dataset.confirm = '0';
  btn.textContent = '继续';
  $('#showdown-modal').classList.remove('hidden');
}

// ─── Toast ──────────────────────────────────────────────────────────────
function toast(msg) {
  const container = $('#toast-container');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.4s'; }, 1800);
  setTimeout(() => el.remove(), 2300);
}

// ─── Utils ──────────────────────────────────────────────────────────────
function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function send(type, payload = {}) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    state.ws.send(JSON.stringify({ type, ...payload }));
  }
}

// ─── Event wiring ───────────────────────────────────────────────────────
function init() {
  // restore name
  const saved = localStorage.getItem('th_name');
  if (saved) $('#name-input').value = saved;

  $('#btn-create').onclick = () => {
    const name = $('#name-input').value.trim() || '玩家';
    localStorage.setItem('th_name', name);
    send('create_room', { name });
  };

  $('#btn-join').onclick = () => {
    const code = $('#room-code-input').value.trim().toUpperCase();
    const name = $('#name-input').value.trim() || '玩家';
    if (!code) { $('#lobby-error').textContent = '请输入房间码'; return; }
    localStorage.setItem('th_name', name);
    send('join_room', { roomCode: code, name });
  };

  $('#btn-add-ai').onclick = () => send('add_ai');

  $('#btn-start').onclick = () => send('start_game');

  // actions
  document.querySelectorAll('.act-btn[data-act]').forEach(btn => {
    btn.onclick = () => {
      const act = btn.dataset.act;
      const req = state.currentRequest;
      if (act === 'raise') {
        const amount = parseInt($('#raise-slider').value, 10);
        send('player_action', { action: 'raise', amount });
      } else if (act === 'call') {
        send('player_action', { action: 'call' });
      } else {
        send('player_action', { action: act });
      }
      hideActionBar();
    };
  });

  $('#btn-continue').onclick = () => {
    // 二次确认：房主第一次点击只改变按钮文字，再次点击（3 秒内）才真正开始下一局，
    // 避免"点继续→立刻自动连发"导致无休止循环。
    if (state.isHost) {
      const btn = $('#btn-continue');
      if (btn.dataset.confirm === '1') {
        $('#showdown-modal').classList.add('hidden');
        btn.dataset.confirm = '0';
        btn.textContent = '继续';
        send('start_game');
      } else {
        btn.dataset.confirm = '1';
        btn.textContent = '确认开始下一局？';
        setTimeout(() => {
          if (btn.dataset.confirm === '1') {
            btn.dataset.confirm = '0';
            btn.textContent = '继续';
          }
        }, 3000);
      }
    } else {
      $('#showdown-modal').classList.add('hidden');
    }
  };

  // register service worker for offline/PWA install
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW failed:', err));
  }

  connect();
}

document.addEventListener('DOMContentLoaded', init);
