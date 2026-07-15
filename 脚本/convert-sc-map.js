/**
 * @file convert-sc-map.js
 * @description SC 地图格式转换器 - 将 .sc/.sj 二进制地图文件转换为 JSON 格式
 *
 * 本模块解析游戏原始的 .sc 地图二进制格式，转换为结构化的 JSON 数据。
 * 支持的格式特征:
 * - 多字节头部偏移自动检测
 * - 基础层 (base) 和上层 (upper) 双层瓦片渲染
 * - 瓦片集 (tileset) 和单行图 (single-row) 两种引用方式
 * - 特殊瓦片 (tij 格式) 的变体支持
 *
 * 输出格式: { id, width, height, cells[], tilesets[], scMeta }
 *
 * @module convert-sc-map
 * @requires fs, path (Node.js 内置模块)
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const pendingDir = "maps\u5f85\u63a5\u5165";
const mapDir = "\u5730\u56fe";

function readBytes(filePath) {
  if (filePath.endsWith(".txt")) {
    const hex = fs.readFileSync(filePath, "utf8").replace(/\s+/g, "");
    if (hex.length % 2 !== 0) throw new Error(`Invalid hex length in ${filePath}`);
    const bytes = Buffer.alloc(hex.length / 2);
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }
  return fs.readFileSync(filePath);
}

function u16le(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function chooseDataOffset(bytes) {
  const candidates = [0, 4];
  for (const offset of candidates) {
    const width = bytes[offset + 18];
    const height = bytes[offset + 19];
    const specialOffset = u16le(bytes, offset + 4);
    const cellEnd = offset + 20 + width * height * 4;
    if (width > 0 && height > 0 && width < 128 && height < 128 && cellEnd <= bytes.length && cellEnd <= offset + specialOffset) {
      return offset;
    }
  }
  throw new Error("Could not locate a valid .sc/.sj map header");
}

function tileRef(realTileId) {
  if (realTileId == null || realTileId < 0 || realTileId >= 192) return null;
  return {
    kind: "tile",
    tileset: String(Math.floor(realTileId / 64)).padStart(2, "0"),
    index: realTileId % 64,
    rawTile: realTileId
  };
}

function parseOverlayTable(bytes, offset, count) {
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    const p = offset + i * 3;
    entries.push({
      frameRate: bytes[p],
      coord: u16le(bytes, p + 1)
    });
  }
  return entries;
}

function parseSpecialTable(bytes, offset, count) {
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    const p = offset + i * 4;
    const dataOffset = u16le(bytes, p);
    const lengthOrExternalId = u16le(bytes, p + 2);
    entries.push({
      raw: [bytes[p], bytes[p + 1], bytes[p + 2], bytes[p + 3]],
      dataOffset,
      lengthOrExternalId,
      tijId: dataOffset === 0 ? `${lengthOrExternalId}.tij` : `${i}.tij`
    });
  }
  return entries;
}

function parseSingleRowTable(bytes, offset, overlayCount, overlays) {
  const maxCoord = overlays.reduce((max, item) => Math.max(max, item.coord), 0);
  if (maxCoord < 192) return [];
  const count = Math.ceil((maxCoord - 192 + 1) / 16);
  const tableOffset = offset + overlayCount * 3;
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const p = tableOffset + i * 4;
    rows.push({
      index: i,
      offset: u16le(bytes, p),
      length: u16le(bytes, p + 2)
    });
  }
  return rows;
}

function extractSingleRowImages(bytes, singleRows, outputPath) {
  const outputDir = path.join(path.dirname(outputPath), "generated");
  const refs = [];
  for (const row of singleRows) {
    if (!row.offset || !row.length || row.offset + row.length > bytes.length) {
      refs[row.index] = null;
      continue;
    }
    fs.mkdirSync(outputDir, { recursive: true });
    const filename = `${path.basename(outputPath, ".json")}-sr-${String(row.index).padStart(2, "0")}.png`;
    const absolute = path.join(outputDir, filename);
    fs.writeFileSync(absolute, bytes.subarray(row.offset, row.offset + row.length));
    refs[row.index] = path.relative(root, absolute).replace(/\\/g, "/");
  }
  return refs;
}

function overlayRef(overlays, index, singleRowImages) {
  if (index === 0xff) return null;
  const entry = overlays[index];
  if (!entry) return null;
  if (entry.coord >= 192) {
    const coord = entry.coord - 192;
    const imageIndex = Math.floor(coord / 16);
    return {
      kind: "single-row",
      image: singleRowImages[imageIndex] || null,
      index: coord % 16,
      frameRate: entry.frameRate,
      rawCoord: entry.coord
    };
  }
  return {
    ...tileRef(entry.coord),
    frameRate: entry.frameRate
  };
}

function makeSpecialRef(specialTable, specialIndex, variant) {
  const entry = specialTable[specialIndex];
  return {
    kind: "tij",
    id: entry?.tijId || `${specialIndex}.tij`,
    variant
  };
}

function normalizeSpecialVariant(manifest, id, variant) {
  const item = manifest.specialTiles.find((special) => special.id === id);
  if (!item?.variants?.length) return variant || 0;
  const exact = item.variants.find((entry) => Number(entry.variant) === Number(variant || 0));
  if (exact) return exact.variant;
  const masked = Number(variant || 0) & 0x7f;
  const maskedMatch = item.variants.find((entry) => Number(entry.variant) === masked);
  if (maskedMatch) return maskedMatch.variant;
  const lowNibble = Number(variant || 0) & 0x0f;
  const lowMatch = item.variants.find((entry) => Number(entry.variant) === lowNibble);
  return lowMatch?.variant ?? item.variants[0].variant ?? 0;
}

function normalizeCellSpecialRefs(cell, manifest) {
  for (const ref of [cell.base, cell.upper]) {
    if (ref?.kind === "tij") ref.variant = normalizeSpecialVariant(manifest, ref.id, ref.variant);
  }
  return cell;
}

function convertCell(bytes, p, specialTable, overlays, singleRowImages) {
  const a = bytes[p];
  const b = bytes[p + 1];
  const c = bytes[p + 2];
  const d = bytes[p + 3];
  const specialIndex = a & 0x0f;
  const height = a >> 4;
  const base = specialIndex === 0x0f
    ? overlayRef(overlays, b, singleRowImages)
    : makeSpecialRef(specialTable, specialIndex, b);
  const upper = overlayRef(overlays, c, singleRowImages);
  const passability = d & 0x0f;
  return {
    base,
    upper,
    over: (d & 0x80) !== 0,
    block: passability !== 0x0f,
    passability,
    raw: [a, b, c, d],
    rawHeight: height
  };
}

function convert(inputPath, outputPath, options = {}) {
  const bytes = readBytes(inputPath);
  const offset = chooseDataOffset(bytes);
  const width = bytes[offset + 18];
  const height = bytes[offset + 19];
  const specialCount = bytes[offset + 2] & 0x0f;
  const specialOffset = offset + u16le(bytes, offset + 4);
  const overlayCount = bytes[offset + 6];
  const overlayOffset = offset + u16le(bytes, offset + 8);
  const decorationCount = bytes[offset + 10];
  const decorationOffset = offset + u16le(bytes, offset + 12);
  const triggerCount = bytes[offset + 14];
  const triggerOffset = offset + u16le(bytes, offset + 16);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "assets", "map_tiles", "manifest.json"), "utf8"));
  const specialTable = parseSpecialTable(bytes, specialOffset, specialCount);
  const overlays = parseOverlayTable(bytes, overlayOffset, overlayCount);
  const singleRows = parseSingleRowTable(bytes, overlayOffset, overlayCount, overlays);
  const singleRowImages = extractSingleRowImages(bytes, singleRows, outputPath);
  const cells = [];
  for (let i = 0; i < width * height; i += 1) {
    cells.push(normalizeCellSpecialRefs(convertCell(bytes, offset + 20 + i * 4, specialTable, overlays, singleRowImages), manifest));
  }
  const usedSpecialIds = new Set();
  for (const cell of cells) {
    if (cell.base?.kind === "tij") usedSpecialIds.add(cell.base.id);
    if (cell.upper?.kind === "tij") usedSpecialIds.add(cell.upper.id);
  }
  const map = {
    id: options.id || path.basename(inputPath, path.extname(inputPath)),
    title: options.title || path.basename(inputPath, path.extname(inputPath)),
    width,
    height,
    tileSize: 16,
    layers: ["base", "upper"],
    tilesets: manifest.baseTilesets.map(({ id, image, columns, tileWidth, tileHeight }) => ({ id, image, columns, tileWidth, tileHeight })),
    specialTiles: manifest.specialTiles
      .filter((item) => usedSpecialIds.has(item.id))
      .map(({ id, kind, image, width: itemWidth, height: itemHeight, anchorX, anchorY, frameCount, variantBits, variants }) => ({
        id,
        kind,
        image,
        width: itemWidth,
        height: itemHeight,
        anchorX,
        anchorY,
        frameCount,
        variantBits,
        variants
      })),
    source: path.relative(root, inputPath).replace(/\\/g, "/"),
    scMeta: {
      headerOffset: offset,
      specialCount,
      specialOffset: specialOffset - offset,
      specialTable,
      overlayCount,
      overlayOffset: overlayOffset - offset,
      overlays,
      singleRows,
      singleRowImages,
      decorationCount,
      decorationOffset: decorationOffset - offset,
      triggerCount,
      triggerOffset: triggerOffset - offset
    },
    cells
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(map, null, 2)}\n`, "utf8");
  return map;
}

function parseArgs(argv) {
  const options = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--title") options.title = argv[++i];
    else if (arg === "--id") options.id = argv[++i];
    else positional.push(arg);
  }
  return { positional, options };
}

if (require.main === module) {
  const { positional, options } = parseArgs(process.argv.slice(2));
  const input = positional[0] || path.join(root, pendingDir, "sgz", "yuanye.sc");
  const output = positional[1] || path.join(root, mapDir, "yuanye-demo.json");
  const map = convert(path.resolve(input), path.resolve(output), options);
  console.log(`Converted ${map.source} -> ${path.relative(root, output).replace(/\\/g, "/")}`);
  console.log(`${map.width}x${map.height}, ${map.cells.length} cells, ${map.scMeta.overlayCount} overlays, ${map.scMeta.specialCount} auto tiles`);
}

module.exports = { convert };
