# 口袋精灵 (dw-pocket-spirit) API 文档

> 版本: 1.0.0 | 最后更新: 2026-05-29

## 目录

- [概述](#概述)
- [认证系统](#认证系统)
- [玩家接口](#玩家接口)
- [战斗系统接口](#战斗系统接口)
- [管理后台接口](#管理后台接口)
- [WebSocket 事件](#websocket-事件)
- [错误码说明](#错误码说明)

---

## 概述

### 基础信息

| 项目 | 说明 |
|------|------|
| 基础 URL | `http://localhost:6588` |
| 数据格式 | JSON |
| 字符编码 | UTF-8 |
| 认证方式 | 请求头 `x-admin-account` + `x-admin-password` |

### 通用响应格式

成功响应:
`json
{
  "ok": true,
  "data": { ... }
}
`

错误响应:
`json
{
  "ok": false,
  "error": "error_code"
}
`

---

## 每日新闻与阅读兑换

以下接口均需要玩家 Bearer 会话。每日新闻由服务端获取，玩家按上海自然日首次阅读时获得 1 点阅读点数。

- `GET /api/daily-news/status`：返回当日是否已读与 `readingPoints`。
- `POST /api/daily-news/read`：读取新闻；首次返回 `gainedPoints: 1`，重复读取返回 `0`。
- `GET /api/reading-exchange/catalog`：返回可扩展的兑换目录。
- `POST /api/reading-exchange/redeem`：body `{ "itemId": "lucky_box" }`；服务端原子扣点并发放物品。

---

## 认证系统

### 检查账号是否存在

`
GET /api/auth/exists?account={account}
`

**参数:**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| account | string | 是 | 玩家账号 |

**响应示例:**
`json
{ "ok": true, "exists": true }
`

### 注册账号

`
POST /api/auth/register
Content-Type: application/json
`

**请求体:**
`json
{
  "account": "player1",
  "password": "hashed_password"
}
`

### 登录

`
POST /api/auth/login
Content-Type: application/json
`

**请求体:**
`json
{
  "account": "player1",
  "password": "hashed_password"
}
`

### 修改密码

`
POST /api/auth/change-password
Content-Type: application/json
`

**请求体:**
`json
{
  "account": "player1",
  "oldPassword": "old_hash",
  "newPassword": "new_hash"
}
`

---

## 玩家接口

### 获取玩家公开信息

`
GET /api/player-public?account={account}
`

返回其他玩家的公开信息（用于排行榜、查看详情等）。

### 获取玩家数据

`
GET /api/player
`

**请求头:** 需要认证

返回当前登录玩家的完整数据。

### 更新玩家数据

`
POST /api/player
Content-Type: application/json
`

**请求头:** 需要认证

保存玩家的游戏进度数据。

### 获取背包数据

`
GET /api/bag
`

**请求头:** 需要认证

返回玩家的背包物品列表。

### 角色转职

`
POST /api/change-role
Content-Type: application/json
`

**请求头:** 需要认证

### 改名

`
POST /api/rename
Content-Type: application/json
`

**请求头:** 需要认证

### 领取灵魂粉末

`
POST /api/soul-powder/claim
Content-Type: application/json
`

**请求头:** 需要认证

### 兑换码兑换

`
POST /api/redeem-code/claim
Content-Type: application/json
`

**请求体:**
`json
{
  "code": "运营发放的兑换码"
}
`

兑换码由服务端数据库配置有效期、全服次数、单账号次数和奖励。接口不会接受客户端提交的奖励内容。

### 战斗奖励领取

`
POST /api/battle-reward
Content-Type: application/json
`

**请求头:** 需要认证

请求体只接受服务端通过 WebSocket `teamBattleReward` 下发的 `rewardTicket`。服务端会校验票据所属账号、有效期与未领取状态，并从票据而非客户端请求读取怪物和数量。可交易奖励仅能由服务端权威联网 PVE 结算发放；本地客户端战斗不会产生经济奖励。

### 服务端 PvE 开战

`
POST /api/online-pve/start
`

**请求头:** 需要认证

请求必须携带 WebSocket `pveEncounter` 下发的短期 `encounterId`。服务端会校验账号、区服、线路、地图、怪物类型和一次性使用状态，并自行重建野怪与参战阵容；客户端提交的敌方快照和数量不作为结算依据。

### 获取排行榜

`
GET /api/stat-rankings
`

### 获取竞技场排行

`
GET /api/arena/rankings
`

### 获取灵魂粉末状态

`
GET /api/soul-powder/status
`

**请求头:** 需要认证

### 获取幻境状态

`
GET /api/phantom/status
`

**请求头:** 需要认证

### 获取更新日志

`
GET /api/changelog
`

### 获取资源清单

`
GET /api/asset-manifest
`

返回所有游戏资源文件的 URL 列表，用于 Service Worker 预缓存。

---

## 管理后台接口

> 所有管理接口需要在请求头中携带 `x-admin-account` 和 `x-admin-password`

### 获取玩家列表

`
GET /api/admin/players
`

### 获取角色目录

`
GET /api/admin/catalog
`

### 获取服务器列表

`
GET /api/admin/servers
`

返回 `servers` 数组，每项字段：

| 字段 | 说明 |
|------|------|
| `id` | 服务器 ID（TEXT） |
| `name` | 服务器名称 |
| `enabled` | 是否启用 |
| `channelCount` | 线路数量 |
| `characterCount` | 该服务器角色总数 |
| `onlineCount` | 当前在线玩家数 |
| `channels` | 分线路在线数 `[{ id, name, onlineCount }]`，name 形如 `1线` |
| `sortOrder` / `createdAt` / `updatedAt` | 排序与时间 |

> `onlineCount` 由服务端按 WebSocket 注册表实时统计：只计已认证连接；同一账号多开只计 1 人；已断开连接不计。公开的服务器列表接口（登录时选择服务器）使用同一口径。

### 获取属性排行

`
GET /api/admin/stat-rankings
`

### 获取异常检测结果

`
GET /api/admin/anomalies
`

### 扫描异常数据

`
POST /api/admin/scan-anomalies
`

### 发放物品

`
POST /api/admin/grant-item
Content-Type: application/json
`

**请求体:**
`json
{
  "adminAccount": "admin",
  "adminPassword": "admin123",
  "targetAccount": "player1",
  "itemId": "sword_001",
  "count": 1
}
`

### 清除物品

`
POST /api/admin/clear-item
Content-Type: application/json
`

### 更新玩家数据

`
POST /api/admin/update-player
Content-Type: application/json
`

### 重置竞技场

`
POST /api/admin/reset-arena
`

### 重置幻境积分

`
POST /api/admin/reset-phantom-points
`

### 发放幻境称号

`
POST /api/admin/grant-phantom-title
Content-Type: application/json
`

### 重置物品

`
POST /api/admin/reset-items
`

### 重置异常等级

`
POST /api/admin/reset-abnormal-levels
`

### 封禁/解封账号

`
POST /api/admin/ban-account
POST /api/admin/unban-account
Content-Type: application/json
`

**请求体:**
`json
{
  "adminAccount": "admin",
  "adminPassword": "admin123",
  "targetAccount": "player1",
  "reason": "使用外挂"
}
`

### 重置密码

`
POST /api/admin/reset-password
Content-Type: application/json
`

### 管理更新日志

`
GET /api/admin/changelog
POST /api/admin/changelog
`

---

## WebSocket 事件

服务器通过 WebSocket 升级处理实现实时通信。客户端连接后可发送和接收以下事件:

### 客户端 → 服务器

| 事件类型 | 说明 |
|---------|------|
| `state` | 玩家状态更新（位置、方向、移动状态） |
| `chat` | 聊天消息 |
| `battleInvite` | 发起战斗邀请 |
| `battleAccepted` | 接受战斗邀请 |
| `battleRejected` | 拒绝战斗邀请 |
| `battleTurn` | 提交战斗回合选择 |
| `battleEnd` | 战斗结束通知 |
| `battleMarkerStart` | 战斗标记开始 |
| `battleMarkerEnd` | 战斗标记结束 |
| `teamInvite` | 组队邀请 |
| `teamLeave` | 离开队伍 |
| `teamBattleStart` | 组队战斗开始 |
| `pveIdleEncounterRequest` | 请求服务端签发挂机野怪遭遇 |
| `teamBattleTurn` | 组队战斗回合 |
| `follow` | 跟随玩家 |
| `unfollow` | 取消跟随 |
| `tradeInvite` | 交易邀请 |
| `tradeOffer` | 交易出价 |
| `stallStart` | 开始摆摊 |
| `stallEnd` | 结束摆摊 |

### 服务器 → 客户端

| 事件类型 | 说明 |
|---------|------|
| `peerJoined` | 新玩家加入 |
| `peerLeft` | 玩家离开 |
| `state` | 其他玩家状态更新 |
| `chat` | 聊天消息广播 |
| `battleInvite` | 收到战斗邀请 |
| `battleTurn` | 收到战斗回合结果 |
| `battleEnd` | 战斗结束 |
| `teamUpdate` | 队伍状态更新 |
| `pveEncounter` | 服务端签发的短期 PvE 遭遇票据 |
| `teamBattleReward` | 服务端 PvE 胜利后的领奖票据 |
| `announcement` | 系统公告 |

---

## 错误码说明

| 错误码 | 说明 |
|--------|------|
| `bad_response` | 服务器响应格式错误 |
| `request_failed` | 请求失败 |
| `invalid_credentials` | 账号或密码错误 |
| `account_exists` | 账号已存在 |
| `account_not_found` | 账号不存在 |
| `account_banned` | 账号已被封禁 |
| `invalid_code` | 兑换码无效 |
| `code_already_used` | 兑换码已使用 |
| `cooldown` | 操作冷却中 |
| `invalid_data` | 数据格式无效 |
| `permission_denied` | 权限不足 |

---

## 职业与技能系统

### 职业目录

| 职业 | 子职业 | 性别选项 |
|------|--------|---------|
| 枪手 | 破魔、重装、狙击 | 男、女 |
| 法师 | 裁决、暗影、光明 | 男、女 |
| 剑士 | 刺杀、狂暴、防御 | 男、女 |

### 技能类型

| 类型 | 说明 |
|------|------|
| `physical` | 物理攻击，基于攻击力和速度 |
| `magic` | 魔法攻击，基于法力值 |
| `special` | 特殊技能，附带控制效果 |
| `heal` | 治疗技能 |
| `self_buff` | 自身增益 |
| `buff` | 团队增益 |
| `passive` | 被动技能 |

---

## 队伍与组队战斗

### 队伍人数与野怪数量对照

| 队伍人数 | 野怪数量 |
|---------|---------|
| 1 人 | 1 只 |
| 2 人 | 4 只 |
| 3 人 | 10 只 |
| 4 人 | 14 只 |

### 联网战斗传输

组队战斗、队 v 队 PK 和 1V1 强杀都通过服务器 WebSocket 仲裁。客户端只提交 `teamBattleChoice`，回合结果由服务器广播。
