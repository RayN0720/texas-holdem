'use strict';

// ─── Card representation ────────────────────────────────────────────────
// Card string: rank + suit, e.g. "Ah", "Ts", "9c", "Kd"
// rank: A, K, Q, J, T, 9, 8, 7, 6, 5, 4, 3, 2
// suit: h (hearts), d (diamonds), c (clubs), s (spades)
// Internal: { r: 2..14 (14=Ace), s: 0..3 }

const RANK_TO_VAL = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, 'T': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14 };
const VAL_TO_RANK = {};
for (const [k, v] of Object.entries(RANK_TO_VAL)) VAL_TO_RANK[v] = k;
const SUITS = ['s', 'h', 'd', 'c'];

const TYPE_NAMES = {
  9: '同花顺', 8: '四条', 7: '葫芦', 6: '同花', 5: '顺子',
  4: '三条', 3: '两对', 2: '一对', 1: '高牌',
};

function parseCard(str) {
  if (str.length !== 2) throw new Error(`Invalid card: ${str}`);
  const r = RANK_TO_VAL[str[0]];
  const s = SUITS.indexOf(str[1]);
  if (!r || s < 0) throw new Error(`Invalid card: ${str}`);
  return { r, s };
}

function cardToString(c) {
  return VAL_TO_RANK[c.r] + SUITS[c.s];
}

function cardToUnicode(c) {
  const suitSym = ['♠', '♥', '♦', '♣'];
  const rank = VAL_TO_RANK[c.r];
  return { rank, suit: suitSym[c.s] };
}

// ─── Deck ───────────────────────────────────────────────────────────────

function createDeck() {
  const deck = [];
  for (let r = 2; r <= 14; r++) {
    for (let s = 0; s < 4; s++) deck.push({ r, s });
  }
  return deck;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─── Hand evaluation ────────────────────────────────────────────────────
// evaluate(cards) where cards is array of {r,s} (5-7 cards).
// Returns { type, score[], typeName } where score is a lexicographically
// comparable array. Higher score wins. type: 9=SF ... 1=HighCard.

function evaluate(cards) {
  const n = cards.length;
  if (n < 5) throw new Error('Need at least 5 cards');

  const rankCount = new Array(15).fill(0);
  const suitCards = [[], [], [], []]; // cards grouped by suit
  for (const c of cards) {
    rankCount[c.r]++;
    suitCards[c.s].push(c.r);
  }

  // Flush detection
  let flushSuit = -1;
  for (let s = 0; s < 4; s++) {
    if (suitCards[s].length >= 5) { flushSuit = s; break; }
  }

  // Straight detection (including wheel)
  let straightHigh = 0;
  {
    let run = 0;
    for (let r = 14; r >= 2; r--) {
      run = rankCount[r] > 0 ? run + 1 : 0;
      if (run >= 5) { straightHigh = r + 4; break; }
    }
    if (straightHigh === 0 && rankCount[14] && rankCount[2] && rankCount[3] && rankCount[4] && rankCount[5]) {
      straightHigh = 5; // wheel: A-2-3-4-5
    }
  }

  // Straight flush check
  if (flushSuit >= 0 && straightHigh > 0) {
    const rs = suitCards[flushSuit].slice().sort((a, b) => b - a);
    let run = 0;
    let sfHigh = 0;
    for (let i = 0; i < rs.length; i++) {
      if (i > 0 && rs[i] === rs[i - 1] - 1) run++;
      else run = 1;
      if (run >= 5) { sfHigh = rs[i] + 4; break; }
    }
    if (sfHigh === 0) {
      // wheel straight flush
      if (rs.includes(14) && rs.includes(2) && rs.includes(3) && rs.includes(4) && rs.includes(5)) sfHigh = 5;
    }
    if (sfHigh > 0) {
      return { type: 9, score: [sfHigh], typeName: TYPE_NAMES[9] };
    }
  }

  // Group ranks by frequency
  const quads = [], trips = [], pairs = [], singles = [];
  for (let r = 14; r >= 2; r--) {
    if (rankCount[r] === 4) quads.push(r);
    else if (rankCount[r] === 3) trips.push(r);
    else if (rankCount[r] === 2) pairs.push(r);
    else if (rankCount[r] === 1) singles.push(r);
  }

  // Flush (non-straight)
  if (flushSuit >= 0) {
    const rs = suitCards[flushSuit].slice().sort((a, b) => b - a);
    const score = [rs[0], rs[1], rs[2], rs[3], rs[4]];
    return { type: 6, score, typeName: TYPE_NAMES[6] };
  }

  // Straight (non-flush)
  if (straightHigh > 0) {
    return { type: 5, score: [straightHigh], typeName: TYPE_NAMES[5] };
  }

  // Four of a kind
  if (quads.length > 0) {
    const kicker = singles[0] !== undefined ? singles[0] : (trips[0] !== undefined ? trips[0] : pairs[0]);
    return { type: 8, score: [quads[0], kicker], typeName: TYPE_NAMES[8] };
  }

  // Full house
  if (trips.length >= 2) {
    return { type: 7, score: [trips[0], trips[1]], typeName: TYPE_NAMES[7] };
  }
  if (trips.length === 1 && pairs.length >= 1) {
    return { type: 7, score: [trips[0], pairs[0]], typeName: TYPE_NAMES[7] };
  }

  // Three of a kind
  if (trips.length === 1) {
    const k = [singles[0], singles[1]];
    return { type: 4, score: [trips[0], ...k], typeName: TYPE_NAMES[4] };
  }

  // Two pair
  if (pairs.length >= 2) {
    const low = pairs[1];
    const kicker = singles[0] !== undefined ? singles[0] : (pairs[2] !== undefined ? pairs[2] : -1);
    return { type: 3, score: [pairs[0], low, kicker], typeName: TYPE_NAMES[3] };
  }

  // One pair
  if (pairs.length === 1) {
    const k = [singles[0], singles[1], singles[2]].filter(x => x !== undefined);
    return { type: 2, score: [pairs[0], ...k], typeName: TYPE_NAMES[2] };
  }

  // High card
  const top5 = singles.slice(0, 5);
  return { type: 1, score: top5, typeName: TYPE_NAMES[1] };
}

function compareEvals(a, b) {
  if (a.type !== b.type) return a.type - b.type;
  const n = Math.max(a.score.length, b.score.length);
  for (let i = 0; i < n; i++) {
    const x = a.score[i] || 0;
    const y = b.score[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

// best 5 cards from 7 (or fewer) via exhaustive 5-combinations
function bestHand(cards) {
  if (cards.length === 5) return { cards: cards.slice(), eval: evaluate(cards) };
  let best = null;
  const idxs = [];
  function comb(start, k) {
    if (k === 0) {
      const five = idxs.map(i => cards[i]);
      const ev = evaluate(five);
      if (!best || compareEvals(ev, best.eval) > 0) best = { cards: five, eval: ev };
      return;
    }
    for (let i = start; i <= cards.length - k; i++) {
      idxs.push(i);
      comb(i + 1, k - 1);
      idxs.pop();
    }
  }
  comb(0, 5);
  return best;
}

// ─── Winners & side pots ────────────────────────────────────────────────
// Each player: { id, name, hole: [card], stack, roundBet, isAllIn, folded }
// community: array of cards
// Returns array of pots: { amount, eligibleIds, winners: [{id, handType, cards}] }
function computeSidePots(players) {
  // Collect distinct bet amounts among players who contributed this hand
  const bets = players
    .filter(p => !p.folded)
    .map(p => p.totalBet)  // totalBet = lifetime this hand
    .sort((a, b) => a - b);
  const pots = [];
  let prev = 0;
  for (const level of bets) {
    if (level <= prev) continue;
    // amount contributed by everyone above this level
    const contributors = players.filter(p => p.totalBet >= level);
    if (contributors.length < 2) continue; // everyone else folded -> no side pot needed
    const amount = contributors.reduce((sum, p) => sum + Math.min(p.totalBet, level) - prev, 0);
    pots.push({ amount, eligibleIds: new Set(contributors.map(p => p.id)) });
    prev = level;
  }
  // Main pot covers from 0
  if (pots.length === 0) {
    const amount = players.reduce((sum, p) => sum + p.totalBet, 0);
    pots.push({ amount, eligibleIds: new Set(players.map(p => p.id)) });
  }
  return pots;
}

function awardPots(players, community) {
  // Evaluate each non-folded player's best hand
  for (const p of players) {
    if (!p.folded) {
      const bh = bestHand([...p.hole, ...community]);
      p.bestHand = bh;
    }
  }
  const pots = computeSidePots(players);
  const results = [];
  for (const pot of pots) {
    const eligible = players.filter(p => !p.folded && pot.eligibleIds.has(p.id));
    // rank them
    eligible.sort((a, b) => compareEvals(b.bestHand.eval, a.bestHand.eval));
    const winners = [eligible[0]];
    for (let i = 1; i < eligible.length; i++) {
      if (compareEvals(eligible[i].bestHand.eval, eligible[0].bestHand.eval) === 0) winners.push(eligible[i]);
    }
    const share = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - share * winners.length;
    for (const w of winners) {
      w.stack += share;
      if (remainder > 0) { w.stack += 1; remainder--; }
    }
    results.push({
      amount: pot.amount,
      winners: winners.map(w => ({
        id: w.id, name: w.name, handType: w.bestHand.eval.typeName,
        handScore: w.bestHand.eval.score.slice(), cards: w.bestHand.cards.map(cardToString),
      })),
    });
  }
  return results;
}

module.exports = {
  RANK_TO_VAL, VAL_TO_RANK, SUITS,
  parseCard, cardToString, cardToUnicode,
  createDeck, shuffle,
  evaluate, compareEvals, bestHand,
  computeSidePots, awardPots,
  TYPE_NAMES,
};
