# 宠物/精灵跟随逻辑说明

本文记录当前 Web demo 中已经验证的宠物跟随方案，适用于后续项目里的随从、宠物、队友跟随。

示例实现：

- Demo：`D:\gz\dx\web_chj_demo`
- 核心代码：`D:\gz\dx\web_chj_demo\app.js`

## 1. 目标效果

跟随者不是立即贴着主角移动，而是：

1. 主角先移动。
2. 跟随者稍微停顿。
3. 跟随者沿着主角走过的路径移动。
4. 最终保持在主角附近。

当前参数：

```text
初始延迟：150ms
跟随者速度：等于主角速度
移动单位：16px 一格
触发跟随所需路径长度：至少 3 个路径点
```

## 2. 状态结构

主角和跟随者都使用相同的移动状态结构：

```js
const actor = {
  x: 0,
  y: 0,
  fromX: 0,
  fromY: 0,
  targetX: 0,
  targetY: 0,
  stepProgress: 1,
  direction: "down",
  moving: false,
  frameTick: 0,
  idleTick: 0
};
```

跟随者额外多两个字段：

```js
const follower = {
  ...actorState,
  wait: 0,
  path: []
};
```

字段含义：

| 字段 | 说明 |
| --- | --- |
| `x/y` | 当前世界坐标，单位像素 |
| `fromX/fromY` | 当前一步的起点 |
| `targetX/targetY` | 当前一步的终点 |
| `stepProgress` | 当前一步进度，`0..1` |
| `direction` | 当前朝向 |
| `moving` | 是否正在移动 |
| `frameTick` | 行走动画计时 |
| `idleTick` | 待机动画计时 |
| `wait` | 跟随开始前的等待计时 |
| `path` | 主角走过的路径队列 |

## 3. 路径记录

当主角成功开始走一格时，把主角离开的旧位置压入跟随路径：

```js
function beginStep(direction) {
  actor.fromX = actor.x;
  actor.fromY = actor.y;
  actor.targetX = actor.x;
  actor.targetY = actor.y;
  actor.direction = direction;

  if (direction === "up") actor.targetY -= tileSize;
  if (direction === "down") actor.targetY += tileSize;
  if (direction === "left") actor.targetX -= tileSize;
  if (direction === "right") actor.targetX += tileSize;

  if (canMoveTo(actor.targetX, actor.targetY)) {
    actor.stepProgress = 0;

    follower.path.push({
      x: actor.fromX,
      y: actor.fromY,
      direction: actor.direction
    });

    if (follower.path.length > 24) {
      follower.path.shift();
    }
  }
}
```

注意：

- 只有主角成功移动时才记录路径。
- 被阻挡时不记录。
- 记录的是“主角离开的格子”，不是目标格子。
- 队列长度有限制，避免无限增长。

## 4. 延迟跟随

跟随者不马上跟进，而是等路径队列达到一定长度，并等待一段时间。

当前逻辑：

```js
if (!follower.moving) {
  if (follower.path.length >= 3) {
    follower.wait += dt;
    if (follower.wait >= 150) {
      follower.wait = 150;
      beginFollowerStep();
    }
  } else {
    follower.wait = 0;
  }
}
```

效果：

- `path.length < 3`：说明主角距离还不够远，宠物不动。
- `path.length >= 3`：开始累计等待时间。
- 等待满 `150ms` 后，宠物开始走第一步。
- 后续不再每一步都重置等待，避免一卡一卡。

## 5. 跟随者开始一步移动

跟随者每次从路径队列里取一个点作为目标：

```js
function beginFollowerStep() {
  if (follower.stepProgress < 1 || follower.path.length < 3) return;

  const next = follower.path.shift();

  if (Math.abs(next.x - follower.x) < 1 && Math.abs(next.y - follower.y) < 1) {
    return;
  }

  const direction = directionBetween(follower.x, follower.y, next.x, next.y);
  if (!direction || !canMoveTo(next.x, next.y)) return;

  follower.fromX = follower.x;
  follower.fromY = follower.y;
  follower.targetX = next.x;
  follower.targetY = next.y;
  follower.direction = direction;
  follower.stepProgress = 0;
}
```

方向计算：

```js
function directionBetween(fromX, fromY, toX, toY) {
  if (toX > fromX) return "right";
  if (toX < fromX) return "left";
  if (toY > fromY) return "down";
  if (toY < fromY) return "up";
  return null;
}
```

## 6. 等速移动

主角和跟随者使用同样的速度系数：

```js
const stepSpeed = Number(speedInput.value) * dt * 0.0035;
```

跟随者移动：

```js
follower.stepProgress = Math.min(1, follower.stepProgress + stepSpeed);
follower.x = follower.fromX + (follower.targetX - follower.fromX) * follower.stepProgress;
follower.y = follower.fromY + (follower.targetY - follower.fromY) * follower.stepProgress;
```

这样跟随者的速度等于主角，不会突然追得太快，也不会每格停顿。

## 7. 连续补步，避免卡顿

关键点：跟随者走完一步后，如果路径队列仍然足够长，马上开始下一步。

```js
if (follower.stepProgress >= 1 && follower.path.length >= 3) {
  beginFollowerStep();
  follower.moving = follower.stepProgress < 1;
}
```

这能避免“走一格、停一下、再走一格”的卡顿。

跟随开始前有延迟，但跟随过程中是连续的。

## 8. 路径过长保护

如果主角持续移动，路径可能堆太长。当前 demo 有保护逻辑：

```js
if (!follower.moving && follower.path.length > 10) {
  const skip = follower.path.splice(0, follower.path.length - 8);
  const anchor = skip[skip.length - 1];
  if (anchor) {
    follower.x = anchor.x;
    follower.y = anchor.y;
    follower.fromX = follower.targetX = follower.x;
    follower.fromY = follower.targetY = follower.y;
  }
}
```

作用：

- 如果跟随者落后太多，丢弃过旧路径点。
- 保持跟随者在主角附近。
- 避免它花很久走完所有历史路径。

实际项目中可以根据需求调整：

```text
轻微跟随感：path.length > 12 时跳点
紧贴跟随：path.length > 6 时跳点
长队伍跟随：不跳点，但给每个队员不同延迟
```

## 9. 动画逻辑

跟随者和主角共用 CHJ 动画控制：

```js
const mode = entity.moving ? "walk" : "idle";
const tick = entity.moving ? entity.frameTick : entity.idleTick;
```

移动中：

```js
follower.frameTick += dt * 0.12;
follower.idleTick = 0;
```

待机中：

```js
follower.frameTick = 0;
follower.idleTick += dt * 0.06;
```

因此宠物停止时会播放自己的待机动画，行走时播放自己的行走动画。

## 10. 地图切换处理

切换地图时必须清空跟随路径，并把跟随者放到主角旁边：

```js
function placeFollower(tileX, tileY) {
  follower.x = tileX * tileSize + 8;
  follower.y = tileY * tileSize + 8;
  follower.fromX = follower.targetX = follower.x;
  follower.fromY = follower.targetY = follower.y;
  follower.stepProgress = 1;
  follower.direction = "down";
  follower.moving = false;
  follower.frameTick = 0;
  follower.idleTick = 0;
  follower.wait = 0;
  follower.path = [];
}
```

主角定位时同步调用：

```js
function placeActor(tileX, tileY) {
  actor.x = tileX * tileSize + 8;
  actor.y = tileY * tileSize + 8;
  actor.fromX = actor.targetX = actor.x;
  actor.fromY = actor.targetY = actor.y;
  actor.stepProgress = 1;
  actor.frameTick = 0;
  actor.idleTick = 0;

  placeFollower(tileX - 1, tileY);
}
```

## 11. 后续扩展建议

如果后续要做多个宠物/队友，可以把 `follower` 抽象成数组：

```js
followers = [
  { delaySteps: 3, waitMs: 150, actorState },
  { delaySteps: 5, waitMs: 250, actorState },
  { delaySteps: 7, waitMs: 350, actorState }
];
```

每个跟随者使用同一条主角路径，但不同的延迟步数和等待时间，就能形成队伍排队效果。

推荐模块拆分：

```text
PathFollower
  - path
  - wait
  - pushLeaderPosition()
  - update(dt)
  - resetNearLeader()

ChjActor
  - position
  - direction
  - frameTick
  - idleTick
  - draw()
```

这样后续接入地图碰撞、NPC 阻挡、宠物显示开关、战斗入场动画都会比较清晰。

