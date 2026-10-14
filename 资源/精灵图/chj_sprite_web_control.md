# CHJ 精灵格式与 Web 行走控制说明

本文记录当前 Web demo 已验证可用的 `.chj` 精灵解析、方向控制、移动动画、待机动画逻辑，方便后续项目直接复用。

示例文件：

- 原始精灵：`D:\gz\dx\work_unpack\c\647.chj`
- 提取结果：`D:\gz\dx\decoded_assets\sprites\647.json`
- Web demo：`D:\gz\dx\web_chj_demo`

## 1. CHJ 文件结构

`.chj` 文件是一个自定义封装格式，本质是：

```text
头部元数据 + 动画组索引表 + 帧序号表 + PNG 图片数据
```

按字节解析：

```text
byte[2] = frameWidth       单帧宽度
byte[3] = frameHeight      单帧高度
byte[6] = animationCount   动画组数量

byte[7 .. 7 + animationCount]
  = 每个动画组在 frameIndexList 里的起始偏移

byte[7 + animationCount]
  = frameIndexListLength

byte[8 + animationCount .. imageOffset)
  = frameIndexList，也就是所有动画组共用的帧序号数组

byte[imageOffset .. end]
  = PNG 图片数据
```

`imageOffset` 计算方式：

```js
const imageOffset = 8 + animationCount + frameIndexListLength;
```

PNG 图片通常是一条横向帧图：

```text
第 0 帧：x = 0 * frameWidth
第 1 帧：x = 1 * frameWidth
第 2 帧：x = 2 * frameWidth
...
```

绘制时：

```js
ctx.drawImage(
  image,
  frameIndex * frameWidth,
  0,
  frameWidth,
  frameHeight,
  drawX,
  drawY,
  frameWidth * scale,
  frameHeight * scale
);
```

## 2. 动画组含义

以 `647.chj` 为参考，提取后的动画组如下：

```json
[
  [0,0,0,1,1,1],
  [2,3],
  [4,4,4,5,5,5],
  [6,7],
  [8,8,8,9,9,9],
  [10,11],
  [12,12,12,13,13,13],
  [14,15],
  [],
  [],
  [16,16,16,17,17,17],
  [18,18,18,19,19,19]
]
```

已验证用于地图行走的核心映射：

| 方向 | 待机组 | 行走组 |
| --- | --- | --- |
| 下/正面 | 0 | 1 |
| 上/背面 | 2 | 3 |
| 左/侧面 | 4 | 5 |
| 右/侧面 | 4 + 水平翻转 | 5 + 水平翻转 |

说明：

- 偶数组一般是待机：`0, 2, 4, 6...`
- 奇数组一般是行走：`1, 3, 5, 7...`
- 一些精灵只有一套侧面动作，右方向需要用左方向帧水平翻转。
- 如果某个动作组为空，要回退到可用动作组，例如回退到正面待机。

## 3. 帧号 128+ 的含义

部分 `.chj` 动画帧会出现 `128`、`129`、`130` 这类帧号。

规则：

```js
const flip = rawFrame >= 128;
const frameIndex = flip ? rawFrame - 128 : rawFrame;
```

也就是：

- `0` 表示第 0 帧正常绘制
- `128` 表示第 0 帧水平翻转绘制
- `129` 表示第 1 帧水平翻转绘制

Web 绘制水平翻转：

```js
ctx.save();
ctx.translate(drawX + drawWidth, drawY);
ctx.scale(-1, 1);
ctx.drawImage(image, sx, sy, sw, sh, 0, 0, drawWidth, drawHeight);
ctx.restore();
```

## 4. 控制逻辑

键盘方向：

```text
ArrowUp / W    = 上
ArrowDown / S  = 下
ArrowLeft / A  = 左
ArrowRight / D = 右
```

方向映射：

```js
const actionMap = {
  down:  { idle: 0, walk: 1 },
  up:    { idle: 2, walk: 3 },
  left:  { idle: 4, walk: 5, forceFlip: false },
  right: { idle: 4, walk: 5, forceFlip: true }
};
```

这里 `forceFlip` 是额外翻转标记，用于右方向复用左侧面动作。

最终是否翻转：

```js
const rawFlip = rawFrame >= 128;
const forceFlip = actionMap[direction].forceFlip === true;
const flip = rawFlip || forceFlip;
```

## 5. 移动逻辑

推荐使用原 J2ME 风格的“一格一步”移动，而不是持续滑动。

原游戏坐标可理解为：

```text
1 个地图瓦片 = 16px
每次移动 = 16px
```

Web demo 当前做法：

```js
actor.x       当前屏幕 x
actor.y       当前屏幕 y
actor.fromX   本次步行动画起点 x
actor.fromY   本次步行动画起点 y
actor.targetX 本次步行动画终点 x
actor.targetY 本次步行动画终点 y
actor.stepProgress 0..1
```

按键后，如果当前没有正在走的一步，则创建下一步：

```js
actor.fromX = actor.x;
actor.fromY = actor.y;
actor.targetX = actor.x;
actor.targetY = actor.y;

if (direction === "up") actor.targetY -= 16;
if (direction === "down") actor.targetY += 16;
if (direction === "left") actor.targetX -= 16;
if (direction === "right") actor.targetX += 16;

actor.stepProgress = 0;
```

每帧插值：

```js
actor.stepProgress = Math.min(1, actor.stepProgress + speed);
actor.x = actor.fromX + (actor.targetX - actor.fromX) * actor.stepProgress;
actor.y = actor.fromY + (actor.targetY - actor.fromY) * actor.stepProgress;
```

判断是否正在移动：

```js
actor.moving = actor.stepProgress < 1;
```

这样角色走路不会“一瘸一拐”，动作和位移节奏也更接近原客户端。

## 6. 待机逻辑

待机不是固定显示第一帧。像 `647.chj` 的待机组是：

```text
正面待机：[0,0,0,1,1,1]
背面待机：[4,4,4,5,5,5]
侧面待机：[8,8,8,9,9,9]
```

如果停止移动时把动画计时清零，就会永远停在第一帧，看起来没有待机动作。

正确做法：

```js
if (actor.moving) {
  actor.frameTick += deltaTime * walkAnimSpeed;
  actor.idleTick = 0;
} else {
  actor.frameTick = 0;
  actor.idleTick += deltaTime * idleAnimSpeed;
}
```

取帧时：

```js
const tick = actor.moving ? actor.frameTick : actor.idleTick;
const frameCursor = Math.floor(tick / 8);
const rawFrame = frames[frameCursor % frames.length];
```

推荐速度：

```js
walkAnimSpeed = 0.12
idleAnimSpeed = 0.06
```

也就是说待机动画比走路动画慢一些。

## 7. 当前 Web demo 中的核心伪代码

```js
function currentFrame(sprite, actor) {
  const mode = actor.moving ? "walk" : "idle";
  const map = actionMap[actor.direction];
  const action = map[mode];
  const frames = sprite.animations[action] || sprite.animations[0] || [0];
  const tick = actor.moving ? actor.frameTick : actor.idleTick;
  const raw = frames[Math.floor(tick / 8) % frames.length];

  return {
    frameIndex: raw >= 128 ? raw - 128 : raw,
    flip: raw >= 128 || map.forceFlip === true
  };
}
```

```js
function updateActor(actor, direction, deltaTime) {
  if (actor.stepProgress >= 1 && direction) {
    startOneTileStep(actor, direction);
  }

  actor.moving = actor.stepProgress < 1;

  if (actor.moving) {
    actor.stepProgress = Math.min(1, actor.stepProgress + deltaTime * speed);
    actor.x = lerp(actor.fromX, actor.targetX, actor.stepProgress);
    actor.y = lerp(actor.fromY, actor.targetY, actor.stepProgress);
    actor.frameTick += deltaTime * 0.12;
    actor.idleTick = 0;
  } else {
    actor.frameTick = 0;
    actor.idleTick += deltaTime * 0.06;
  }
}
```

## 8. 后续项目建议

建议把 `.chj` 运行时封装成两个模块：

```text
ChjSprite
  - parse(arrayBuffer)
  - loadFromFile(file)
  - loadFromUrl(id)
  - getFrame(action, tick)

ActorController
  - direction
  - moving
  - x/y
  - from/target
  - frameTick
  - idleTick
  - update(input, deltaTime)
```

地图项目中，角色不要直接按像素连续移动，应按瓦片格移动：

```text
按键 -> 判断目标格是否可走 -> 创建一步移动 -> 播放行走动画 -> 到达后进入待机动画
```

这样后续接入地图碰撞、NPC 阻挡、传送触发点、战斗触发点会更简单。

