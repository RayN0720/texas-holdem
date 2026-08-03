# 德州扑克 (Texas Hold'em) PWA

一个支持**多人联机**的 No-Limit 德州扑克 PWA。房主开房，朋友用**任意网络**（WiFi 或 4G/5G 流量）都能加入，一起玩完整规则的对局。空位可通过「添加 AI」手动补足。

## 项目简介

- **纯前端 PWA**：无框架，手机浏览器打开即可安装为 App
- **服务端权威**：游戏状态全部在 Node.js 服务端计算，客户端只发操作指令，防作弊
- **任意网络联机**：局域网直连（同 WiFi）或 Cloudflare 免费隧道（任意网络）两种模式
- **智能 AI 对手**：Monte Carlo 胜率模拟 + 底池赔率决策

## 当前功能

- 完整 No-Limit Hold'em 规则：翻牌前 → 翻牌 → 转牌 → 河牌 → 摊牌
- 标准动作：弃牌 / 过牌 / 跟注 / 下注 / 加注 / 全下
- 盲注、庄家按钮轮转、边池结算、平局分池
- **无限记账**：玩家筹码输光后可继续参与，筹码显示负数（欠款），赢牌后自动还债
- 房主手动添加 AI 补位，纯真人局无需 AI
- 2-9 人，2 人即可开局
- PWA：可安装到主屏幕、离线缓存应用壳

## 游戏规则

完整规则遵循国际标准 Texas Hold'em（详见 [CLAUDE.md](./CLAUDE.md) 中的核心规则说明）：

1. 每局确定庄家（Dealer），按钮顺时针移动；庄家左侧一位付小盲注，再左一位付大盲注
2. 每位玩家发 2 张仅自己可见的底牌（Hole Cards）
3. 依次发 5 张公共牌：Flop（3 张）→ Turn（1 张）→ River（1 张），每阶段后一轮下注
4. 每轮下注从庄家左侧开始，直到所有未弃牌玩家下注额一致且均完成行动
5. 若只剩一名玩家未弃牌，该玩家立即赢得底池；否则 River 后进入摊牌
6. 系统自动从 7 张牌中选出最佳 5 张并比较牌型，平局分池

**牌型由高到低**：皇家同花顺 → 同花顺 → 四条 → 葫芦 → 同花 → 顺子 → 三条 → 两对 → 一对 → 高牌

## 技术栈

- **后端**：Node.js（≥18）+ `ws`（WebSocket）
- **前端**：纯 HTML/CSS/JS（无框架），移动端优先
- **PWA**：Manifest + Service Worker，可安装、可离线加载壳
- **测试**：Node 内置 `node:test`

## 项目目录结构

```
texas-holdem/
├── server/
│   ├── server.js    # HTTP 静态服务 + WebSocket + 房间管理 + AI 调度
│   ├── dealer.js    # 游戏流程状态机（TexasGame）
│   ├── game.js      # 扑克牌引擎（发牌、牌型评估、底池/边池、比较）
│   └── ai.js        # AI 对手（Monte Carlo + 启发式决策）
├── public/
│   ├── index.html   # 应用壳（大厅 + 牌桌 + 摊牌弹窗）
│   ├── app.js       # 前端主逻辑（WebSocket、渲染、操作）
│   ├── style.css    # 移动端优先样式
│   ├── sw.js        # Service Worker（离线缓存）
│   ├── manifest.json # PWA 清单
│   └── icons/       # PWA 图标（192/512）
├── test/
│   └── game.test.js # 游戏逻辑单元测试（27 项）
├── start-online.bat # Windows 一键公网联机启动脚本
├── package.json
├── README.md
├── CLAUDE.md        # 给 Claude Code 的项目交接文档
├── HANDOFF.md       # 当前开发状态交接
├── TODO.md          # 待办（按优先级）
└── CHANGELOG.md     # 版本记录
```

## 安装方法

```bash
cd texas-holdem
npm install
```

仅依赖 `ws` 一个运行时包，无其他安装要求。

## 运行方法

### 局域网模式（同一 WiFi）

```bash
npm start
```

启动后打印：

```
Local:   http://localhost:3000
LAN:     http://192.168.80.167:3000
```

朋友在**同一 WiFi** 下打开 `http://<房主IP>:3000`。

### 公网模式（任意网络，推荐）

双击运行 `start-online.bat`，自动：
1. 启动本地游戏服务器
2. 通过 Cloudflare 免费隧道生成公网地址（形如 `https://xxxx.trycloudflare.com`）
3. 在窗口中显示该地址

**朋友用自己的 4G/5G 流量或任何 WiFi 打开该地址即可加入**。

> 注意：免费隧道地址每次启动都会变化，需把新地址发给朋友。依赖 cloudflared，首次运行先执行 `winget install Cloudflare.cloudflared`。

## 构建方法

本项目为纯 Node.js 服务 + 静态前端，**无需构建步骤**。直接运行即生产模式。

检查前端 JS 语法：

```bash
npm run check
```

## 测试方法

```bash
npm test          # 运行全部测试（27 项）
npm run test:game # 仅运行游戏逻辑测试
```

## PWA 安装方法

- **Android Chrome**：打开游戏页面 → 右上角菜单 → 「添加到主屏幕」→ 「安装」
- 安装后从主屏幕图标启动，全屏运行，像原生 App
- **iOS Safari**：分享 → 「添加到主屏幕」

PWA 配置见 [manifest.json](./public/manifest.json) 与 [sw.js](./public/sw.js)。

## 当前已知问题

> 完整清单见 [HANDOFF.md](./HANDOFF.md) 与 [TODO.md](./TODO.md)。

- **翻牌前大盲注无法加注**（P1）：大盲注被标记为"已行动"，无法行使加注选项，下注额一致后直接翻牌
- **无限记账下的无限加注**（P1 设计决策）：两方都无限加注时牌局不会自然收敛
- **公网隧道地址每次变化**（P2）：免费 Cloudflare 隧道每次启动生成新地址

## 后续开发计划

见 [TODO.md](./TODO.md) 的 P0-P4 优先级清单。

## 常见问题

- **手机打不开**：
  - 局域网模式：确认手机和电脑**同一 WiFi**，电脑防火墙放行 3000 端口
  - 公网模式：确认「德州扑克公网隧道」窗口开着，把最新公网地址发给朋友
- **AI 不行动**：AI 有 0.6-1.8 秒"思考"延迟，是正常现象
- **断线重连**：网络中断会自动重连，无需手动操作
- **显示负数筹码**：输光后继续玩会欠账，数字为负数并标红，赢牌后自动还债
