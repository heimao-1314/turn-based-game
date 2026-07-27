# Team Module

## Overview

`team/` is the browser group-play helper module. Server-authoritative team PVP/PVE orchestration now lives in `../联网战斗/runtime.js`.

Current supported scope:

- team create / join / leave / disband
- team movement / follow
- team monster battle synchronization
- team roster helpers for the online battle runtime

The active architecture is split across client and server:

- client-side team state still lives in `app.js`
- reusable team helpers now live in `team/runtime.js`
- server-authoritative team PVP/PVE orchestration lives in `联网战斗/runtime.js`

## V2 Foundation (Not Yet Wired)

The V2 protocol core is implemented separately from the active V1 message path:

- `shared.js` defines command names, stable error codes, request ID validation, and realm normalization.
- `server/team-state-machine.js` owns V2 teams, invitations, revisions, authenticated-account membership, reconnect updates, and request idempotency.
- `server/index.js` is the server-side V2 export boundary.
- `tests/team-state-machine.test.js` covers lifecycle, stale revisions, duplicate commands, impersonation, expiry, and reconnects.

This core does not drive clients yet. It must first be connected in shadow mode and compared with the active V1 runtime before any feature flag sends authoritative V2 snapshots to browsers.

## File Layout

### `runtime.js`

Browser-side team runtime helper.

Main responsibilities:

- normalize team members
- build active team roster
- determine whether a team message belongs to the current player
- determine whether a team battle message belongs to the current active battle
- compute online team members on the current map
- compute team battle size and wild monster count scaling
- send team battle broadcast messages
- determine which battle fighters are controlled by the local player in team PVP

This file is intentionally a helper module. It does not own rendering, map movement, or socket lifecycle by itself.

### Online Battle Runtime

Server-authoritative group battle runtime moved to `../联网战斗/runtime.js`. The old `server-pvp.js` file has been deleted.

Main responsibilities:

- expand a `battleStart` into attacker-side and defender-side team participants
- rebuild each participant from trusted server-side player data plus current online mirror
- assign ownership metadata to every battle actor
- create one shared battle session for all participants
- collect `teamBattleChoice` messages from each player
- merge those choices into per-fighter action maps
- resolve turns through `battle/engine.js`
- broadcast authoritative `teamBattleTurn`
- close the session on finish or disconnect

This is the trust seam for team PVP. Clients do not resolve group PVP locally.

## Active Runtime Flow

## 1. Team State

Client-side team membership is a server-synchronized view stored in `app.js` state:

- `state.team`
- `state.followLeaderId`

`team/server.js` owns invitations and canonical membership. `team/runtime.js` is the browser helper layer around the synchronized view.

### 身份与重连

- 队伍的 canonical 身份是“认证账号 + 区服/线路”。`peerId` 只用于定位该账号当前的 WebSocket 连接和定向消息，不能作为成员资格或队长权限的依据。
- 服务端按账号保存队长和成员关系；加入、离开、解散均从发送消息的认证连接取得账号，不信任客户端提交的成员名单、账号或旧 `peerId`。
- 同一账号在断线宽限期内重连时，服务端会更新该账号当前的 `peerId` 并重新发送 `teamUpdate`，队伍关系保持不变。其他账号即使复用旧 `peerId`，也不会继承原成员或队长身份。
- 宽限期结束后按正常断线规则清理：队长的队伍解散，成员从队伍移除；最后一名成员离开也会使该队解散。

## 2. Team Movement

Current movement behavior stays client-driven:

- leader moves normally
- followers sync toward the leader
- membership is synchronized by server-generated `teamAccepted` and `teamUpdate` messages, not room `state` payloads

## 3. Team Monster Battle

普通野怪的组队战斗由服务端权威运行时处理：

1. 服务端仅向 canonical 队长签发普通野怪遭遇；普通挂机也只能请求服务端限流的遭遇。
2. 队长消费一次性遭遇票据后，`联网战斗/runtime.js` 从服务端队伍状态展开同地图在线成员。
3. 客户端只提交自己单位的 `teamBattleChoice`；回合和胜负由服务端计算。
4. 胜利后，服务端为每位参战账号签发独立奖励票据，客户端不能自行传入奖励内容。

客户端的 `state.team` 只是显示和跟随用途，不能创建、覆盖或扩展服务端 roster。

## 4. Team PVP

Current team PVP path is server-authoritative:

1. A player initiates `battleStart` against another player.
2. `联网战斗/runtime.js` expands both sides through the current team metadata.
3. The server builds one shared battle session for solo, team PVP, and team PVE.
4. If either side is a team, all online members are included.
5. The server sends `teamBattleStart` to all participants.
6. Each client enters battle and only controls fighters owned by its own `peerId`.
7. Each client sends `teamBattleChoice`.
8. The server merges all per-player choices into per-fighter `actions`.
9. The server resolves the turn with `battle/engine.js`.
10. The server broadcasts authoritative `teamBattleTurn` and later `teamBattleEnd`.

This keeps the battle rule layer shared while moving authority for online team combat to the server.

### 服务端终止边界

- `teamBattleEnd` 是服务端发给参战者的状态事件，不是客户端可用的结束指令。客户端伪造该消息不会改变或终止服务端战斗会话。
- 参战者只能通过认证连接发送 `battleEscape` 且 `reason` 为 `escape` 请求退出；是否结束会话由服务端校验后决定。
- 当服务端确认队长执行 `teamDisband`、队长发送 `teamLeave` 或最后一名成员离开时，队伍运行时会调用可信的联网战斗终止路径。它只结束该队在同区服/线路内创建的组队战斗，并向全部参战者发送 `teamBattleEnd`，其中 `reason` 为 `team_disbanded`；显式 `pvpMode: "solo"` 的战斗不受影响。

## Core Concepts

### Team Roster

A team roster is the participant list used for messaging and battle inclusion.

Current hard cap:

- 4 total players per team
- 1 leader + up to 3 members

### Controlled Fighter

In team PVP, each client only controls fighters whose `ownerPeerId` matches the local player:

- own role
- own pet
- own mercenary

Other same-side fighters still appear in battle, but their actions come from their owning player or server fallback.

### Ownership Metadata

Battle actor snapshots now carry:

- `ownerPeerId`
- `ownerName`

This is what allows one shared battle scene to remain controllable by multiple different clients.

## Integration Points

### Client

Main integration file: `D:\gz\dx\dw\app.js`

Current client responsibilities:

- team menu flow
- team join / leave / disband UI behavior
- follow logic
- entering team battle scenes
- collecting local battle choices
- forwarding `teamBattleChoice` for server-side team PVP

### Server

Main integration file: `D:\gz\dx\dw\server.js`

Current server responsibilities:

- own pending invitations and canonical team membership in `team/server.js`
- project only the canonical team metadata into `socketMeta` for battle expansion
- fall through to normal solo PVP runtime when no team expansion is needed

## Audit Notes

The current codebase had a few architectural issues before this extraction:

- pure team helpers were spread across `app.js`
- team battle messaging and roster logic were mixed with unrelated battle UI logic
- team size scaling was capped below the declared 4-player team limit
- existing team monster battle only pulled in teammates and teammate pets, but not teammate mercenaries
- online group PVP had no dedicated authoritative session owner

The current module addresses these issues by:

- centralizing reusable client team helpers in `team/runtime.js`
- moving server-owned online battle sessions into `联网战斗/runtime.js`
- restoring 4-player team battle sizing
- including teammate mercenaries in allied team assembly

## Change Guidelines

### If you change roster logic

Start with `team/runtime.js` and verify the `state.team` readers in `app.js`.

### If you change online team PVP authority

Start with `联网战斗/runtime.js`, then verify the intercept order in `server.js`.

### If you change combat rules

Do not change `team/` first. Change `battle/skills.js` or `battle/engine.js`, because team PVP reuses the battle rule layer.

### If you move more team code out of `app.js`

Prefer moving pure team state / messaging logic into `team/runtime.js` first. Keep rendering and DOM event handling in `app.js` unless a deeper seam is clearly justified.

## Known Notes

- normal team monster battle and team PVP both use the server-authoritative battle runtime
- client-side team state is not fully extracted yet; `app.js` still owns the UI-heavy flow
- `联网战斗/runtime.js` depends on room `state` messages being current enough to rebuild online team participation
