# CLAUDE.md — Claude Code 项目交接文档

本文件供 Claude Code（或其他 AI 助手）接手本项目时阅读。**请先读本文档再修改任何代码。**

## 项目目标

做一个多人线下同玩的 No-Limit 德州扑克 PWA：房主在电脑/手机上开房，朋友通过任意网络（局域网或公网隧道）加入同一房间，玩标准德州扑克。空位可手动添加 AI。

## 当前技术架构

- **无前端框架**：纯 HTML/CSS/JS（移动端优先）
- **Node.js + `ws`**：HTTP 静态服务 + WebSocket
- **服务端权威**：所有游戏状态在服务端计算，客户端只发送操作指令（防作弊）
- **唯一运行时依赖**：`ws`（其余用 Node 内置模块）
- **测试**：Node 内置 `node:test`，测试文件在 `test/game.test.js`

## 主要文件职责

| 文件 | 职责 |
|------|------|
| `server/server.js` | HTTP 静态服务、WebSocket 服务器、房间管理（Room）、AI 行动调度 |
| `server/dealer.js` | 游戏流程状态机 `TexasGame`：发牌、下注轮次、动作处理、摊牌、结算 |
| `server/game.js` | 扑克牌引擎：牌组/洗牌、手牌评估（9 同花顺→1 高牌）、最佳 5 张、底池/边池计算、胜负比较 |
| `server/ai.js` | AI 对手：Monte Carlo 胜率模拟 + 启发式决策 |
| `public/index.html` | 应用壳：大厅、牌桌、摊牌弹窗 |
| `public/app.js` | 前端主逻辑：WebSocket 连接、消息处理、牌桌渲染、操作栏 |
| `public/style.css` | 移动端优先样式 |
| `public/sw.js` | Service Worker：缓存应用壳、离线加载 |
| `public/manifest.json` | PWA 清单 |
| `test/game.test.js` | 游戏逻辑单元测试（27 项） |
| `start-online.bat` | Windows 一键启动：服务器 + Cloudflare 公网隧道 |

## 游戏状态流转

```
LOBBY → startHand() → PRE_FLOP → (下注完成) → FLOP → TURN → RIVER
      → SHOWDOWN（摊牌结算）→ IDLE（等待继续）→ 下一手 startHand()
```

状态机核心在 `dealer.js`：

- `startHand()`：重置状态 → 选庄家 → 发 2 张底牌 → 放盲注 → 进入 PRE_FLOP → 开启下注轮
- `startBettingRound(startIdx)`：重置 roundBet/acted，PRE_FLOP 时恢复盲注贡献，请求第一个玩家行动
- `requestAction(idx)`：计算该玩家的可行动作（check/fold/call/raise/allin）并发送 `action_request`
- `performAction(playerId, action, amount)`：处理玩家动作，更新筹码/下注，广播 `action_announce`
- `advanceTurn()`：检查轮次完成条件 → 推进下一 street 或摊牌；若只剩一家未弃牌则立即结束
- `doShowdown()`：发完公共牌、评估手牌、分配底池、广播 `showdown` + `hand_ended`

**每轮下注结束条件**（`advanceTurn`）：
`所有未弃牌且未全下玩家 (live) 均已完成行动 (acted) 且下注额一致 (roundBet === currentBet)`。

## 核心德州扑克规则在哪里实现

- **牌型评估**：`game.js` 的 `evaluate()`（返回 `{type, score, typeName}`），`bestHand()` 7 选 5
- **牌型比较**：`game.js` 的 `compareEvals()`（字典序比较 type + score）
- **底池/边池**：`game.js` 的 `computeSidePots()`（按 totalBet 分层）与 `awardPots()`
- **下注动作合法性**：`dealer.js` 的 `performAction()` 各分支
- **加注最小额**：`lastRaiseSize`（最近一次完整加注增量），`minRaiseTo = currentBet + lastRaiseSize`
- **盲注/庄家**：`dealer.js` 的 `startHand()`，庄家按钮 `dealerIdx` 顺时针轮转

## 高风险区域（修改前必须检查）

1. **`dealer.js` 的 `advanceTurn()`** — 轮次完成判断最容易出死锁/跳牌 bug。任何修改必须保证：
   - 不会无限 `action_request` 循环
   - 不会跳过下注轮直接翻牌
   - 不会在多 AI 场景下因计时器竞争卡死
2. **`performAction` 各分支必须设置 `p.acted = true`** — 漏设会导致轮次永不完成
3. **`startBettingRound` 的 PRE_FLOP 盲注恢复** — 用 `prevRound` 恢复 SB/BB 的 roundBet，逻辑脆弱
4. **`computeSidePots` / `awardPots`** — 边池金额与资格判定错误会导致筹码凭空产生/消失
5. **`server.js` 的 AI 调度 `scheduleAIAction`** — 每个 AI 必须独立计时器（`aiTimers` Map），共享计时器会互相取消导致多 AI 死锁
6. **`server.js` 的 `startGame`** — 允许在 hand 之间重新发牌（`phase !== 'IDLE'` 才返回）

## 修改游戏逻辑时必须检查的内容

- [ ] 每轮下注是否保证能结束（不会死锁）
- [ ] 下注额与 currentBet 是否始终一致（无负筹码异常）
- [ ] 边池分配后总筹码是否守恒
- [ ] 平局分池（奇数余数处理）
- [ ] 玩家断线/弃牌后轮次是否推进
- [ ] 庄家按钮是否正常轮转
- [ ] 多 AI 并行时是否卡死
- [ ] 跑 `npm test` 确认 27 项测试全过
- [ ] 跑 `npm run check` 确认所有 JS 语法有效

## 常用运行和测试命令

```bash
npm install          # 安装依赖（仅 ws）
npm start            # 启动服务器（生产模式）
npm run dev          # 同上
npm test             # 运行全部测试
npm run test:game    # 仅游戏逻辑测试
npm run check        # 所有 JS 语法检查
```

启动后本地访问 `http://localhost:3000`；公网联机双击 `start-online.bat`。

## 代码风格和开发规范

- **服务端**：CommonJS（`require`/`module.exports`），文件顶部 `'use strict'`
- **前端**：无框架 vanilla JS，DOM 用 `$`/`$$` 简写，事件用 `onclick` 绑定
- **中文注释**：代码内注释用中文
- **卡片表示**：内部 `{r: 2..14, s: 0..3}`，字符串 `"Ah"`、`"Ts"`（rank+suit）
- **不加多余抽象**：直接改现有函数，不引入新框架/构建工具
- **改动后**：必须 `npm test` + `npm run check` + 实际启动验证

## 禁止随意删除或重写的内容

- **`game.js` 的 `evaluate`/`bestHand`/`computeSidePots`/`awardPots`** — 核心规则，重写前必须有完整测试覆盖
- **`dealer.js` 的下注轮次状态机** — 高风险，小幅修改而非重写
- **`server.js` 的房间/AI 调度逻辑** — 曾出现多 AI 死锁，重写需谨慎
- **PWA 配置**（manifest/sw.js）— 改动需验证安装和离线缓存仍正常
- **`start-online.bat`** — Windows 专用脚本，编码为 GBK（中文系统 cmd），不要改成 UTF-8
- **现有测试** — 保留并扩充，不删除

## 已知的设计决策（先了解再改）

- **无限记账**：玩家筹码输光后不淘汰，继续参与显示负数（欠款），赢牌还债。这是用户明确要求的设计，改动前需确认。
- **不自动补 AI**：房主手动点「添加 AI」才加，2 人真人即可开局。
- **`allin` 动作语义**：无限记账下"全下"已无真实意义，当前实现为按 min-raise 推高下注，保留按钮以兼容旧客户端。
- **翻牌前大盲注加注权（BB option）**：已修复（2026-08-03）。大盲不再被标记为已行动，翻牌前保留补行动权。注意 `performAction` 的 `raise`/`allin` 分支**必须设置 `p.acted = true`**，否则加注后轮次不收敛（这是上次修复的关键）。
