# 联网战斗模块

`联网战斗/` 是单人 PVP、多人 PVP、多人 PVE 的唯一服务端入口。

## 目标

- 客户端只连接中心服务器 WebSocket，不做手机之间的直连。
- 家庭宽带 IPv6 公网、移动数据、NAT、WiFi/数据切换都只影响“客户端到中心服务器”这一条连接。
- 战斗房间由服务端创建、维护、裁决、广播。
- 玩家身份以账号为兜底，`peerId` 只表示当前 WebSocket 会话。

## 服务端 Module

- `server.js`：兼容入口，只导出 `runtime.js`。
- `runtime.js`：中心化联网战斗运行时。
- `client.js`：客户端 WebSocket 地址工具，支持 IPv6 字面量地址自动加 `[]`。

旧的 `战斗/server-pvp.js` 和 `队伍/server-pvp.js` 已不再参与联网战斗链路。战斗规则仍复用：

- `战斗/engine.js`
- `战斗/skills.js`

## 消息流

### 单人 PVP / 多人 PVP

1. 客户端发送 `battleStart`。
2. 服务端按 `peerId -> account/name` 解析双方在线 socket。
3. 服务端按队伍状态展开双方成员，创建中心化战斗房间。
4. 服务端向全部参与者发送 `teamBattleStart`。
5. 客户端发送 `teamBattleChoice`。
6. 服务端收齐选择或超时后调用战斗引擎，广播 `teamBattleTurn`。
7. 战斗结束后广播 `teamBattleEnd`。

### 多人 PVE

1. 队长客户端发送 `teamPveStart`。
2. 服务端展开在线队伍成员，创建 PVE 战斗房间。
3. 后续选择、回合、结束与 PVP 共用同一套消息。

## 可靠性规则

- 不信任客户端战斗属性，服务端从数据库和在线镜像重建参战单位。
- `peerId` 过期时按账号或名字重新解析 socket。
- 战斗中断线不立即销毁房间；未提交选择的玩家走超时自动行动。
- 发送回合结果时，如果旧 `peerId` 不在线，服务端按账号寻找当前 socket 并改写 `to`。
- 同队不能互相挑战。

## 测试

```bash
node --test 联网战斗/server.test.js
node --test scripts/online-battle-routing.test.js
```
