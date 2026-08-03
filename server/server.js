'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');
const { TexasGame, createPlayer } = require('./dealer.js');
const { computeAIAction } = require('./ai.js');
const G = require('./game.js');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// ─── MIME types ─────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  // simple static file server
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  // prevent path traversal
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404); res.end('Not found'); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ─── Room management ────────────────────────────────────────────────────
const rooms = new Map(); // roomCode -> Room

function genRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

class Room {
  constructor(code, hostWs, hostName, opts) {
    this.code = code;
    this.hostWs = hostWs;
    this.options = {
      maxPlayers: opts.maxPlayers || 9,
      smallBlind: opts.smallBlind || 10,
      bigBlind: opts.bigBlind || 20,
      buyIn: opts.buyIn || 1000,
    };
    this.players = [];   // createPlayer objects
    this.sockets = new Map(); // playerId -> ws
    this.game = null;
    this.aiTimers = new Map(); // playerId -> timer (one per AI, so multi-AI games don't cancel each other)
    this.autoDeal = true; // host can disable via config later
  }

  addPlayer(ws, name) {
    const player = createPlayer(this.genId(), name, false, this.options.buyIn);
    player.seat = this.players.length;
    this.players.push(player);
    this.sockets.set(player.id, ws);
    this.broadcast('room_state', this.serializeLobby());
    return player;
  }

  addAI(name) {
    if (this.players.length >= this.options.maxPlayers) return null;
    const player = createPlayer(this.genId(), name, true, this.options.buyIn);
    player.seat = this.players.length;
    this.players.push(player);
    this.broadcast('room_state', this.serializeLobby());
    return player;
  }

  genId() {
    return 'p' + Math.random().toString(36).slice(2, 10);
  }

  serializeLobby() {
    return {
      roomCode: this.code,
      maxPlayers: this.options.maxPlayers,
      smallBlind: this.options.smallBlind,
      bigBlind: this.options.bigBlind,
      buyIn: this.options.buyIn,
      players: this.players.map(p => ({ id: p.id, name: p.name, isAI: p.isAI, stack: p.stack, seat: p.seat })),
    };
  }

  broadcast(type, payload) {
    const msg = JSON.stringify({ type, ...payload });
    for (const ws of this.sockets.values()) {
      if (ws.readyState === ws.OPEN) ws.send(msg);
    }
  }

  sendTo(playerId, type, payload) {
    const ws = this.sockets.get(playerId);
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type, ...payload }));
    }
  }

  removePlayer(playerId) {
    const idx = this.players.findIndex(p => p.id === playerId);
    if (idx < 0) return;
    this.players.splice(idx, 1);
    this.sockets.delete(playerId);
    // reassign seats
    this.players.forEach((p, i) => p.seat = i);
    this.broadcast('room_state', this.serializeLobby());
    if (this.game && this.game.phase !== 'IDLE') {
      // player left mid-hand: treat as fold
      const gp = this.game.players.find(p => p.id === playerId);
      if (gp) {
        gp.folded = true;
        this.game.advanceTurn();
        this.broadcast('state_changed', this.game.serializeState());
      }
    }
  }

  // ─── Game lifecycle ─────────────────────────────────────────────────
  startGame() {
    if (this.game && this.game.phase !== 'IDLE') return; // game already running
    if (this.players.length < 2) return;

    if (!this.game) {
      // first game: create a fresh TexasGame with current players
      const gamePlayers = this.players.map(p => createPlayer(p.id, p.name, p.isAI, p.stack > 0 ? p.stack : this.options.buyIn));
      gamePlayers.forEach((p, i) => p.seat = this.players[i].seat);

      this.game = new TexasGame({
        players: gamePlayers,
        smallBlind: this.options.smallBlind,
        bigBlind: this.options.bigBlind,
        onEvent: (e) => this.handleGameEvent(e),
      });

      this.broadcast('game_start', {
        smallBlind: this.options.smallBlind,
        bigBlind: this.options.bigBlind,
        buyIn: this.options.buyIn,
        players: gamePlayers.map(p => ({ id: p.id, name: p.name, isAI: p.isAI, stack: p.stack, seat: p.seat })),
      });
    }
    // start (or continue) a hand
    this.startHand();
  }

  startHand() {
    if (!this.game) return;
    this.broadcast('new_hand', {});
    this.game.startHand();
  }

  handleGameEvent(e) {
    // forward events to clients, routing private cards to owners
    switch (e.type) {
      case 'deal_card':
        this.sendTo(e.playerId, 'deal_card', { card: e.card });
        break;

      case 'action_request':
        // if player is AI, decide & act after a short delay
        const p = this.game.players.find(x => x.id === e.playerId);
        if (p && p.isAI) {
          this.scheduleAIAction(p);
        } else {
          // send private request to human
          this.sendTo(e.playerId, 'action_request', {
            options: e.options, toCall: e.toCall, minRaiseTo: e.minRaiseTo, pot: e.pot,
          });
        }
        // also broadcast turn change
        this.broadcast('turn_changed', { playerId: e.playerId });
        this.broadcast('state_changed', this.game.serializeState());
        break;

      default:
        // broadcast everything else (community, blind, pot, phase, showdown, hand_ended)
        this.broadcast(e.type, e);
        if (e.type === 'hand_ended') {
          this.broadcast('state_changed', this.game.serializeState());
        }
        break;
    }
  }

  scheduleAIAction(player) {
    clearTimeout(this.aiTimers.get(player.id));
    const timer = setTimeout(() => {
      this.aiTimers.delete(player.id);
      const game = this.game;
      if (!game || game.phase === 'IDLE') return;
      const state = game.serializeState();
      const me = state.players.find(p => p.id === player.id);
      if (!me || me.folded || me.isAllIn) return;
      const idx = game.players.findIndex(x => x.id === player.id);
      if (game.whoseTurn !== idx) return;

      const community = game.community.map(c => G.cardToString(c));
      const oppCount = state.players.filter(p => p.id !== player.id && !p.folded && !p.isAllIn).length;
      const toCall = Math.max(0, game.currentBet - game.players[idx].roundBet);
      const minTo = game.currentBet + game.lastRaiseSize;
      const dec = computeAIAction({
        holeCards: player.hole.map(c => G.cardToString(c)),
        communityCards: community,
        opponents: oppCount,
        toCall,
        minRaiseTo: minTo,
        pot: state.pot,
        stack: me.stack,
      });
      const res = game.performAction(player.id, dec.action, dec.amount);
      if (!res.ok) {
        // fallback: check or call
        const fallback = toCall > 0 ? 'call' : 'check';
        game.performAction(player.id, fallback, toCall);
      }
    }, 400 + Math.random() * 700); // realistic thinking delay
    this.aiTimers.set(player.id, timer);
  }
}

// ─── WebSocket ──────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);

  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    handleClientMessage(ws, msg);
  });

  ws.on('close', () => {
    // remove player from room
    for (const room of rooms.values()) {
      if (room.sockets.get(ws.id)) {
        room.removePlayer(ws.id);
        if (room.players.length === 0) rooms.delete(room.code);
      }
    }
  });
});

function handleClientMessage(ws, msg) {
  switch (msg.type) {
    case 'create_room': {
      const code = genRoomCode();
      const room = new Room(code, ws, msg.name || 'Host', {
        maxPlayers: msg.maxPlayers,
        smallBlind: msg.smallBlind,
        bigBlind: msg.bigBlind,
        buyIn: msg.buyIn,
        autoFillAI: msg.autoFillAI,
      });
      rooms.set(code, room);
      const player = room.addPlayer(ws, msg.name || 'Host');
      ws.id = player.id;
      ws.send(JSON.stringify({ type: 'room_created', roomCode: code, playerId: player.id, isHost: true }));
      return;
    }

    case 'join_room': {
      const room = rooms.get(msg.roomCode);
      if (!room) {
        ws.send(JSON.stringify({ type: 'error', message: '房间不存在' }));
        return;
      }
      if (room.players.length >= room.options.maxPlayers) {
        ws.send(JSON.stringify({ type: 'error', message: '房间已满' }));
        return;
      }
      const player = room.addPlayer(ws, msg.name || 'Player');
      ws.id = player.id;
      ws.send(JSON.stringify({ type: 'joined', roomCode: room.code, playerId: player.id, isHost: false }));
      // send current lobby state
      ws.send(JSON.stringify({ type: 'room_state', ...room.serializeLobby() }));
      return;
    }

    case 'start_game': {
      const room = findRoomBySocket(ws);
      if (!room) return;
      if (ws.id !== room.hostWs.id) {
        ws.send(JSON.stringify({ type: 'error', message: '只有房主可以开始游戏' }));
        return;
      }
      room.startGame();
      return;
    }

    case 'player_action': {
      const room = findRoomBySocket(ws);
      if (!room || !room.game) return;
      const res = room.game.performAction(ws.id, msg.action, msg.amount);
      if (!res.ok) {
        ws.send(JSON.stringify({ type: 'error', message: res.error }));
      }
      return;
    }

    case 'add_ai': {
      const room = findRoomBySocket(ws);
      if (!room) return;
      if (ws.id !== room.hostWs.id) return;
      room.addAI('AI ' + (room.players.filter(p => p.isAI).length + 1));
      return;
    }

    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }));
      return;
  }
}

function findRoomBySocket(ws) {
  for (const room of rooms.values()) {
    if (room.sockets.has(ws.id)) return room;
  }
  return null;
}

// heartbeat
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) { ws.terminate(); return; }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// ─── LAN IP + startup info ──────────────────────────────────────────────
function lanIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('=== Texas Hold\'em Server ===');
  console.log(`  Local:   http://localhost:${PORT}`);
  const ips = lanIPs();
  for (const ip of ips) console.log(`  LAN:     http://${ip}:${PORT}`);
  console.log('  Public:  run start-online.bat to get a public URL (any network)');
  console.log('  Phone:   open the URL on your phone, install as PWA app');
});
