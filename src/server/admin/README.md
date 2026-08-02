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
