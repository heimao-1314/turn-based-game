# Admin Server Runtime

`online-stats-runtime.js` computes live online-player counts from the server-owned WebSocket registry. It is read-only and side-effect free.

## Files

- `online-stats-runtime.js` — online count runtime (Node CommonJS, factory + dependency injection)

## API

`createOnlineStatsRuntime({ sockets, socketMeta })` → `{ countsForServer }`

- `sockets`: `Set<net.Socket>` of live connections (server-owned).
- `socketMeta`: `Map<socket, meta>` with `meta.account` / `meta.serverId` / `meta.channelId`.
- `countsForServer(serverId, channelCount)` → `{ onlineCount, channels: [{ id, name, onlineCount }] }`.

## Counting rule (server-authoritative)

- Data source is the live socket registry only; client-reported numbers are never trusted.
- Only authenticated connections (`meta.account` non-empty) count.
- One account is counted once per line even with multiple live connections.
- Destroyed sockets and out-of-range line ids are ignored.
- `channelCount` is floored to at least 1.

## Consumers

- `server.js` `gameServerToApi()` for both the admin server list (`/api/admin/servers`) and the public server list (`/api/servers`).
- Docs: `docs/API文档.md` → 管理后台接口 → 获取服务器列表.

Any change to the counting rule must update `docs/API文档.md` onlineCount semantics.


## Growth Config Runtime

`growth-config-runtime.js` is the server-authoritative owner of progression tuning values: character/pet/mercenary level-growth attributes, base attributes, and the shared level-up experience curve. It persists overrides to `app_settings` (key `growth_config_v1`), so admin edits survive restarts while code defaults remain the reset baseline.

### Files

- `growth-config-runtime.js` — growth/exp config runtime (Node CommonJS, factory + dependency injection)

### API

`createGrowthConfigRuntime({ db, defaults })` → `{
  getConfig, updatedAt, expToNextLevel, characterGrowth, dragonSoulGrowth,
  petGrowth, mercenaryBaseStats, mercenaryFactor, updateConfig, resetConfig
}`

- `db`: `node:sqlite` DatabaseSync instance with the `app_settings` table.
- `defaults`: full default config (mirrors code constants) used on first load / reset.
- `getConfig()` → effective config (defaults merged with persisted overrides).
- `updateConfig(patch)` → validated write; returns `{ ok, config, updatedAt }` or `{ ok: false, errors }`.
- `resetConfig()` → deletes the override row and returns defaults.
- `expToNextLevel(level)` / `mercenaryFactor(level)` are used by `server.js` stat settlement.

### Validation rules

- `expTable` must be an array of exactly 100 entries; index 0 is a 0 placeholder and levels 1..99 must be ≥ 1 (a 0 threshold would hang the level-up loop).
- All numeric values are non-negative and capped at `MAX_VALUE = 1e9`.
- Mercenary factor requires `minFactor <= maxFactor`.

### Consumers

- `server.js` `expToNextLevel()`, `classBaseStats()`, `statsForPetRow()`, `statsForMercenaryRow()`.
- Admin endpoints: `GET/POST /api/admin/growth-config`, `POST /api/admin/growth-config/reset`.
- Public read endpoint: `GET /api/growth-config` (client display sync).
- Docs: `docs/API文档.md` → 管理后台接口 → 成长与经验配置.
