'use strict';

const G = require('./game.js');
const { createDeck, shuffle, evaluate, compareEvals } = G;

// ─── Monte Carlo equity ─────────────────────────────────────────────────
// Estimate win probability of a player's hole cards given the current
// community cards and number of opponents. Runs `iterations` random deals.
function monteCarloEquity(holeCards, communityCards, numOpponents, iterations = 400) {
  // holeCards/communityCards as string arrays
  const used = new Set([...holeCards, ...communityCards]);
  const deck = createDeck()
    .filter(c => !used.has(G.cardToString(c)));

  const hole = holeCards.map(G.parseCard);
  const comm = communityCards.map(G.parseCard);
  const oppCards = [];
  for (let o = 0; o < numOpponents; o++) {
    // opponent hole cards drawn later in each iteration
  }

  let wins = 0, ties = 0;
  const myBest = G.bestHand([...hole, ...comm]);
  const alreadyKnown = comm.length === 5;

  if (alreadyKnown) {
    // exact: compare against all possible opponent hands is expensive;
    // approximate with Monte Carlo drawing opponent hands only
    for (let i = 0; i < Math.min(iterations * 4, 2000); i++) {
      const opps = [];
      const usedSet = new Set(used);
      const shuffled = shuffle(deck.slice());
      let idx = 0;
      let oppWin = false, oppTie = false;
      for (let o = 0; o < numOpponents; o++) {
        const c1 = shuffled[idx++], c2 = shuffled[idx++];
        if (!c1 || !c2) break;
        const opp = G.bestHand([c1, c2, ...comm]);
        const cmp = compareEvals(opp.eval, myBest.eval);
        if (cmp > 0) { oppWin = true; break; }
        if (cmp === 0) oppTie = true;
      }
      if (!oppWin && !oppTie) wins++;
      else if (!oppWin && oppTie) ties++;
    }
    const n = Math.min(iterations * 4, 2000);
    return { equity: wins / n, tie: ties / n, iterations: n };
  }

  // unknown community: draw remaining board + opponents
  const toDeal = 5 - comm.length;
  for (let i = 0; i < iterations; i++) {
    const shuffled = shuffle(deck.slice());
    let idx = 0;
    const board = comm.slice();
    for (let j = 0; j < toDeal; j++) board.push(shuffled[idx++]);
    const my = G.bestHand([...hole, ...board]);
    let oppWin = false, oppTie = false;
    for (let o = 0; o < numOpponents; o++) {
      const c1 = shuffled[idx++], c2 = shuffled[idx++];
      if (!c1 || !c2) break;
      const opp = G.bestHand([c1, c2, ...board]);
      const cmp = compareEvals(opp.eval, my.eval);
      if (cmp > 0) { oppWin = true; break; }
      if (cmp === 0) oppTie = true;
    }
    if (!oppWin && !oppTie) wins++;
    else if (!oppWin && oppTie) ties++;
  }
  return { equity: wins / iterations, tie: ties / iterations, iterations };
}

// ─── Heuristic decision ─────────────────────────────────────────────────
// Decide an action given equity, pot, and amounts to call/raise.
// Returns { action: 'fold'|'check'|'call'|'raise'|'allin', amount }
function decideAction({ equity, options, toCall, minRaiseTo, pot, stack, aggression = 0.5 }) {
  const opts = new Set(options);
  const canCheck = opts.has('check');
  const canRaise = opts.has('raise');
  const canAllIn = opts.has('allin');
  const canCall = opts.has('call');
  const canFold = opts.has('fold');

  // pot odds: need equity > potOdds to call profitably
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;

  // Small randomness to avoid predictability
  const jitter = 0.9 + Math.random() * 0.2; // 0.9..1.1

  // Strong hand -> raise
  if (equity > 0.65 && canRaise) {
    const raiseTo = Math.max(minRaiseTo, Math.round(pot * (0.5 + equity) * aggression * jitter));
    return { action: 'raise', amount: raiseTo };
  }
  // Decent hand -> call/check
  if (equity > potOdds * 1.1 && canCall) {
    // if check available and weak-ish, prefer check
    if (equity < 0.35 && canCheck) return { action: 'check', amount: 0 };
    return { action: 'call', amount: toCall };
  }
  // Bluff chance
  if (canRaise && Math.random() < 0.08 * aggression) {
    return { action: 'raise', amount: minRaiseTo };
  }
  // Weak hand: check if possible, else fold
  if (canCheck) return { action: 'check', amount: 0 };
  // Semi-bluff occasionally
  if (canRaise && Math.random() < 0.05) return { action: 'raise', amount: minRaiseTo };
  if (canFold) return { action: 'fold', amount: 0 };
  // Fallback
  if (canCall) return { action: 'call', amount: toCall };
  if (canCheck) return { action: 'check', amount: 0 };
  return { action: 'fold', amount: 0 };
}

// ─── Integration helper ─────────────────────────────────────────────────
// Given a player's perspective, produce an action the server can execute.
function computeAIAction({ holeCards, communityCards, opponents, options, toCall, minRaiseTo, pot, stack }) {
  const oppCount = opponents; // number of opponents still in the hand
  const { equity } = monteCarloEquity(holeCards, communityCards, oppCount, 400);
  return decideAction({
    equity, options, toCall, minRaiseTo, pot, stack,
  });
}

module.exports = { monteCarloEquity, decideAction, computeAIAction };
