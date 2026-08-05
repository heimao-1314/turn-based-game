# Battle Module

## Overview

`battle/` is the combat domain layer. Its job is to isolate skill rules, turn resolution, battle state shaping, and server-side PVP arbitration from the large UI and networking surface in `app.js` and `server.js`.

The current runtime is split into two paths:

- NPC / local battles: client-side battle state is built in the browser, and the attacker client resolves each turn locally.
- Online PVP/PVE battles: battle choices are sent to the center server, and `联网战斗/runtime.js` resolves turns on the server and broadcasts the authoritative result to every participant.

This means the combat rules live in one place, but the battle orchestration differs by battle type.

## File Layout

### `skills.js`

Skill catalog and skill filtering helpers.

Main responsibilities:

- Defines `skillCatalog`.
- Resolves skill metadata by `skillId`.
- Filters passive skills out of active battle skills.
- Checks role-exclusive skill usage requirements such as class, equipped weapon, demon weapon, and sacrifice prerequisites.
- Exposes both browser global and Node `module.exports`, so it can be shared by client and server code.

Use this file when:

- Adding or modifying skill formulas.
- Changing who can use a skill.
- Adding new active or passive effects at the metadata layer.

Do not put turn execution logic here. This file should describe skills, not resolve combat.

### `engine.js`

Core combat resolver.

Main responsibilities:

- Builds fighters from actor snapshots.
- Calculates effective stats, defense reduction, guard reduction, critical hits, and damage.
- Applies statuses, buffs, debuffs, control effects, lifesteal, rebirth, counters, combo, bleed, curse, and end-of-round effects.
- Selects targets according to skill rules.
- Produces battle events and turn results consumed by the client renderer and by the server PVP runtime.

Design notes:

- The module is dependency-injected through `createRuntime(deps)`.
- It is intentionally close to pure domain logic. The caller provides helpers such as stat lookup, target selection, effect id mapping, and status normalization.
- It exports to both browser and Node, so the exact same turn rules can be reused on the server.

Use this file when:

- Changing damage formulas.
- Changing action order and turn sequencing.
- Adding new statuses or passive trigger behavior.
- Fixing combat rule inconsistencies between local battles and PVP.

Avoid putting transport, socket, UI, or persistence logic here.

### `protocol.js`

Client-side battle payload shaping.

Main responsibilities:

- Serializes actors into battle snapshots.
- Rebuilds lightweight actors from snapshots.
- Builds initial battle state payloads used by the browser battle UI.

Key outputs:

- `battleActorSnapshot(...)`
- `battleActorFromSnapshot(...)`
- `actorSnapshot(...)`
- `actorFromSnapshot(...)`
- `battleStatePayload(...)`

Notes:

- This file is currently browser-only and exposed through `window.BattleProtocol`.
- It is a transport/state-shaping layer, not a combat rules layer.

Use this file when:

- Changing the structure of battle state stored in the browser.
- Adjusting what actor data is carried into battle setup.
- Extending battle initialization payloads.

### `battle-placement.js`

Browser-side battle placement positions.

Main responsibilities:

- `placeEnemyGridFighter`: staggered two-column layout for 4+ enemies. The first half of the targets line up in the left column top-to-bottom and the second half in the right column offset by half a row, so units no longer stack on the same horizontal line.
- `placeSingleBattleFighter`: triangle positioning for solo teams (pet / actor / mercenary).
- `placeAllyGridFighter`: ally grid for team battles.
- `placeElfKingVaultHiddenEnemyFighter`: compact block layout for the 40-target hidden vault fight.

Notes:

- Pure coordinate math only; `drawBattleScene` in `app.js` calls it every frame to write `battleX` / `battleY`.
- Browser-global style, exposed through `window.BattlePlacement`.

Use this file when:

- Changing where battle units are placed on the battle canvas.
- Adjusting multi-target enemy formation or spacing.

### `battle-bars.js`

Browser-side battle HP / energy bar drawing supporting three switchable styles (selected from the in-game detail settings menu):

- `blood` (经典款, `blood.png` 22x7): split drawing — the HP bar and the energy bar are drawn as two touching segments; units without energy only show the HP bar.
- `hp` (金色款, `HP.png` 78x11): combined frame 40x11 drawn in one `drawImage`, golden HP fill + cyan energy fill.
- `2hp` (新款式, `2HP.png` 78x9): combined frame 40x9, golden HP fill + cyan energy fill. Default style.

Main responsibilities:

- `drawBattleBars`: dispatches by `style.mode` — `split` draws the classic two-segment bars (energy only when `energyRate > 0`); `frame` draws the combined frame once, then crops the right fills onto each slot by ratio, leaving the energy slot empty when `energyRate = 0`.
- `BATTLE_BAR_STYLES`: style catalog (id / label / src / frame / fills / slots).

Notes:

- `app.js` keeps the selected style in `state.battleBarStyle` (persisted under `dw-battle-bar-style`, default `2hp`); `drawBattleHpEnergyBar` delegates to `drawBattleBars` with a simplified round-rect fallback until the style image loads.
- All three sheets (`blood.png`, `HP.png`, `2HP.png`) are preloaded with the other battle assets.
- Energy fill shows on friendly fighters (player / pet / mercenary) and on both sides in PVP; monsters, bosses and NPCs get HP only. `energyRate` uses `fighter.energy / fighter.maxEnergy` when present and a full bar otherwise, so skill energy costs can be wired in later.

Use this file when:

- Changing battle HP / energy bar visuals or proportions.
- Adding or removing selectable bar styles.
- Wiring up energy costs later.
### Online Battle Runtime

Server-authoritative online battle orchestration has moved to `../联网战斗/runtime.js`. The old `server-pvp.js` file has been deleted.

Main responsibilities:

- Tracks pending invites and active PVP battle sessions.
- Rebuilds battle participants from trusted server-side player data and the latest client mirror.
- Collects `teamBattleChoice` messages from every participant.
- Generates auto actions when needed.
- Calls the shared battle engine to resolve turns on the server.
- Broadcasts authoritative `battleTurn` results to both clients.
- Cleans up sessions on battle end or disconnect.

`联网战斗/runtime.js` is the seam between raw room messages and authoritative combat.

Use this file when:

- Changing PVP ownership rules.
- Changing how player, pet, or mercenary data is reconstructed on the server.
- Adding validation for battle choices.
- Adjusting timeout, fallback, or disconnect behavior in online battles.

### `session.js`

`battle/session.js` exists in the repository, but it is not part of the current active load path.

At the time of writing:

- `app.js` does not initialize or import it.
- `index.html` does not wire it in as the active battle session owner.

Treat it as an inactive prototype or extraction attempt. Do not extend it as if it were production runtime unless you rewire the battle entry points first.

### `reward-ticket-runtime.js`

Issues a one-time, short-lived reward ticket only after the server-authoritative PVE runtime confirms victory. It also persists a completed settlement result for idempotent HTTP retries and exposes pending tickets for reconnect delivery. A recent reward ticket also enforces a short server-side PVE start cooldown.

### `reward-settlement-runtime.js` and `reward-delivery-runtime.js`

`reward-settlement-runtime.js` applies a ticket's server-rolled reward and player progression update inside the ticket transaction. `reward-delivery-runtime.js` replays an unclaimed ticket to the authenticated socket after it resumes state synchronization. These modules keep normal wild-monster rewards out of client-side battle resolution.

## Active Runtime Flow

## 1. Shared Rule Layer

Both local battles and server PVP depend on the same combat rule pieces:

- `skills.js`: what a skill is allowed to do
- `engine.js`: how a turn is actually resolved

This is the key modular boundary. If a combat rule should behave the same in all battle types, the change should usually land here first.

## 2. Local / NPC Battle Flow

Current active path:

1. `app.js` initializes `battleEngine` from `window.BattleEngine.createRuntime(...)`.
2. `app.js` initializes `battleProtocol` from `window.BattleProtocol.createRuntime(...)`.
3. Battle setup builds `state.battle` through protocol helpers and local actor data.
4. The client collects both sides' choices into `battle.choices`.
5. `tryResolveBattleTurn()` resolves the turn locally only when `battle.opponentPeerId` is empty.
6. The result is played immediately by the client battle UI.

Important detail:

- `tryResolveBattleTurn()` now returns early for online PVP by checking `battle.opponentPeerId`.
- This prevents the old attacker-client-authoritative PVP behavior from running.

## 3. Server Online Battle Flow

Current active path:

1. `server.js` creates `onlineBattle` from `联网战斗/server.js`.
2. Incoming room messages are passed through `onlineBattle.handleRoomMessage(data, socket)` before generic broadcast.
3. The server tracks player runtime metadata in `socketMeta`, including peer id, map context, and the latest client mirror.
4. When an online battle starts, `联网战斗/runtime.js` reconstructs both battle sides from:
   - server-side player row
   - current online actor mirror
   - current pet / mercenary mirror
5. Each client sends `teamBattleChoice`.
6. The server waits until both sides have a choice, or fills missing actions with auto behavior if required by the session logic.
7. The server calls the shared `engine.resolveBattleTurn(...)`.
8. The server sends the authoritative `teamBattleTurn` result to all participants.
9. Clients only render and apply that result; they do not decide the winner for PVP locally.

This is the current authoritative model for online player-vs-player combat.

## Core Concepts

### Actor

An actor is the world/unit representation before combat resolution. It may be:

- player character
- pet
- mercenary
- wild monster

`protocol.js` is responsible for turning actors into transferable battle snapshots.

### Fighter

A fighter is the combat-time structure created from an actor.

Typical fighter fields include:

- `battleId`
- `name`
- `side`
- `actor`
- `stats`
- `hp`
- `maxHp`
- `defeated`
- `statuses`
- `buffs`

`engine.js` operates on fighters, not on world actors directly.

### Choice

A battle choice is the per-turn command selected for a fighter side, typically:

- basic attack
- skill cast
- target selection

For local battles, both choices live in browser state.

For online PVP/PVE, each client sends its choice to the server using `teamBattleChoice`, and the server becomes the single source of truth.

### Turn Result

A turn result is the authoritative output of `resolveBattleTurn(...)`.

It usually contains:

- event list
- hp changes
- status changes
- defeat / rebirth state
- winner or continuation state

The renderer should consume this structure, not re-derive combat outcomes.

## Statuses, Buffs, and Passive Effects

Combat state is spread across a few categories:

- `statuses`: control and damage-over-time style state such as bind, confuse, paralyze, seal, sleep, stun, bleed, curse, vulnerable
- `buffs`: additive stat changes
- `statMultiplier` / `statMultipliers`: multiplicative modifications
- passive flags and values such as combo, counter, rebirth, lifesteal, guard, break armor, control immunity

Rule of thumb:

- Add new effect metadata in `skills.js`
- Execute the effect in `engine.js`
- Only touch `protocol.js` or `联网战斗/runtime.js` if the effect changes transport or orchestration requirements

## Integration Points

### Client

Main integration file: `D:\gz\dx\dw\app.js`

Relevant responsibilities:

- creates battle runtimes
- owns `state.battle`
- collects player input
- renders battle UI
- plays authoritative `battleTurn` results
- resolves local battles when there is no remote opponent

### Server

Main integration file: `D:\gz\dx\dw\server.js`

Relevant responsibilities:

- creates the PVP runtime
- records room/player runtime metadata
- routes room messages through `serverPvp.handleRoomMessage(...)`
- lets the generic broadcast path handle only messages not consumed by the PVP runtime

## Change Guidelines

### If you change skill behavior

Start with `skills.js`, then update `engine.js` if execution semantics also change.

### If you change damage, order, or state transitions

Start with `engine.js`. This is the authoritative rule layer for both local battles and PVP.

### If you change battle setup payload shape

Update `protocol.js` and verify all `state.battle` readers in `app.js`.

### If you change online PVP validation or authority boundaries

Update `联网战斗/runtime.js` and verify the intercept path in `server.js`.

### If you want stronger modularity

Keep this separation:

- skill description: `skills.js`
- combat rule execution: `engine.js`
- browser battle state shaping: `protocol.js`
- online orchestration and trust boundary: `联网战斗/runtime.js`

Do not move rendering logic into the rule engine, and do not let the client re-decide PVP results.

## Known Notes

- `protocol.js` is still browser-global style and not yet aligned with the dual-export pattern used by `skills.js` and `engine.js`.
- `session.js` is present but inactive.
- Current architecture intentionally allows local NPC battles to remain client-resolved while PVP is server-resolved.
- If future work also moves NPC or boss battles to the server, the best extension point is to add another server battle orchestrator that still reuses `engine.js`.
