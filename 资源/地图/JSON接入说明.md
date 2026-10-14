# 图片拼瓦片工具 JSON 接入说明

## 资源来源

地图资源来自 JAR 解包目录：

- 基础瓦片：`work_unpack/d/00.dat`、`01.dat`、`02.dat`
- 特殊地块：`work_unpack/d/*.tij`

资源准备脚本：

```text
tools/prepare_image_tile_tool_assets.py
```

脚本会生成：

```text
web_image_tile_tool/assets/map_tiles/
```

主要内容：

- `tilesets/*.png`: 普通 16x16 tileset
- `special/*.png`: 每个 `.tij` 的默认预览
- `special_variants/*.png`: `.tij` 的有效变体预览
- `special_raw/*.png`: `.tij` 原始 8x8 条带
- `special_meta/*.json`: `.tij` 的帧表
- `manifest.json`: 工具加载清单

## 自动拼图

自动拼图会使用：

- 普通 `00/01/02` tileset 的全部 16x16 瓦片
- 每类 `.tij` 特殊地块的前若干代表变体

右侧手动选择区仍显示全部特殊变体。参考图片现在绘制在瓦片下方，只作为对齐辅助，不会盖住生成结果。

## 导出 JSON

每个格子在 `cells` 中，索引规则：

```js
const cell = cells[y * width + x];
```

普通瓦片：

```json
{
  "kind": "tile",
  "tileset": "00",
  "index": 0
}
```

特殊地块：

```json
{
  "kind": "tij",
  "id": "2.tij",
  "variant": 37
}
```

格子结构：

```json
{
  "base": { "kind": "tile", "tileset": "00", "index": 0 },
  "upper": { "kind": "tij", "id": "2.tij", "variant": 37 },
  "over": true,
  "block": false
}
```

`base` 和 `upper` 都可以是普通瓦片，也可以是特殊地块。

## 渲染建议

1. 先绘制全部 `base`。
2. 再绘制角色、NPC 等对象。
3. 再绘制全部 `upper`。
4. 调试时叠加 `block` 禁行遮罩。

普通瓦片绘制：

```js
function drawTile(ctx, image, ref, x, y, columns) {
  const sx = (ref.index % columns) * 16;
  const sy = Math.floor(ref.index / columns) * 16;
  ctx.drawImage(image, sx, sy, 16, 16, x * 16, y * 16, 16, 16);
}
```

特殊地块绘制：

```js
function drawTij(ctx, variantImages, ref, x, y) {
  const image = variantImages[`${ref.id}#${ref.variant || 0}`];
  ctx.drawImage(image, x * 16, y * 16, 16, 16);
}
```

## 禁行判断

```js
function canMoveTo(map, x, y) {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;
  return !map.cells[y * map.width + x].block;
}
```

## 一键启动

双击：

```text
web_image_tile_tool/start_tool.bat
```

默认地址：

```text
http://127.0.0.1:8020/index.html
```
