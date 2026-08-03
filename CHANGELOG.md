# CHANGELOG.md

本项目所有重要变更记录。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [0.1.0] - 2026-08-03

### 新增
- 完整 No-Limit Texas Hold'em 游戏：翻牌前/翻牌/转牌/河牌/摊牌
- 六种动作：弃牌 / 过牌 / 跟注 / 下注 / 加注 / 全下
- 牌型判断（同花顺→高牌，含轮子顺子、皇家同花顺）
- 7 选 5 最佳手牌自动计算
- 底池/边池计算、平局分池
- 庄家按钮轮转、盲注（SB/BB）
- 智能 AI 对手（Monte Carlo 胜率模拟 + 底池赔率决策）
- 多 AI 独立调度
- 房间管理（4 位房间码、创建/加入、房主权限）
- 局域网联机
- PWA（manifest + Service Worker，可安装、离线缓存）
- 一键公网联机脚本 `start-online.bat`（Cloudflare 隧道）

### 变更
- 玩家筹码输光后不再淘汰，改为**无限记账**：继续参与、显示负数欠款、赢牌自动还债
- 去掉自动补 AI，改为房主手动添加，2 人真人即可开局
- 加注滑块适配无限记账（无筹码上限）

### 修复
- 多人满桌（9 人）下 AI 相互取消计时器导致的死锁
- 弃牌/跟注/过牌分支漏设 `acted` 导致的无限行动请求
- 连续手牌间 `startGame` 被误拦截
- 摊牌时缺少统一 `hand_ended` 信号

### 测试
- 新增 27 项游戏逻辑单元测试（`npm test`）

### 文档
- 新增 CLAUDE.md / HANDOFF.md / TODO.md / CHANGELOG.md
- 完善 README.md

### 已知问题
- 翻牌前大盲注无法行使加注权（BB option 缺失），见 TODO.md P1

## [Unreleased]

### 计划中
- 修复翻牌前大盲注加注权
- 断线重连恢复
- 局间统计
- 房间自定义设置 UI
