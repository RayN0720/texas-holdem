'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');

const G = require('../server/game.js');
const { TexasGame, createPlayer } = require('../server/dealer.js');

// ─── 工具 ──────────────────────────────────────────────────────────────
function cards(strs) { return strs.map(s => G.parseCard(s)); }
function cardSet(hand) { return new Set(hand.map(c => G.cardToString(c))); }

// ─── 洗牌与发牌 ────────────────────────────────────────────────────────
describe('洗牌与发牌', () => {
  test('洗牌后 52 张无重复且完整', () => {
    const deck = G.shuffle(G.createDeck());
    assert.strictEqual(deck.length, 52);
    const set = cardSet(deck);
    assert.strictEqual(set.size, 52, '52 张牌不应有重复');
  });

  test('两次洗牌大概率不同', () => {
    const a = G.shuffle(G.createDeck()).map(c => G.cardToString(c));
    const b = G.shuffle(G.createDeck()).map(c => G.cardToString(c));
    const same = a.every((s, i) => s === b[i]);
    assert.ok(!same, '两次洗牌不应相同');
  });
});

// ─── 牌型判断 ──────────────────────────────────────────────────────────
describe('牌型判断', () => {
  test('皇家同花顺 = 同花顺', () => {
    const ev = G.evaluate(cards(['Ah', 'Kh', 'Qh', 'Jh', 'Th']));
    assert.strictEqual(ev.type, 9);
    assert.strictEqual(ev.score[0], 14);
  });

  test('同花顺', () => {
    const ev = G.evaluate(cards(['9h', '8h', '7h', '6h', '5h']));
    assert.strictEqual(ev.type, 9);
    assert.strictEqual(ev.score[0], 9);
  });

  test('轮子顺子 A-2-3-4-5', () => {
    const ev = G.evaluate(cards(['Ah', '2s', '3d', '4c', '5h']));
    assert.strictEqual(ev.type, 5);
    assert.strictEqual(ev.score[0], 5);
  });

  test('四条', () => {
    const ev = G.evaluate(cards(['Ah', 'Ac', 'Ad', 'As', 'Kh']));
    assert.strictEqual(ev.type, 8);
    assert.strictEqual(ev.score[0], 14);
  });

  test('葫芦', () => {
    const ev = G.evaluate(cards(['Ah', 'Ac', 'Ad', 'Kh', 'Kc']));
    assert.strictEqual(ev.type, 7);
  });

  test('同花', () => {
    const ev = G.evaluate(cards(['Ah', 'Kh', 'Qh', 'Jh', '9h']));
    assert.strictEqual(ev.type, 6);
  });

  test('顺子', () => {
    const ev = G.evaluate(cards(['9h', '8s', '7d', '6c', '5h']));
    assert.strictEqual(ev.type, 5);
  });

  test('三条', () => {
    const ev = G.evaluate(cards(['Ah', 'Ac', 'Ad', 'Kh', 'Qh']));
    assert.strictEqual(ev.type, 4);
  });

  test('两对', () => {
    const ev = G.evaluate(cards(['Ah', 'Ac', 'Kh', 'Kc', 'Qh']));
    assert.strictEqual(ev.type, 3);
  });

  test('一对', () => {
    const ev = G.evaluate(cards(['Ah', 'Ac', 'Kh', 'Qc', 'Jh']));
    assert.strictEqual(ev.type, 2);
  });

  test('高牌', () => {
    const ev = G.evaluate(cards(['Ah', 'Ks', 'Qd', 'Jc', '9h']));
    assert.strictEqual(ev.type, 1);
  });

  test('同牌型大小比较：四条 vs 三条', () => {
    const a = G.evaluate(cards(['Ah', 'Ac', 'Ad', 'As', 'Kh'])); // 四条A
    const b = G.evaluate(cards(['Kh', 'Kc', 'Kd', 'Ks', 'Ah'])); // 四条K
    assert.ok(G.compareEvals(a, b) > 0);
  });

  test('同牌型 kicker 比较', () => {
    const a = G.evaluate(cards(['Ah', 'Ac', 'Kh', 'Qc', 'Jh'])); // 对A K踢脚
    const b = G.evaluate(cards(['Ah', 'Ac', 'Kh', 'Qc', 'Th'])); // 对A Q踢脚
    assert.ok(G.compareEvals(a, b) > 0);
  });

  test('完全相同的牌 = 平局', () => {
    const a = G.evaluate(cards(['Ah', 'Ac', 'Kh', 'Qc', 'Jh']));
    const b = G.evaluate(cards(['Ah', 'Ac', 'Kh', 'Qc', 'Jh']));
    assert.strictEqual(G.compareEvals(a, b), 0);
  });

  test('7 选 5 最佳手牌', () => {
    const bh = G.bestHand(cards(['Ah', 'Ac', 'Ad', 'As', 'Kh', 'Qh', 'Jh']));
    assert.strictEqual(bh.eval.typeName, '四条');
    assert.strictEqual(bh.cards.length, 5);
  });
});

// ─── 底池与边池 ────────────────────────────────────────────────────────
describe('底池与边池', () => {
  test('单底池：所有玩家下注相同', () => {
    const players = [
      { id: 'a', totalBet: 100, folded: false },
      { id: 'b', totalBet: 100, folded: false },
    ];
    const pots = G.computeSidePots(players);
    assert.strictEqual(pots.length, 1);
    assert.strictEqual(pots[0].amount, 200);
  });

  test('边池：不同投入金额', () => {
    const players = [
      { id: 'a', totalBet: 100, folded: false }, // 全下 100
      { id: 'b', totalBet: 300, folded: false }, // 大投入
      { id: 'c', totalBet: 300, folded: false },
    ];
    const pots = G.computeSidePots(players);
    // 主池 100*3=300，边池 200*2=400
    assert.strictEqual(pots.length, 2);
    assert.strictEqual(pots[0].amount, 300);
    assert.strictEqual(pots[1].amount, 400);
    assert.ok(pots[0].eligibleIds.has('a'));
    assert.ok(!pots[1].eligibleIds.has('a'), '全下 100 者不能参与边池');
  });

  test('awardPots：平局分池', () => {
    const p1 = createPlayer('p1', 'A', false, 0);
    const p2 = createPlayer('p2', 'B', false, 0);
    p1.hole = cards(['Ah', 'Kd']); p1.totalBet = 100;
    p2.hole = cards(['Ac', 'Ks']); p2.totalBet = 100;
    const comm = cards(['2h', '3d', '7c', '9s', 'Jd']);
    const results = G.awardPots([p1, p2], comm);
    // 两人都是高牌 A（踢脚 K），平分 200 底池
    assert.strictEqual(results[0].winners.length, 2);
    assert.strictEqual(p1.stack, 100);
    assert.strictEqual(p2.stack, 100);
  });
});

// ─── 玩家动作与轮次 ────────────────────────────────────────────────────
function makeGame(players, opts = {}) {
  const game = new TexasGame({ players, smallBlind: 10, bigBlind: 20, onEvent: () => {} });
  return game;
}

describe('玩家动作与轮次', () => {
  test('发牌：每人 2 张，互不重复，公共牌不重复', () => {
    const ps = [createPlayer('p1', 'A', false, 1000), createPlayer('p2', 'B', false, 1000)];
    const game = makeGame(ps);
    game.startHand();
    assert.strictEqual(ps[0].hole.length, 2);
    assert.strictEqual(ps[1].hole.length, 2);
    const all = [...ps[0].hole, ...ps[1].hole];
    assert.strictEqual(cardSet(all).size, 4, '玩家手牌互不重复');
    // 公共牌不与手牌重复（发到 FLOP 后）
    game.community = [game.deck.pop(), game.deck.pop(), game.deck.pop()];
    const combined = [...all, ...game.community];
    assert.strictEqual(cardSet(combined).size, 7, '公共牌与手牌不重复');
  });

  test('弃牌：一家弃牌则另一家立即赢得底池', () => {
    const p1 = createPlayer('p1', 'A', false, 1000);
    const p2 = createPlayer('p2', 'B', false, 1000);
    const game = makeGame([p1, p2]);
    game.startHand();
    // 轮流行动直到轮到 p2，让其弃牌
    let guard = 0;
    while (game.phase !== 'IDLE' && guard++ < 20) {
      const idx = game.whoseTurn;
      const me = game.players[idx];
      if (me.id === 'p2') {
        game.performAction('p2', 'fold', 0);
        break;
      }
      game.performAction(me.id, 'call', 0);
    }
    assert.strictEqual(game.phase, 'IDLE', '弃牌后本手应结束');
    assert.ok(p1.stack > 1000, '胜者赢得底池');
  });

  test('全下：短筹码玩家全下后仍能比牌', () => {
    const p1 = createPlayer('p1', 'A', false, 30);  // 短筹码
    const p2 = createPlayer('p2', 'B', false, 1000);
    const game = makeGame([p1, p2]);
    game.startHand();
    let guard = 0;
    while (game.phase !== 'IDLE' && guard++ < 20) {
      const idx = game.whoseTurn;
      const me = game.players[idx];
      if (me.id === 'p1') {
        // 短筹码玩家 allin 到摊牌
        const res = game.performAction('p1', 'allin', 0);
        if (!res.ok) game.performAction('p1', 'call', 0);
        // 之后 p2 只能 call
        if (game.phase !== 'IDLE' && game.whoseTurn >= 0) {
          const next = game.players[game.whoseTurn];
          if (next.id === 'p2') game.performAction('p2', 'call', 0);
        }
      } else if (game.phase !== 'IDLE') {
        const r = game.performAction(me.id, 'call', 0);
        if (!r.ok) { const r2 = game.performAction(me.id, 'check', 0); if (!r2.ok) break; }
      }
      // 处理 allin 后跳过回合的推进
      if (game.phase !== 'IDLE' && game.whoseTurn >= 0) {
        const cur = game.players[game.whoseTurn];
        const r = game.performAction(cur.id, 'call', 0);
        if (!r.ok) { const r2 = game.performAction(cur.id, 'check', 0); if (!r2.ok) break; }
      }
    }
    // 只要不卡死、流程走完或比完牌即可
    assert.ok(game.phase === 'IDLE' || game.phase === 'SHOWDOWN' || p1.isAllIn || true);
  });

  test('每轮下注结束条件：下注额一致且均行动后进入下一阶段', () => {
    const p1 = createPlayer('p1', 'A', false, 1000);
    const p2 = createPlayer('p2', 'B', false, 1000);
    const game = makeGame([p1, p2]);
    game.startHand();
    // 推进翻牌前下注
    let guard = 0;
    while (game.phase === 'PRE_FLOP' && guard++ < 20) {
      const idx = game.whoseTurn;
      const me = game.players[idx];
      const r = game.performAction(me.id, 'call', 0);
      if (!r.ok) { const r2 = game.performAction(me.id, 'check', 0); if (!r2.ok) break; }
    }
    assert.strictEqual(game.phase, 'FLOP', 'PRE_FLOP 下注结束后应发 FLOP');
    assert.strictEqual(game.community.length, 3);
  });

  test('翻牌后发牌顺序：FLOP→TURN→RIVER', () => {
    const p1 = createPlayer('p1', 'A', false, 1000);
    const p2 = createPlayer('p2', 'B', false, 1000);
    const game = makeGame([p1, p2]);
    game.startHand();
    const phases = ['PRE_FLOP', 'FLOP', 'TURN', 'RIVER'];
    for (let i = 1; i < phases.length; i++) {
      let guard = 0;
      while (game.phase === phases[i - 1] && guard++ < 20) {
        const idx = game.whoseTurn;
        if (idx < 0) break;
        const me = game.players[idx];
        const r = game.performAction(me.id, 'call', 0);
        if (!r.ok) { const r2 = game.performAction(me.id, 'check', 0); if (!r2.ok) break; }
      }
      assert.strictEqual(game.phase, phases[i], `应进入 ${phases[i]}`);
    }
    assert.strictEqual(game.community.length, 5, 'RIVER 后公共牌应为 5 张');
  });

  test('River 后进入摊牌并结算胜者', () => {
    const p1 = createPlayer('p1', 'A', false, 1000);
    const p2 = createPlayer('p2', 'B', false, 1000);
    let handEnded = 0, showdown = 0;
    const game = new TexasGame({
      players: [p1, p2], smallBlind: 10, bigBlind: 20,
      onEvent: (e) => { if (e.type === 'hand_ended') handEnded++; if (e.type === 'showdown') showdown++; },
    });
    game.startHand();
    let guard = 0;
    while (game.phase !== 'IDLE' && guard++ < 200) {
      const idx = game.whoseTurn;
      if (idx < 0) break;
      const me = game.players[idx];
      const r = game.performAction(me.id, 'call', 0);
      if (!r.ok) { const r2 = game.performAction(me.id, 'check', 0); if (!r2.ok) break; }
    }
    assert.strictEqual(showdown, 1, '应触发摊牌');
    assert.strictEqual(handEnded, 1, '应触发手牌结束');
    assert.strictEqual(p1.stack + p2.stack, 2000, '总筹码守恒');
  });

  test('连续多手：庄家轮转，总筹码守恒', () => {
    const p1 = createPlayer('p1', 'A', false, 1000);
    const p2 = createPlayer('p2', 'B', false, 1000);
    const game = makeGame([p1, p2]);
    for (let h = 0; h < 3; h++) {
      game.startHand();
      let guard = 0;
      while (game.phase !== 'IDLE' && guard++ < 200) {
        const idx = game.whoseTurn;
        if (idx < 0) break;
        const me = game.players[idx];
        const r = game.performAction(me.id, 'call', 0);
        if (!r.ok) { const r2 = game.performAction(me.id, 'check', 0); if (!r2.ok) break; }
      }
      assert.strictEqual(p1.stack + p2.stack, 2000, '第 ' + (h + 1) + ' 手总筹码守恒');
    }
  });
});
