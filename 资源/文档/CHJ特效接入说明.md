# CHJ 特效接入说明

本文记录 J2ME 客户端里 `.chj` 特效的资源格式、播放规则、战斗事件关系和 Web 项目接入方式。后续做网页战斗、技能、命中特效时，可以直接按本文拆模块。

参考源码：

- `D:\gz\dx\decompiled\O0O0OO.java`：CHJ 解析和绘制
- `D:\gz\dx\decompiled\O000O0.java`：战斗事件解析
- `D:\gz\dx\decompiled\O0OOOOO.java`：战斗事件执行和特效调度
- `D:\gz\dx\decompiled\OOOO0.java`：伤害数字、提示文字飘动

参考资源：

- 原始 CHJ：`D:\gz\dx\work_unpack\c\*.chj`
- 已提取 PNG/JSON：`D:\gz\dx\decoded_assets\sprites\*.png`、`*.json`
- 系统数字/血条资源：`D:\gz\dx\work_unpack\csys\damage.png`、`blood.png`

## 1. 整体结论

攻击特效不是单独的图片格式，而是由三部分组成：

```text
战斗脚本事件 -> CHJ 动画播放 -> 伤害数字/文字飘动
```

其中：

- `.chj` 负责角色帧、技能帧、命中帧、状态图标等动画资源。
- `O000O0` 负责把服务器/脚本字符串解析成战斗事件。
- `O0OOOOO` 负责按时间执行事件，决定特效出现位置、播放哪一个 CHJ、播放哪一帧。
- `OOOO0` 负责伤害数字、治疗数字、提示文字的移动轨迹。

Web 项目里建议拆成三个模块：

```text
ChjSprite          解析 CHJ 提取结果，提供帧数据
ChjEffectPlayer    按坐标、动画组、tick 绘制 CHJ 特效
BattleEffectEvent  把战斗事件转成特效实体、位移、飘字
```

## 2. CHJ 文件结构

`.chj` 本质是：

```text
头部元数据 + 动画组偏移表 + 帧索引表 + PNG 图片数据
```

关键字段来自 `O0O0OO` 构造函数：

```text
byte[2] = frameWidth
byte[3] = frameHeight
byte[6] = animationGroupCount

byte[7 .. 7 + animationGroupCount]
  = 每个动画组在 frameIndexList 中的起始位置

byte[7 + animationGroupCount]
  = frameIndexListLength

byte[8 + animationGroupCount .. imageOffset)
  = frameIndexList

byte[imageOffset .. end]
  = PNG 图片数据
```

图片起始位置：

```js
const frameIndexListLength = bytes[7 + animationGroupCount] & 0xff;
const imageOffset = 8 + animationGroupCount + frameIndexListLength;
```

PNG 通常是一排横向帧图：

```text
第 0 帧：x = 0 * frameWidth
第 1 帧：x = 1 * frameWidth
第 2 帧：x = 2 * frameWidth
```

已提取后的 JSON 通常包含：

```json
{
  "id": "2053",
  "frameWidth": 64,
  "frameHeight": 49,
  "animationGroupCount": 10,
  "animations": [[0,1,2,3], [4,5,6]]
}
```

## 3. CHJ 绘制坐标

原版核心绘制函数：

```java
O0OOOO(Graphics graphics, int x, int y, int group, int tick)
```

这里的 `x, y` 不是图片左上角，而是角色/特效的脚点坐标。原版计算方式：

```text
drawX = x + 8 - frameWidth / 2
drawY = y - frameHeight
```

Web 端必须按这个规则绘制，否则技能和命中特效会整体偏移。

Canvas 绘制参考：

```js
function drawChjFrame(ctx, sprite, x, y, group, tick, scale = 1) {
  const frames = sprite.animations[group] || [];
  if (!frames.length) return;

  const rawFrame = frames[tick % frames.length];
  if (rawFrame === 255) return;

  const flip = rawFrame >= 128;
  const frameIndex = flip ? rawFrame - 128 : rawFrame;

  const sx = frameIndex * sprite.frameWidth;
  const sy = 0;
  const sw = sprite.frameWidth;
  const sh = sprite.frameHeight;

  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (x + 8 - sw / 2) * scale;
  const dy = (y - sh) * scale;

  if (flip) {
    ctx.save();
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(sprite.image, sx, sy, sw, sh, 0, 0, dw, dh);
    ctx.restore();
  } else {
    ctx.drawImage(sprite.image, sx, sy, sw, sh, dx, dy, dw, dh);
  }
}
```

## 4. 帧号 128+ 的含义

CHJ 的动画帧号如果大于等于 `128`，表示这帧需要水平翻转：

```js
const flip = rawFrame >= 128;
const frameIndex = flip ? rawFrame - 128 : rawFrame;
```

示例：

```text
0   = 第 0 帧正常绘制
1   = 第 1 帧正常绘制
128 = 第 0 帧水平翻转
129 = 第 1 帧水平翻转
```

`255` 通常表示空帧，不绘制。

## 5. 动画组和 tick

CHJ 动画组是一个帧序列：

```json
"animations": [
  [0, 1, 2, 3],
  [4, 5],
  [6, 7, 8]
]
```

播放时用：

```js
const frame = frames[tick % frames.length];
```

Web 端建议将动画时间和逻辑帧分开：

```js
effect.elapsed += deltaMs;
effect.tick = Math.floor(effect.elapsed / frameMs);
```

推荐初始值：

```js
const frameMs = 80; // 每帧 80ms 左右，可按资源调
```

普通循环特效：

```js
tick % frames.length
```

一次性攻击特效：

```js
if (tick >= frames.length) effect.finished = true;
```

## 6. 战斗事件类型

`O000O0.OOO` 是事件类型。和攻击特效相关的类型如下：

| 类型 | 作用 | Web 端处理 |
| --- | --- | --- |
| `0` | 近身攻击/普通攻击 | 攻击者向前偏移，播放命中特效，结算伤害 |
| `1` | 冲向目标攻击 | 攻击者移动到目标旁，再返回 |
| `2` | 原地攻击 | 原地播放特效和伤害 |
| `3` | 飞行/弹道特效 | 从攻击者坐标插值到目标坐标 |
| `a` | 全屏铺满特效 | 按网格重复生成同一个 CHJ 特效 |
| `b` | 指定坐标特效 | 在指定坐标播放 CHJ |
| `x` | 角色移动到指定坐标 | 移动角色并切换动作方向 |
| `r` | 回到原位 | 角色从当前坐标回到战斗站位 |
| `y` | 伤害/治疗结算 | 生成飘字，不一定有 CHJ |
| `h` | 头顶状态图标 | 给角色挂状态 CHJ |

战斗事件里常见字段含义：

```text
OO0OO    角色/目标编号
OOO0O    目标编号或动作编号
O0OO     CHJ 特效脚本字符串
O000O0O  HP 变化
O0O000O  MP 变化
OO0O00   战斗文字或状态资源
O0O0     事件开始 tick
```

## 7. 特效脚本字符串

`O0OOOOO.O0OOO(...)` 会解析 `O000O0.O0OO`。这是 CHJ 特效脚本，控制某个时间点播放哪个资源、哪一帧、偏移多少。

关键符号：

| 符号 | 含义 |
| --- | --- |
| `_` | 前面的字符串是 CHJ 资源 ID，开始解析后面的帧命令 |
| `|` | 当前资源段结束 |
| `$` | 时间推进一拍 |
| `*` | 使用当前攻击者的角色帧 |
| `%` | 隐藏当前攻击者 |
| `!` | 隐藏除攻击者以外的角色 |
| `DQ` | 使用当前角色帧编号 |

帧命令一般每 4 个字符一组：

```text
前 2 位 = 帧号
第 3 位 = x 偏移编码
第 4 位 = y 偏移编码
```

偏移编码：

```js
function decodeOffset(ch) {
  if (ch >= "A" && ch <= "Z") return (ch.charCodeAt(0) - 65) * 4;
  if (ch >= "a" && ch <= "z") return (97 - ch.charCodeAt(0)) * 4;
  return 0;
}
```

也就是：

```text
A = 0
B = 4
C = 8
a = 0
b = -4
c = -8
```

播放坐标：

```text
effectX = baseX + decodeOffset(code[2]) + 8
effectY = baseY + decodeOffset(code[3])
```

`baseX/baseY` 通常来自攻击者、目标或弹道插值位置。

## 8. 弹道和命中特效

事件 `3` 会在攻击者和目标之间插值：

```text
currentX = fromX + (toX - fromX) / remainingTime
currentY = fromY + (toY - fromY) / remainingTime
```

Web 端可以简化为：

```js
const t = Math.min(1, elapsed / duration);
const x = fromX + (toX - fromX) * t;
const y = fromY + (toY - fromY) * t;
```

然后在 `(x, y)` 上播放 CHJ 特效。

命中特效通常在目标脚点或目标身体中点播放。原版常用目标角色的 CHJ 尺寸修正：

```text
hitX = target.x + target.frameWidth / 2 - 8
hitY = target.y + target.frameHeight / 2
```

如果网页端暂时没有目标真实 CHJ 尺寸，可以先用：

```js
hitX = target.x;
hitY = target.y - target.height * 0.5;
```

后续再按 `frameWidth/frameHeight` 修正。

## 9. 伤害数字和文字

伤害数字由 `OOOO0` 管理，不是 CHJ。它支持两类显示：

- `OOO00O`：数字字符串，使用系统数字绘制。
- `OO00OO`：普通文字，使用字体绘制。

原版内置几套移动轨迹：

```text
左右偏移 + 向上飘 + 减速消失
```

Web 端可以先实现统一版本：

```js
function updateFloatingText(text, deltaMs) {
  text.elapsed += deltaMs;
  const t = text.elapsed / text.duration;
  text.x = text.startX + text.dir * Math.sin(t * Math.PI) * 12;
  text.y = text.startY - t * 32;
  text.alpha = 1 - t;
  text.finished = t >= 1;
}
```

伤害字段：

```text
O000O0.O000O0O = HP 变化
O000O0.O0O000O = MP 变化
```

如果字符串里带 `|数字`，后面的数字表示使用哪套飘动轨迹。

## 10. 资源范围建议

根据已提取资源，攻击/技能相关 CHJ 重点看这些范围：

```text
1000-1053  小型技能、命中、状态、图标类特效
2000-2106  战斗角色、小体型资源、技能动作
4000+      大型技能、怪物/技能相关表现
5000+      技能或特殊战斗资源
6000+      高级技能/大尺寸表现资源
750-910    大尺寸战斗表现资源
```

项目部署时建议保留：

```text
assets/chj_sprites/{id}.json
assets/chj_sprites/{id}.png
```

不要在浏览器里直接解析原始 `.chj`，除非需要上传原文件预览。正式项目用已经提取好的 JSON + PNG 更简单。

## 11. Web 端推荐数据结构

CHJ 精灵：

```js
const sprite = {
  id: "2053",
  frameWidth: 64,
  frameHeight: 49,
  animations: [[0, 1, 2, 3]],
  image: HTMLImageElement
};
```

一次性特效：

```js
const effect = {
  id: "2053",
  group: 0,
  x: 120,
  y: 160,
  elapsed: 0,
  frameMs: 80,
  loop: false,
  finished: false
};
```

弹道特效：

```js
const projectileEffect = {
  id: "1028",
  group: 0,
  fromX: 80,
  fromY: 150,
  toX: 170,
  toY: 150,
  elapsed: 0,
  duration: 360,
  frameMs: 80
};
```

状态挂载特效：

```js
const statusEffect = {
  id: "2050",
  group: 0,
  targetId: "enemy_1",
  offsetX: 0,
  offsetY: -32,
  loop: true
};
```

## 12. 渲染顺序

战斗场景建议按这个顺序画：

```text
1. 战斗背景
2. 后排/远处角色
3. 角色身后的特效
4. 角色本体
5. 命中特效、技能特效
6. 状态图标
7. 伤害数字、治疗数字、提示文字
8. UI
```

如果要更接近原版，可以按角色脚点 `y` 排序：

```js
renderables.sort((a, b) => a.y - b.y);
```

但伤害数字和 UI 永远放在最上层。

## 13. 最小播放流程

加载资源：

```js
const sprite = await loadChjSprite("2053");
```

创建特效：

```js
effects.push({
  id: "2053",
  group: 0,
  x: target.x,
  y: target.y,
  elapsed: 0,
  frameMs: 80,
  loop: false,
  finished: false
});
```

更新：

```js
for (const effect of effects) {
  effect.elapsed += deltaMs;
  const sprite = sprites[effect.id];
  const frames = sprite.animations[effect.group] || [];
  const tick = Math.floor(effect.elapsed / effect.frameMs);

  if (!effect.loop && tick >= frames.length) {
    effect.finished = true;
  }
}
```

绘制：

```js
for (const effect of effects) {
  const sprite = sprites[effect.id];
  const tick = Math.floor(effect.elapsed / effect.frameMs);
  drawChjFrame(ctx, sprite, effect.x, effect.y, effect.group, tick);
}
```

清理：

```js
effects = effects.filter(effect => !effect.finished);
```

## 14. 接入注意事项

- 坐标一定按脚点计算，不要直接把 `x/y` 当图片左上角。
- `rawFrame >= 128` 必须水平翻转。
- `255` 空帧不要绘制。
- 特效和角色共用 CHJ 播放器，区别只是动画组和坐标来源不同。
- 攻击事件里的 `$` 是时间推进，不能当普通字符。
- 飘字不是 CHJ，建议单独做 `FloatingText`。
- 正式项目建议使用提取好的 JSON + PNG，不要每次运行时解析原始 `.chj`。

## 15. 后续开发建议

建议下一步单独做一个 `web_effect_demo`，用于调试特效：

```text
左侧：选择 CHJ ID、动画组、frameMs、是否循环
中间：战斗画布，显示脚点和参考角色
右侧：当前帧序列、frameWidth/frameHeight、rawFrame/flip
```

这样后续接战斗时，可以先确认每个技能资源的正确坐标和播放速度，再接入正式战斗流程。
