# 联网战斗模块

`联网战斗/` 是单人 PVP、多人 PVP、多人 PVE 的唯一服务端入口。

## 目标

- 客户端只连接中心服务器 WebSocket，不做手机之间的直连。
- 家庭宽带 IPv6 公网、移动数据、NAT、WiFi/数据切换都只影响“客户端到中心服务器”这一条连接。
- 战斗房间由服务端创建、维护、裁决、广播。
- 认证账号加区服/线路是玩家身份边界；`peerId` 只表示当前 WebSocket 会话。

## 服务端 Module

- `server.js`：兼容入口，只导出 `runtime.js`。
- `runtime.js`：中心化联网战斗运行时。
- `encounter-runtime.js`：服务端观测移动并签发普通野怪的一次性遭遇票据。
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

1. 服务端对认证 WebSocket 的 `state` 上报执行距离、速度阈值校验后随机签发普通遭遇；挂机客户端只发送无 payload 的 `pveIdleEncounterRequest`，服务端按 5 秒冷却决定是否向当前 canonical 队长定向发送 `pveEncounter`。
2. 队长携带 `battleId`、回显的 `wildMonsterId` 与一次性 `encounterId` 调用 `/api/online-pve/start`；客户端 roster、敌方快照和数量不会参与结算。
3. `runtime.js` 校验 canonical 队长、参战者未在战斗中、奖励冷却，以及票据绑定的账号、区服、地图、`peerId` 和怪物。
4. 服务端校验并消费票据后展开同地图在线队员，激活并广播 PVE 战斗房间；后续选择、回合、结束与 PVP 共用同一套消息。
5. 普通遭遇胜利时，服务端向每个攻击方账号定向下发 `teamBattleReward`；客户端只能用自己的 `rewardTicket` 领取。失败、本地战斗及阿飞均不签发普通野怪奖励票据。

普通遭遇目前覆盖阿木木和幻影。阿飞 Boss 使用独立开战路径，不能复用普通遭遇票据或普通野怪奖励票据。

### 账号绑定与重连

- 战斗参战资格、行动提交和接收目标均以认证账号及区服/线路校验；`peerId` 只是创建会话时的连接快照。
- 同一账号重连后，服务端按账号查找其当前 socket，并将定向消息的 `to` 改为新的 `peerId`。该账号仍可为自己拥有的单位提交 `teamBattleChoice`。
- 其他账号不能通过提交或复用旧 `peerId` 获得队伍成员资格、战斗参与资格或单位控制权。

### 结束权威

- `teamBattleEnd` 仅由服务端广播。客户端上报同名消息会被作为无效终止意图消费，不会结束或修改服务端战斗会话。
- 客户端只能由已认证参战者发送 `battleEscape` 且 `reason: "escape"` 请求逃跑；服务端校验通过后才会结束该场会话并广播结束事件。
- 服务端确认队伍解散后，会结束该队在同区服/线路内创建的组队战斗，并向所有参战者发送 `teamBattleEnd`，其中 `reason` 为 `team_disbanded`。显式 `pvpMode: "solo"` 的战斗不会因队伍解散结束。这是可信队伍运行时的服务端回调，客户端不能伪造。

## 可靠性规则

- 不信任客户端战斗属性，服务端从数据库和在线镜像重建参战单位。
- `peerId` 过期时按账号或名字重新解析 socket。
- 战斗中断线不立即销毁房间；未提交选择的玩家走超时自动行动。
- 发送回合结果时，如果旧 `peerId` 不在线，服务端按账号寻找当前 socket 并改写 `to`。
- 同队不能互相挑战。
- `teamBattleChoice.actions` 只能控制 `ownerPeerId` 与当前 WebSocket 会话匹配的单位。
- 普通遭遇票据只可消费一次，15 秒后失效且断线作废；普通挂机请求由服务端按 5 秒限流，缺票据、怪物或地图不匹配的 PVE 不创建战斗房间。
- 未领取的普通奖励票据会持久化到票据有效期；结算时断线后，服务端会在账号恢复 `state` 同步时重投。票据消费、玩家资产写入和结算结果持久化在同一事务内，重复领取请求只重放原结算结果。

## 测试

```bash
node --test 联网战斗/server.test.js
node --test scripts/online-battle-routing.test.js
node --test scripts/encounter-runtime.test.js
```
