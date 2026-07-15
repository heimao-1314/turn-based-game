# -*- coding: utf-8 -*-
"""
@file render_map_previews.py
@description 地图预览渲染器 - 将 JSON 格式的地图数据渲染为 PNG 预览图

本脚本读取 地图/converted 目录下的 JSON 地图文件，
使用 Pillow 库逐瓦片渲染为完整的地图预览图。

渲染流程:
1. 第一遍: 渲染基础层 (base) 瓦片
2. 第二遍: 渲染上层 (upper) 瓦片（覆盖在基础层之上）

支持的瓦片类型:
- tile: 标准瓦片集引用
- single-row: 单行瓦片图引用
- tij: 特殊瓦片格式（含变体支持）

使用方法: python 脚本/render_map_previews.py

依赖: Pillow (PIL)

输入: 地图/converted/*.json
输出: 地图/previews/*.png, 地图/previews/preview-summary.json
"""
import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
CONVERTED_DIR = ROOT / "地图" / "converted"
PREVIEW_DIR = ROOT / "地图" / "previews"
TILE_SIZE = 16


def load_image(cache, rel_path):
    if not rel_path:
        return None
    path = ROOT / rel_path
    if not path.exists():
        return None
    if path not in cache:
        cache[path] = Image.open(path).convert("RGBA")
    return cache[path]


def draw_ref(canvas, ref, map_data, image_cache, x, y):
    if not ref:
        return
    kind = ref.get("kind")
    if kind == "tile":
        tileset = next((item for item in map_data["tilesets"] if item["id"] == ref.get("tileset")), None)
        image = load_image(image_cache, tileset["image"]) if tileset else None
        if image is None:
            return
        index = ref.get("index", 0)
        columns = tileset.get("columns", 8)
        sx = (index % columns) * TILE_SIZE
        sy = (index // columns) * TILE_SIZE
        canvas.alpha_composite(image.crop((sx, sy, sx + TILE_SIZE, sy + TILE_SIZE)), (x, y))
        return
    if kind == "single-row":
        image = load_image(image_cache, ref.get("image"))
        if image is None:
            return
        sx = ref.get("index", 0) * TILE_SIZE
        canvas.alpha_composite(image.crop((sx, 0, sx + TILE_SIZE, TILE_SIZE)), (x, y))
        return
    if kind == "tij":
        variant = str(ref.get("variant") or 0).zfill(3)
        id_name = ref.get("id", "").replace(".", "_")
        candidates = [
            f"assets/map_tiles/special_variants/{id_name}_v{variant}.png",
            f"assets/map_tiles/special_variants/{id_name}_v000.png",
            f"assets/map_tiles/special/{ref.get('id')}",
        ]
        for rel_path in candidates:
            image = load_image(image_cache, rel_path)
            if image is not None:
                canvas.alpha_composite(image.resize((TILE_SIZE, TILE_SIZE), Image.Resampling.NEAREST), (x, y))
                return


def render_map(json_path, image_cache):
    map_data = json.loads(json_path.read_text(encoding="utf-8"))
    width = map_data["width"] * TILE_SIZE
    height = map_data["height"] * TILE_SIZE
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    for y in range(map_data["height"]):
        for x in range(map_data["width"]):
            cell = map_data["cells"][y * map_data["width"] + x]
            draw_ref(canvas, cell.get("base"), map_data, image_cache, x * TILE_SIZE, y * TILE_SIZE)
    for y in range(map_data["height"]):
        for x in range(map_data["width"]):
            cell = map_data["cells"][y * map_data["width"] + x]
            draw_ref(canvas, cell.get("upper"), map_data, image_cache, x * TILE_SIZE, y * TILE_SIZE)
    return canvas


def main():
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    image_cache = {}
    results = []
    for json_path in sorted(CONVERTED_DIR.glob("*.json")):
        if json_path.name == "conversion-summary.json":
            continue
        preview_path = PREVIEW_DIR / f"{json_path.stem}.png"
        canvas = render_map(json_path, image_cache)
        canvas.save(preview_path)
        results.append({
            "id": json_path.stem,
            "ok": True,
            "preview": str(preview_path.relative_to(ROOT)).replace("\\", "/"),
            "width": canvas.width,
            "height": canvas.height,
        })
        print(f"PREVIEW {json_path.stem} {canvas.width}x{canvas.height}")
    (PREVIEW_DIR / "preview-summary.json").write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Rendered {len(results)} previews")


if __name__ == "__main__":
    main()
