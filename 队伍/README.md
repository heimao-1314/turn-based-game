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

Client-side team membership is still stored in `app.js` state:

- `state.team`
- `state.followLeaderId`

`team/runtime.js` is the helper layer around that state.

## 2. Team Movement

Current movement behavior stays client-driven:

- leader moves normally
- followers sync toward the leader
- team membership and map visibility continue to be transported through room `state` messages

## 3. Team Monster Battle

Current team monster battle is still leader-driven:

1. Leader starts a wild battle.
2. Client builds the allied roster from local player + online team members.
3. Leader client resolves the battle locally.
4. Team battle messages are broadcast to teammates so they can enter, watch, and receive reward sync.

This means team monster battle is still a synchronized local battle, not a server-authoritative combat session.

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

- store latest player/team metadata in `socketMeta`
- route room messages through `teamPvp.handleRoomMessage(...)`
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

- team monster battle and team PVP currently use different authority models
- client-side team state is not fully extracted yet; `app.js` still owns the UI-heavy flow
- `联网战斗/runtime.js` depends on room `state` messages being current enough to rebuild online team participation
