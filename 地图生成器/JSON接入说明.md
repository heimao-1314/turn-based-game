# 图片拼瓦片工具 JSON 接入说明

## 资源放置

工具运行时只读取浏览器能访问到的静态文件。入口清单是：

```text
assets/map_tiles/manifest.json
```

`app.js` 会先加载这个清单，再按清单中的 `image`、`rawImage`、`meta` 路径继续加载图片和元数据。所以接入时不要只复制 JSON 地图文件，必须同时保持这些资源路径可访问。

当前资源分成几类：

```text
assets/map_tiles/
  manifest.json              # 必需：瓦片资源总清单
  tilesets/00.png             # 必需：基础 16x16 普通瓦片
  tilesets/01.png
  tilesets/02.png
  special/*.png               # 必需：每个 .tij 的默认预览
  special_variants/*.png      # 必需：.tij 的有效变体，地图实际渲染优先用这里
  special_meta/*.json         # 建议保留：.tij 帧表和元数据
  special_raw/*.png           # 调试/重新生成用，普通运行可不直接读取

maps/
  converted/manifest.json     # 地图浏览器清单
  converted/*.json            # 已转换地图 JSON
  jlmg/*.png                  # 新增的地图单行瓦片集，manifest 中以 map_jlmg_* 引用
  mszy/*.png                  # 新增的地图单行瓦片集，manifest 中以 map_mszy_* 引用
  sgpy/*.png                  # 新增的地图单行瓦片集，manifest 中以 map_sgpy_* 引用
  sgz/*.png                   # 新增的地图单行瓦片集，manifest 中以 map_sgz_* 引用
```

当前 `manifest.json` 中登记的基础资源共 54 个：

- `assets/map_tiles/tilesets/*.png`：3 个，资源 id 为 `00`、`01`、`02`，每张是 8 列 x 8 行。
- `maps/jlmg/*.png`：35 个，资源 id 形如 `map_jlmg_101`。
- `maps/mszy/*.png`：1 个，资源 id 形如 `map_mszy_104`。
- `maps/sgpy/*.png`：9 个，资源 id 形如 `map_sgpy_aedfj`。
- `maps/sgz/*.png`：6 个，资源 id 形如 `map_sgz_yuanye`。

这些 `maps/<分类>/*.png` 是新加入的普通瓦片集，不是底层整图。它们通常是单行 16x16 瓦片条，`columns` 和 `tileCount` 以 `manifest.json` 为准，例如：

```json
{
  "id": "map_jlmg_101",
  "kind": "tileset",
  "image": "maps/jlmg/101.png",
  "tileWidth": 16,
  "tileHeight": 16,
  "columns": 16,
  "rows": 1,
  "tileCount": 16
}
```

特殊地块资源共 7 类 `.tij`，当前有效变体共 237 张。地图里引用特殊地块时，运行时需要能访问 `special_variants/*.png`：

```json
{
  "id": "2.tij",
  "image": "assets/map_tiles/special/2.tij.png",
  "rawImage": "assets/map_tiles/special_raw/2.tij.png",
  "meta": "assets/map_tiles/special_meta/2.tij.json",
  "variants": [
    { "variant": 0, "image": "assets/map_tiles/special_variants/2_tij_v000.png" }
  ]
}
```

## 资源来源

源资源来自 JAR 解包目录：

- 基础瓦片：`work_unpack/d/00.dat`、`01.dat`、`02.dat`
- 特殊地块：`work_unpack/d/*.tij`
- 地图单行瓦片：`maps/<分类>/*.png`

资源准备脚本：

```text
tools/prepare_image_tile_tool_assets.py
```

脚本会生成：

```text
assets/map_tiles/
```

主要内容：

- `tilesets/*.png`: 普通 16x16 tileset
- `maps/<分类>/*.png`: 地图拆出的单行普通瓦片集，路径直接写入 `manifest.json`
- `special/*.png`: 每个 `.tij` 的默认预览
- `special_variants/*.png`: `.tij` 的有效变体预览
- `special_raw/*.png`: `.tij` 原始 8x8 条带
- `special_meta/*.json`: `.tij` 的帧表
- `manifest.json`: 工具加载清单

## 自动拼图

自动拼图会使用：

- `manifest.json` 中 `baseTilesets` 的全部普通瓦片，包括 `00/01/02` 和 `maps/<分类>/*.png` 单行瓦片集
- 每类 `.tij` 特殊地块的前若干代表变体

右侧手动选择区仍显示全部特殊变体。参考图片现在绘制在瓦片下方，只作为对齐辅助，不会盖住生成结果。

## 导出 JSON

如果地图使用“底层图片”，JSON 会额外包含 `imageLayer`。工具内从本地导入的图片会以 data URL 保存，外部接入时也可以把 `src` 换成相对路径或 URL：

```json
{
  "imageLayer": {
    "kind": "image",
    "name": "town.png",
    "src": "maps/town.png",
    "width": 240,
    "height": 320,
    "draw": { "x": 0, "y": 0, "width": 240, "height": 320 },
    "opacity": 1
  }
}
```

每个格子在 `cells` 中，索引规则：

```js
const cell = cells[y * width + x];
```

普通瓦片：

```json
{
  "kind": "tile",
  "tileset": "map_jlmg_101",
  "index": 0
}
```

`tileset` 必须对应 `assets/map_tiles/manifest.json` 里的 `baseTilesets[].id`。旧基础瓦片可以用 `00`、`01`、`02`；新增地图瓦片集使用 `map_<分类>_<文件名>`，例如 `map_sgz_yuanye` 对应 `maps/sgz/yuanye.png`。

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

使用 `imageLayer` 作为完整底图时，`base` 可以为 `null`，这样底层图片不会被默认瓦片盖住：

```json
{
  "base": null,
  "upper": null,
  "over": true,
  "block": false
}
```

## 渲染建议

1. 如果存在 `imageLayer`，先绘制底层图片。
2. 再绘制全部 `base`。
3. 再绘制角色、NPC 等对象。
4. 再绘制全部 `upper`。
5. 调试时叠加 `block` 禁行遮罩。

底层图片绘制：

```js
function drawImageLayer(ctx, image, layer) {
  if (!layer) return;
  const draw = layer.draw || {};
  ctx.save();
  ctx.globalAlpha = layer.opacity ?? 1;
  ctx.drawImage(
    image,
    draw.x || 0,
    draw.y || 0,
    draw.width || map.width * 16,
    draw.height || map.height * 16
  );
  ctx.restore();
}
```

普通瓦片绘制：

```js
const tilesetMeta = Object.fromEntries(
  manifest.baseTilesets.map((item) => [item.id, item])
);

function drawTile(ctx, tilesetImages, ref, x, y) {
  if (!ref) return;
  const meta = tilesetMeta[ref.tileset];
  const image = tilesetImages[ref.tileset];
  if (!meta || !image) return;

  const tileW = meta.tileWidth || 16;
  const tileH = meta.tileHeight || 16;
  const columns = meta.columns || Math.floor(meta.width / tileW) || 1;
  const sx = (ref.index % columns) * tileW;
  const sy = Math.floor(ref.index / columns) * tileH;
  ctx.drawImage(image, sx, sy, tileW, tileH, x * 16, y * 16, 16, 16);
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
http://[::1]:8021/index.html
```
