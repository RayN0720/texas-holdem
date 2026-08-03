'use strict';

const G = require('./game.js');

// ─── Player model ───────────────────────────────────────────────────────
function createPlayer(id, name, isAI, stack) {
  return {
    id, name, isAI,
    stack, hole: [], folded: false, isAllIn: false,
    roundBet: 0, totalBet: 0,          // per-hand aggregates
    acted: false,                      // has acted in current betting round
    lastAction: null,
    bestHand: null,
    seat: -1,
    connected: true,
  };
}

// ─── Game orchestrator ──────────────────────────────────────────────────
class TexasGame {
  constructor({ players, smallBlind = 10, bigBlind = 20, onEvent }) {
    this.players = players;
    this.smallBlind = smallBlind;
    this.bigBlind = bigBlind;
    this.onEvent = onEvent;
    this.reset();
  }

  reset() {
    this.deck = [];
    this.community = [];
    this.pot = 0;
    this.currentBet = 0;            // highest total bet this street
    this.lastRaiseSize = this.bigBlind; // last full raise increment (for min-raise)
    this.dealerIdx = -1;
    this.phase = 'IDLE';
    this.whoseTurn = -1;
    this.handNumber = 0;
    this.firstHand = true;
  }

  emit(type, payload) { this.onEvent && this.onEvent({ type, ...payload }); }

  active() { return this.players.filter(p => !p.folded); }
  inHand() { return this.players.filter(p => !p.folded && !p.isAllIn); }

  nextSeat(fromIdx, predicate) {
    const n = this.players.length;
    for (let i = 1; i <= n; i++) {
      const idx = (fromIdx + i) % n;
      if (predicate(this.players[idx])) return idx;
    }
    return -1;
  }
  // Everyone can play indefinitely (bankroll may go negative = debt);
  // only players who folded are skipped.
  nextPlayable(fromIdx) { return this.nextSeat(fromIdx, p => !p.folded); }

  // ─── Start a new hand ────────────────────────────────────────────────
  startHand() {
    this.deck = [];
    this.community = [];
    this.pot = 0;
    this.currentBet = 0;
    this.minRaiseTo = this.bigBlind;
    this.whoseTurn = -1;
    this.phase = 'IDLE';
    this.handNumber++;

    // Dealer button: first hand random, then rotate to next playable seat
    if (this.firstHand) {
      this.dealerIdx = this.nextPlayable(Math.floor(Math.random() * this.players.length));
      if (this.dealerIdx < 0) this.dealerIdx = this.nextPlayable(-1);
      this.firstHand = false;
    } else {
      this.dealerIdx = this.nextPlayable(this.dealerIdx);
    }

    for (const p of this.players) {
      p.hole = [];
      p.folded = false;
      p.isAllIn = false;
      p.roundBet = 0;
      p.totalBet = 0;
      p.acted = false;
      p.lastAction = null;
      p.bestHand = null;
    }

    this.deck = G.shuffle(G.createDeck());
    const seated = this.players.filter(p => !p.folded);

    // Deal 2 hole cards
    for (let i = 0; i < 2; i++) {
      for (const p of seated) {
        const card = this.deck.pop();
        p.hole.push(card);
        this.emit('deal_card', { playerId: p.id, card: G.cardToString(card) });
      }
    }

    // Blinds
    const sbIdx = this.nextPlayable(this.dealerIdx);
    const bbIdx = this.nextPlayable(sbIdx);
    const post = (idx, amt) => {
      const p = this.players[idx];
      const actual = amt; // everyone posts full blind even from debt
      p.stack -= actual;
      p.totalBet += actual;
      p.roundBet += actual;
      p.acted = true; // blinds count as acted pre-flop
      this.emit('blind_posted', { playerId: p.id, amount: actual });
    };
    if (sbIdx >= 0) post(sbIdx, this.smallBlind);
    if (bbIdx >= 0) post(bbIdx, this.bigBlind);
    this.currentBet = this.bigBlind;
    this.lastRaiseSize = this.bigBlind;
    this.pot = seated.reduce((s, p) => s + p.totalBet, 0);

    this.phase = 'PRE_FLOP';
    this.emit('phase_changed', { phase: this.phase, community: [] });
    this.emit('pot_update', { mainPot: this.pot });
    this.emit('state_changed', this.serializeState());

    // Heads-up special case: SB is dealer, BB is button
    // Pre-flop first actor: left of big blind
    this.startBettingRound(this.nextPlayable(bbIdx));
  }

  // ─── Betting rounds ──────────────────────────────────────────────────
  startBettingRound(startIdx) {
    const prevRound = this.players.map(p => p.roundBet);
    for (const p of this.players) {
      p.roundBet = 0;
      p.acted = false;
    }
    this.currentBet = 0;
    this.lastRaiseSize = this.bigBlind;

    // Pre-flop: restore blinds' contributions as the current bet.
    // SB counts as acted (posts before acting), but BB keeps the option:
    // when action returns to BB unraised, BB may check or raise (BB option).
    // Marking BB acted here caused bets-even -> immediate flop, no BB raise.
    if (this.phase === 'PRE_FLOP') {
      const sbIdx = this.nextPlayable(this.dealerIdx);
      const bbIdx = this.nextPlayable(sbIdx);
      if (sbIdx >= 0) { this.players[sbIdx].roundBet = prevRound[sbIdx]; this.players[sbIdx].acted = true; }
      if (bbIdx >= 0) {
        this.players[bbIdx].roundBet = prevRound[bbIdx];
        this.players[bbIdx].acted = false; // 大盲保留翻牌前加注权
        this.currentBet = Math.max(this.currentBet, prevRound[bbIdx]);
      }
      this.lastRaiseSize = this.bigBlind;
    }

    this.emit('betting_started', { phase: this.phase });

    const first = startIdx !== undefined ? startIdx : this.nextPlayable(this.dealerIdx);
    this.whoseTurn = first;
    this.requestAction(first);
  }

  requestAction(idx) {
    const p = this.players[idx];
    if (!p || p.folded || p.isAllIn) { this.advanceTurn(); return; }
    this.whoseTurn = idx;
    const toCall = Math.max(0, this.currentBet - p.roundBet);
    const options = [];
    if (toCall === 0) options.push('check');
    else { options.push('fold'); options.push('call'); }
    options.push('raise');
    options.push('allin');
    // minRaiseTo = minimum TOTAL bet the player may raise to
    const minRaiseTo = this.currentBet + this.lastRaiseSize;
    this.emit('action_request', { playerId: p.id, options, toCall, minRaiseTo, pot: this.pot });
    this.emit('turn_changed', { playerId: p.id });
  }

  // ─── Player actions ──────────────────────────────────────────────────
  performAction(playerId, action, amount) {
    const idx = this.players.findIndex(x => x.id === playerId);
    if (idx < 0) return { ok: false, error: 'player not found' };
    const p = this.players[idx];
    if (p.folded || p.isAllIn) return { ok: false, error: 'not your action' };
    if (this.whoseTurn !== idx) return { ok: false, error: 'not your turn' };

    const toCall = Math.max(0, this.currentBet - p.roundBet);

    switch (action) {
      case 'fold':
        p.folded = true;
        p.acted = true;
        p.lastAction = 'fold';
        this.emit('action_announce', { playerId, action, amount: 0 });
        break;

      case 'check':
        if (toCall > 0) return { ok: false, error: 'cannot check, must call or fold' };
        p.acted = true;
        p.lastAction = 'check';
        this.emit('action_announce', { playerId, action, amount: 0 });
        break;

      case 'call': {
        const amt = toCall;
        p.stack -= amt;
        p.roundBet += amt;
        p.totalBet += amt;
        p.acted = true;
        p.lastAction = 'call';
        this.emit('action_announce', { playerId, action, amount: amt });
        break;
      }

      case 'raise': {
        // amount = total bet to raise TO (target chip total for this street)
        const minTo = this.currentBet + this.lastRaiseSize;
        let target;
        if (amount !== undefined && Number.isFinite(amount) && amount >= 0) {
          target = amount;
        } else {
          target = minTo;
        }
        // floor: must at least match min-raise
        if (target < minTo) target = minTo;
        const add = target - p.roundBet;
        if (add <= 0) return { ok: false, error: 'raise too small' };
        p.stack -= add;
        p.roundBet = target;
        p.totalBet += add;
        p.acted = true; // 加注者已完成行动
        // Only a full raise reopens betting
        if (target > this.currentBet) {
          const prevBet = this.currentBet;
          this.currentBet = target;
          this.lastRaiseSize = target - prevBet;
          for (const q of this.players) {
            if (q !== p && !q.folded) q.acted = false;
          }
        }
        p.lastAction = 'raise';
        this.emit('action_announce', { playerId, action: 'raise', amount: add, to: target });
        break;
      }

      case 'allin': {
        // With unlimited debt, "all-in" means push everything you still owe
        // relative to the current bet: match a large raise. This keeps the
        // button harmless rather than a weird half-cap.
        const target = Math.max(toCall + this.lastRaiseSize, this.currentBet + this.lastRaiseSize);
        const add = target - p.roundBet;
        if (add <= 0) return { ok: false, error: 'raise too small' };
        p.stack -= add;
        p.roundBet = target;
        p.totalBet += add;
        p.acted = true; // 全下者也已完成行动
        if (target > this.currentBet) {
          const prevBet = this.currentBet;
          this.currentBet = target;
          this.lastRaiseSize = target - prevBet;
          for (const q of this.players) {
            if (q !== p && !q.folded) q.acted = false;
          }
        }
        p.lastAction = 'allin';
        this.emit('action_announce', { playerId, action: 'allin', amount: add, to: target });
        break;
      }

      default:
        return { ok: false, error: 'unknown action' };
    }

    this.pot = this.players.reduce((s, q) => s + q.totalBet, 0);
    this.emit('pot_update', { mainPot: this.pot });
    this.emit('state_changed', this.serializeState());
    this.advanceTurn();
    return { ok: true };
  }

  // ─── Turn advance ────────────────────────────────────────────────────
  advanceTurn() {
    if (this.phase === 'IDLE' || this.phase === 'SHOWDOWN') return;

    const alive = this.active();
    if (alive.length <= 1) {
      // hand over: last player standing wins
      const winner = alive[0];
      const total = this.players.reduce((s, p) => s + p.totalBet, 0);
      winner.stack += total;
      this.pot = 0;
      this.emit('pot_update', { mainPot: 0 });
      this.emit('hand_ended', { winners: [{ id: winner.id, name: winner.name, amount: total }], reason: 'everyone_folded' });
      this.phase = 'IDLE';
      return;
    }

    const live = this.inHand();
    const allActed = live.every(p => p.acted);
    const betsEven = live.every(p => p.roundBet === this.currentBet);

    if (live.length === 0 || (allActed && betsEven)) {
      // betting round complete
      this.pot = this.players.reduce((s, p) => s + p.totalBet, 0);
      this.emit('pot_update', { mainPot: this.pot });

      const nextPhase = this.nextPhase();
      if (nextPhase === 'SHOWDOWN') {
        this.phase = 'SHOWDOWN';
        this.dealRemaining();
        this.doShowdown();
        return;
      }
      this.phase = nextPhase;
      if (nextPhase === 'FLOP') this.community.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
      else this.community.push(this.deck.pop());
      this.emit('community_cards', { cards: this.community.map(G.cardToString), phase: nextPhase });
      const startIdx = this.nextPlayable(this.dealerIdx);
      this.startBettingRound(startIdx);
      return;
    }

    // move to next playable player
    const next = this.nextPlayable(this.whoseTurn);
    if (next < 0) {
      this.phase = 'SHOWDOWN';
      this.dealRemaining();
      this.doShowdown();
      return;
    }
    this.requestAction(next);
  }

  nextPhase() {
    if (this.phase === 'PRE_FLOP') return 'FLOP';
    if (this.phase === 'FLOP') return 'TURN';
    if (this.phase === 'TURN') return 'RIVER';
    return 'SHOWDOWN';
  }

  dealRemaining() {
    const need = 5 - this.community.length;
    for (let i = 0; i < need; i++) this.community.push(this.deck.pop());
    this.emit('community_cards', { cards: this.community.map(G.cardToString), phase: 'SHOWDOWN' });
  }

  doShowdown() {
    this.emit('showdown_start', { community: this.community.map(G.cardToString) });
    const results = G.awardPots(this.players, this.community);
    const serialized = results.map(pot => ({
      amount: pot.amount,
      winners: pot.winners.map(w => ({ id: w.id, name: w.name, handType: w.handType, cards: w.cards })),
    }));
    this.emit('showdown', { pots: serialized });
    // unified hand-end signal
    const winners = serialized.flatMap(p => p.winners.map(w => ({ ...w, amount: p.amount })));
    this.emit('hand_ended', { winners, reason: 'showdown' });
    this.pot = 0;
    this.phase = 'IDLE';
  }

  serializeState() {
    return {
      phase: this.phase,
      community: this.community.map(G.cardToString),
      pot: this.pot,
      currentBet: this.currentBet,
      lastRaiseSize: this.lastRaiseSize,
      dealerIdx: this.dealerIdx,
      whoseTurn: this.whoseTurn,
      players: this.players.map(p => ({
        id: p.id, name: p.name, isAI: p.isAI,
        stack: p.stack, folded: p.folded, isAllIn: p.isAllIn,
        roundBet: p.roundBet, totalBet: p.totalBet,
        lastAction: p.lastAction, acted: p.acted, seat: p.seat,
      })),
    };
  }
}

module.exports = { TexasGame, createPlayer };
