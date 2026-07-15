const tileSize = 16;
const candidateCount = 12;
const continuityPasses = 5;
const continuityWeight = 0.42;
const autoSpecialVariantsPerTile = 12;

const canvas = document.getElementById("editorCanvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });
const paletteCanvas = document.getElementById("paletteCanvas");
const paletteCtx = paletteCanvas.getContext("2d");

const gridColsInput = document.getElementById("gridCols");
const gridRowsInput = document.getElementById("gridRows");
const applyGridButton = document.getElementById("applyGrid");
const sourceImageInput = document.getElementById("sourceImage");
const baseImageInput = document.getElementById("baseImage");
const autoBuildButton = document.getElementById("autoBuild");
const clearMapButton = document.getElementById("clearMap");
const fitGridToBaseImageButton = document.getElementById("fitGridToBaseImage");
const clearBaseImageButton = document.getElementById("clearBaseImage");
const offsetXInput = document.getElementById("offsetX");
const offsetYInput = document.getElementById("offsetY");
const scaleInput = document.getElementById("scale");
const alphaInput = document.getElementById("alpha");
const fitImageButton = document.getElementById("fitImage");
const resetAlignButton = document.getElementById("resetAlign");
const layerSelect = document.getElementById("layer");
const toolSelect = document.getElementById("tool");
const showImageInput = document.getElementById("showImage");
const showTilesInput = document.getElementById("showTiles");
const showUpperInput = document.getElementById("showUpper");
const showGridInput = document.getElementById("showGrid");
const showBlockInput = document.getElementById("showBlock");
const exportButton = document.getElementById("exportJson");
const downloadButton = document.getElementById("downloadJson");
const copyButton = document.getElementById("copyJson");
const importButton = document.getElementById("importJson");
const jsonBox = document.getElementById("jsonBox");
const stats = document.getElementById("stats");

let tilesetIds = [];
let baseTilesets = [];
let specialTiles = [];
let paletteHitboxes = [];
const tilesets = {};
const specialImages = {};
const specialVariantImages = {};
const tileFeatures = [];
let sourceImage = null;
let sourceName = "";
let imageLayer = null;
let imageLayerImage = null;
let selectedTileset = "00";
let selectedTile = 0;
let selectedSpecial = null;
let multiSelection = null;
let paletteDrag = null;
let activeLayer = "base";
let pointerDown = false;
let lastPointer = { x: 0, y: 0 };
let hover = { x: -1, y: -1 };

const align = {
  x: 0,
  y: 0,
  scale: 1,
  alpha: 0.45,
};

const map = {
  id: "image-tile-map",
  title: "图片拼瓦片地图",
  width: 15,
  height: 20,
  cells: [],
};

function makeCell(tileset = "00", index = 0) {
  return {
    base: { kind: "tile", tileset, index },
    upper: null,
    over: true,
    block: false,
  };
}

function makeImageLayerCell() {
  return {
    base: null,
    upper: null,
    over: true,
    block: false,
  };
}

function normalizeCell(cell) {
  if (!cell || typeof cell !== "object") return makeCell();
  if (!("base" in cell)) cell.base = { tileset: "00", index: 0 };
  if (cell.base && !cell.base.kind) cell.base.kind = "tile";
  if (cell.upper && !cell.upper.kind) cell.upper.kind = "tile";
  if (!("upper" in cell)) cell.upper = null;
  if (!("over" in cell)) cell.over = true;
  if (!("block" in cell)) cell.block = false;
  return cell;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

async function setImageLayerFromSource(src, name = "底层图片", clearBaseCells = false) {
  if (!src) {
    imageLayer = null;
    imageLayerImage = null;
    draw();
    return;
  }

  const img = await loadImage(src);
  imageLayerImage = img;
  imageLayer = {
    kind: "image",
    name,
    src,
    width: img.naturalWidth || img.width,
    height: img.naturalHeight || img.height,
    draw: {
      x: 0,
      y: 0,
      width: map.width * tileSize,
      height: map.height * tileSize,
    },
    opacity: 1,
  };
  if (clearBaseCells) {
    for (const cell of map.cells) normalizeCell(cell).base = null;
  }
  draw();
}

async function loadTilesets() {
  const manifest = await loadTileManifest();
  baseTilesets = manifest.baseTilesets || [];
  specialTiles = manifest.specialTiles || [];
  tilesetIds = baseTilesets.map((item) => item.id);
  selectedTileset = tilesetIds[0] || "00";

  for (const item of baseTilesets) {
    tilesets[item.id] = await loadImage(item.image);
  }
  for (const item of specialTiles) {
    specialImages[item.id] = await loadImage(item.image);
    for (const variant of item.variants || []) {
      specialVariantImages[specialKey(item.id, variant.variant)] = await loadImage(variant.image);
    }
  }
  buildTileFeatures();
  drawPalette();
}

function specialKey(id, variant = 0) {
  return `${id}#${variant}`;
}

function specialLabel(value = selectedSpecial) {
  if (!value) return "";
  return `${value.id} v${value.variant || 0}`;
}

function normalTileRef(tileset = selectedTileset, index = selectedTile) {
  return { kind: "tile", tileset, index };
}

function selectedResourceRef() {
  if (selectedSpecial) return { kind: "tij", id: selectedSpecial.id, variant: selectedSpecial.variant || 0 };
  return normalTileRef();
}

function resourceLabel(ref) {
  if (!ref) return "-";
  if (ref.kind === "image") return ref.name || "底层图片";
  if (ref.kind === "tij" || ref.kind === "special") return specialLabel(ref);
  return `${ref.tileset}:${ref.index}`;
}

async function loadTileManifest() {
  const response = await fetch("./assets/map_tiles/manifest.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`地图瓦片清单加载失败: HTTP ${response.status}`);
  return response.json();
}

function buildTileFeatures() {
  const work = document.createElement("canvas");
  work.width = tileSize;
  work.height = tileSize;
  const workCtx = work.getContext("2d", { willReadFrequently: true });
  tileFeatures.length = 0;

  for (const source of baseTilesets) {
    const columns = source.columns || 8;
    const rows = source.rows || 8;
    const count = source.tileCount || columns * rows;
    const srcTileW = source.tileWidth || 16;
    const srcTileH = source.tileHeight || 16;
    for (let index = 0; index < count; index += 1) {
      const sx = (index % columns) * srcTileW;
      const sy = Math.floor(index / columns) * srcTileH;
      workCtx.clearRect(0, 0, tileSize, tileSize);
      workCtx.drawImage(tilesets[source.id], sx, sy, srcTileW, srcTileH, 0, 0, tileSize, tileSize);
      tileFeatures.push({
        ref: normalTileRef(source.id, index),
        tileset: source.id,
        index,
        feature: extractFeature(workCtx, 0, 0, tileSize, tileSize),
        edges: extractEdges(workCtx, 0, 0, tileSize, tileSize),
      });
    }
  }

  for (const item of specialTiles) {
    for (const variantInfo of (item.variants || []).slice(0, autoSpecialVariantsPerTile)) {
      const variant = variantInfo.variant || 0;
      const img = specialVariantImages[specialKey(item.id, variant)];
      if (!img) continue;
      workCtx.clearRect(0, 0, tileSize, tileSize);
      workCtx.drawImage(img, 0, 0, tileSize, tileSize);
      tileFeatures.push({
        ref: { kind: "tij", id: item.id, variant },
        feature: extractFeature(workCtx, 0, 0, tileSize, tileSize),
        edges: extractEdges(workCtx, 0, 0, tileSize, tileSize),
      });
    }
  }
}

function extractFeature(readCtx, sx, sy, sw, sh) {
  const blocks = 4;
  const feature = [];
  const data = readCtx.getImageData(Math.max(0, sx), Math.max(0, sy), Math.max(1, sw), Math.max(1, sh)).data;
  const width = Math.max(1, sw);
  const height = Math.max(1, sh);

  for (let by = 0; by < blocks; by += 1) {
    for (let bx = 0; bx < blocks; bx += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      const x0 = Math.floor((bx / blocks) * width);
      const x1 = Math.max(x0 + 1, Math.floor(((bx + 1) / blocks) * width));
      const y0 = Math.floor((by / blocks) * height);
      const y1 = Math.max(y0 + 1, Math.floor(((by + 1) / blocks) * height));
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = (y * width + x) * 4;
          const alpha = data[i + 3] / 255;
          r += data[i] * alpha;
          g += data[i + 1] * alpha;
          b += data[i + 2] * alpha;
          count += alpha;
        }
      }
      const divisor = count || 1;
      feature.push(r / divisor, g / divisor, b / divisor);
    }
  }
  return feature;
}

function extractEdges(readCtx, sx, sy, sw, sh) {
  const data = readCtx.getImageData(Math.max(0, sx), Math.max(0, sy), Math.max(1, sw), Math.max(1, sh)).data;
  const width = Math.max(1, sw);
  const height = Math.max(1, sh);
  const segments = 4;

  function averageRect(x0, y0, x1, y1) {
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = (y * width + x) * 4;
        const alpha = data[i + 3] / 255;
        r += data[i] * alpha;
        g += data[i + 1] * alpha;
        b += data[i + 2] * alpha;
        count += alpha;
      }
    }
    const divisor = count || 1;
    return [r / divisor, g / divisor, b / divisor];
  }

  function horizontal(y0, y1) {
    const values = [];
    for (let i = 0; i < segments; i += 1) {
      const x0 = Math.floor((i / segments) * width);
      const x1 = Math.max(x0 + 1, Math.floor(((i + 1) / segments) * width));
      values.push(...averageRect(x0, y0, x1, y1));
    }
    return values;
  }

  function vertical(x0, x1) {
    const values = [];
    for (let i = 0; i < segments; i += 1) {
      const y0 = Math.floor((i / segments) * height);
      const y1 = Math.max(y0 + 1, Math.floor(((i + 1) / segments) * height));
      values.push(...averageRect(x0, y0, x1, y1));
    }
    return values;
  }

  return {
    top: horizontal(0, 1),
    right: vertical(width - 1, width),
    bottom: horizontal(height - 1, height),
    left: vertical(0, 1),
  };
}

function vectorDistance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return sum / a.length;
}

function rankedTilesForFeature(feature) {
  const ranked = tileFeatures.map((item) => ({
    ...item,
    score: vectorDistance(feature, item.feature),
  }));
  ranked.sort((a, b) => a.score - b.score);
  return ranked.slice(0, candidateCount);
}

function neighborEdgeCost(tile, selected, x, y) {
  let cost = 0;
  let count = 0;
  const left = x > 0 ? selected[y * map.width + x - 1] : null;
  const up = y > 0 ? selected[(y - 1) * map.width + x] : null;
  const right = x < map.width - 1 ? selected[y * map.width + x + 1] : null;
  const down = y < map.height - 1 ? selected[(y + 1) * map.width + x] : null;

  if (left) {
    cost += vectorDistance(left.edges.right, tile.edges.left);
    count += 1;
  }
  if (up) {
    cost += vectorDistance(up.edges.bottom, tile.edges.top);
    count += 1;
  }
  if (right) {
    cost += vectorDistance(tile.edges.right, right.edges.left);
    count += 1;
  }
  if (down) {
    cost += vectorDistance(tile.edges.bottom, down.edges.top);
    count += 1;
  }
  return count ? cost / count : 0;
}

function chooseBestContinuousTile(candidates, selected, x, y) {
  let best = candidates[0];
  let bestEnergy = Infinity;
  const baseScore = Math.max(1, candidates[0].score);

  for (const tile of candidates) {
    const imageCost = tile.score / baseScore;
    const edgeCost = neighborEdgeCost(tile, selected, x, y) / 1200;
    const energy = imageCost + edgeCost * continuityWeight;
    if (energy < bestEnergy) {
      best = tile;
      bestEnergy = energy;
    }
  }
  return best;
}

function resizeMap(width, height) {
  const oldCells = map.cells;
  const oldWidth = map.width;
  const oldHeight = map.height;
  map.width = Math.max(4, Math.min(128, Number(width) || 15));
  map.height = Math.max(4, Math.min(128, Number(height) || 20));
  map.cells = [];

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const old = x < oldWidth && y < oldHeight ? oldCells[y * oldWidth + x] : null;
      map.cells.push(normalizeCell(old));
    }
  }

  gridColsInput.value = map.width;
  gridRowsInput.value = map.height;
  canvas.width = map.width * tileSize;
  canvas.height = map.height * tileSize;
  draw();
}

function getCell(x, y) {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
  return normalizeCell(map.cells[y * map.width + x]);
}

function clearMap() {
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      map.cells[y * map.width + x] = makeCell();
    }
  }
  draw();
}

function fitGridToImageLayer() {
  if (!imageLayer) return;
  const width = Math.max(4, Math.min(128, Math.ceil((imageLayer.width || tileSize) / tileSize)));
  const height = Math.max(4, Math.min(128, Math.ceil((imageLayer.height || tileSize) / tileSize)));
  resizeMap(width, height);
  imageLayer.draw = {
    x: 0,
    y: 0,
    width: map.width * tileSize,
    height: map.height * tileSize,
  };
  draw();
}

function syncAlignFromInputs() {
  align.x = Number(offsetXInput.value) || 0;
  align.y = Number(offsetYInput.value) || 0;
  align.scale = Math.max(0.05, Number(scaleInput.value) || 1);
  align.alpha = Math.max(0, Math.min(1, Number(alphaInput.value) || 0));
}

function syncAlignToInputs() {
  offsetXInput.value = Math.round(align.x);
  offsetYInput.value = Math.round(align.y);
  scaleInput.value = Number(align.scale.toFixed(3));
  alphaInput.value = Number(align.alpha.toFixed(2));
}

function fitImage() {
  if (!sourceImage) return;
  const scaleX = canvas.width / sourceImage.width;
  const scaleY = canvas.height / sourceImage.height;
  align.scale = Math.min(scaleX, scaleY);
  align.x = Math.round((canvas.width - sourceImage.width * align.scale) / 2);
  align.y = Math.round((canvas.height - sourceImage.height * align.scale) / 2);
  syncAlignToInputs();
  draw();
}

function resetAlign() {
  align.x = 0;
  align.y = 0;
  align.scale = 1;
  align.alpha = 0.45;
  syncAlignToInputs();
  draw();
}

function drawTile(targetCtx, ref, x, y) {
  if (!ref) return;
  if (ref.kind === "tij" || ref.kind === "special") {
    const item = specialTiles.find((source) => source.id === ref.id);
    const variant = ref.variant || 0;
    const img = specialVariantImages[specialKey(ref.id, variant)] || specialImages[ref.id];
    if (!item || !img) return;
    const anchorX = item.anchorX || 0;
    const anchorY = item.anchorY || Math.max(0, (item.height || img.height) - tileSize);
    targetCtx.drawImage(img, x - anchorX, y - anchorY, item.width || img.width, item.height || img.height);
    return;
  }
  const img = tilesets[ref.tileset];
  if (!img) return;
  const source = baseTilesets.find((item) => item.id === ref.tileset);
  const columns = source ? source.columns || 8 : 8;
  const srcTileW = source ? (source.tileWidth || 16) : 16;
  const srcTileH = source ? (source.tileHeight || 16) : 16;
  const sx = (ref.index % columns) * srcTileW;
  const sy = Math.floor(ref.index / columns) * srcTileH;
  targetCtx.drawImage(img, sx, sy, srcTileW, srcTileH, x, y, tileSize, tileSize);
}

function drawImageLayer() {
  if (!imageLayer || !imageLayerImage) return;
  const draw = imageLayer.draw || {};
  const x = Number(draw.x) || 0;
  const y = Number(draw.y) || 0;
  const width = Number(draw.width) || map.width * tileSize;
  const height = Number(draw.height) || map.height * tileSize;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, Number(imageLayer.opacity ?? 1)));
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(imageLayerImage, x, y, width, height);
  ctx.restore();
}

function draw() {
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (showTilesInput.checked) {
    drawImageLayer();
  }

  if (sourceImage && showImageInput.checked) {
    ctx.save();
    ctx.globalAlpha = align.alpha;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sourceImage, align.x, align.y, sourceImage.width * align.scale, sourceImage.height * align.scale);
    ctx.restore();
  }

  if (showTilesInput.checked) {
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        drawTile(ctx, getCell(x, y).base, x * tileSize, y * tileSize);
      }
    }
  }

  if (showUpperInput.checked) {
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        drawTile(ctx, getCell(x, y).upper, x * tileSize, y * tileSize);
      }
    }
  }

  if (showBlockInput.checked) drawBlocks();
  if (showGridInput.checked) drawGrid();
  drawHover();
  updateStats();
}

function drawGrid() {
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= map.width; x += 1) {
    ctx.beginPath();
    ctx.moveTo(x * tileSize + 0.5, 0);
    ctx.lineTo(x * tileSize + 0.5, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= map.height; y += 1) {
    ctx.beginPath();
    ctx.moveTo(0, y * tileSize + 0.5);
    ctx.lineTo(canvas.width, y * tileSize + 0.5);
    ctx.stroke();
  }
}

function drawBlocks() {
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      if (!getCell(x, y).block) continue;
      ctx.fillStyle = "rgba(230,55,55,0.42)";
      ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
      ctx.strokeStyle = "rgba(255,205,205,0.85)";
      ctx.strokeRect(x * tileSize + 2.5, y * tileSize + 2.5, tileSize - 5, tileSize - 5);
    }
  }
}

function drawHover() {
  if (hover.x < 0 || hover.y < 0) return;
  if (multiSelection && !selectedSpecial && toolSelect.value === "paint") {
    const grid = multiSelection.grid;
    ctx.strokeStyle = activeLayer === "upper" ? "#ffd45f" : "#78d0a8";
    ctx.lineWidth = 1;
    for (let gy = 0; gy < grid.length; gy++) {
      for (let gx = 0; gx < grid[gy].length; gx++) {
        const cx = hover.x + gx;
        const cy = hover.y + gy;
        if (cx >= 0 && cy >= 0 && cx < map.width && cy < map.height) {
          ctx.globalAlpha = 0.5;
          drawTile(ctx, grid[gy][gx], cx * tileSize, cy * tileSize);
          ctx.globalAlpha = 1;
          ctx.strokeRect(cx * tileSize + 0.5, cy * tileSize + 0.5, tileSize - 1, tileSize - 1);
        }
      }
    }
    ctx.lineWidth = 2;
    ctx.strokeRect(hover.x * tileSize + 1, hover.y * tileSize + 1, multiSelection.cols * tileSize - 2, multiSelection.rows * tileSize - 2);
  } else {
    ctx.strokeStyle = activeLayer === "upper" ? "#ffd45f" : "#78d0a8";
    ctx.lineWidth = 2;
    ctx.strokeRect(hover.x * tileSize + 1, hover.y * tileSize + 1, tileSize - 2, tileSize - 2);
  }
}

function drawPalette() {
  const specialBoxW = 34;
  const specialBoxH = 42;
  const specialGap = 4;
  const specialColumns = Math.max(1, Math.floor(paletteCanvas.width / (specialBoxW + specialGap)));
  const specialCount = specialTiles.reduce((sum, item) => sum + Math.max(1, (item.variants || []).length), 0);
  const sheetW = 128;
  const labelH = 14;
  const rowGap = 4;

  // Pre-calculate display size per tileset (square cells, min 16px)
  const tilesetBoxes = baseTilesets.map((source) => {
    const cols = source.columns || 8;
    const rows = source.rows || 8;
    const cell = Math.max(8, Math.min(16, Math.floor(paletteCanvas.width / cols)));
    const dispW = cols * cell;
    const dispH = rows * cell;
    return { source, displayW: dispW, displayH: dispH, cell, totalH: dispH + labelH + rowGap };
  });

  // Pack into rows with dynamic widths
  const layout = [];
  let curRow = [];
  let curRowH = 0;
  let curX = 0;
  for (const box of tilesetBoxes) {
    if (curX + box.displayW > paletteCanvas.width && curRow.length > 0) {
      layout.push({ items: curRow, height: curRowH });
      curRow = [];
      curRowH = 0;
      curX = 0;
    }
    curRow.push(box);
    curRowH = Math.max(curRowH, box.totalH);
    curX += box.displayW;
  }
  if (curRow.length > 0) layout.push({ items: curRow, height: curRowH });

  let tilesetBlockH = 16;
  for (const row of layout) tilesetBlockH += row.height;
  const specialY = tilesetBlockH + 4;
  const neededHeight = specialY + Math.ceil(specialCount / specialColumns) * (specialBoxH + specialGap) + 8;
  if (paletteCanvas.height !== neededHeight) paletteCanvas.height = neededHeight;
  paletteCtx.clearRect(0, 0, paletteCanvas.width, paletteCanvas.height);
  paletteCtx.imageSmoothingEnabled = false;
  paletteCtx.font = "10px Microsoft YaHei, Arial";
  paletteCtx.textBaseline = "top";
  paletteHitboxes = [];

  let curY = 16;
  let globalIdx = 0;
  for (const row of layout) {
    let ox = 0;
    for (let j = 0; j < row.items.length; j++) {
      const box = row.items[j];
      const source = box.source;
      const id = source.id;
      const img = tilesets[id];
      const baseY = curY + labelH;
      if (img) {
        paletteCtx.drawImage(img, ox, baseY, box.displayW, box.displayH);
      }
      paletteCtx.fillStyle = "#d4dfdb";
      paletteCtx.fillText(`${id}`, ox + 2, curY);
      paletteCtx.strokeStyle = "rgba(255,255,255,0.22)";
      paletteCtx.strokeRect(ox + 0.5, baseY + 0.5, box.displayW - 1, box.displayH - 1);
      paletteHitboxes.push({ type: "tileset", id, x: ox, y: baseY, width: box.displayW, height: box.displayH });
      ox += box.displayW;
    }
    curY += row.height;
  }

  paletteCtx.fillStyle = "#d4dfdb";
  paletteCtx.fillText("特殊地块 .tij", 4, specialY - 12);
  let specialIndex = 0;
  for (const item of specialTiles) {
    const variants = item.variants && item.variants.length ? item.variants : [{ variant: 0 }];
    for (const variantInfo of variants) {
      const variant = variantInfo.variant || 0;
      const img = specialVariantImages[specialKey(item.id, variant)] || specialImages[item.id];
      const col = specialIndex % specialColumns;
      const row = Math.floor(specialIndex / specialColumns);
      const ox = col * (specialBoxW + specialGap);
      const oy = specialY + row * (specialBoxH + specialGap);
      paletteCtx.fillStyle = "rgba(255,255,255,0.04)";
      paletteCtx.fillRect(ox, oy, specialBoxW, specialBoxH);
      if (img) {
        const scale = Math.min(2, (specialBoxW - 6) / img.width, (specialBoxH - 16) / img.height);
        const dw = Math.max(1, Math.floor(img.width * scale));
        const dh = Math.max(1, Math.floor(img.height * scale));
        paletteCtx.drawImage(img, ox + Math.floor((specialBoxW - dw) / 2), oy + 3, dw, dh);
      }
      paletteCtx.fillStyle = "#d4dfdb";
      paletteCtx.fillText(`${item.id.replace(".tij", "")}:${variant}`, ox + 3, oy + specialBoxH - 11);
      const selected = selectedSpecial && selectedSpecial.id === item.id && (selectedSpecial.variant || 0) === variant;
      paletteCtx.strokeStyle = selected ? "#ffd45f" : "rgba(255,255,255,0.22)";
      paletteCtx.strokeRect(ox + 0.5, oy + 0.5, specialBoxW - 1, specialBoxH - 1);
      paletteHitboxes.push({ type: "tij", id: item.id, variant, x: ox, y: oy, width: specialBoxW, height: specialBoxH });
      specialIndex += 1;
    }
  }

  if (!selectedSpecial && selectedTileset) {
    const hit = paletteHitboxes.find((b) => b.type === "tileset" && b.id === selectedTileset);
    if (hit) {
      const source = baseTilesets.find((item) => item.id === selectedTileset);
      const columns = source ? source.columns || 8 : 8;
      const srcTW = source ? (source.tileWidth || 16) : 16;
      const srcTH = source ? (source.tileHeight || 16) : 16;
      const rows = source ? source.rows || 8 : 8;
      const cell = Math.floor(Math.min(hit.width / columns, hit.height / rows));
      const x = hit.x + (selectedTile % columns) * cell;
      const y = hit.y + Math.floor(selectedTile / columns) * cell;
      paletteCtx.strokeStyle = activeLayer === "upper" ? "#ffd45f" : "#78d0a8";
      paletteCtx.lineWidth = 2;
      paletteCtx.strokeRect(x + 1, y + 1, cell - 2, cell - 2);
    }
  }

  if (multiSelection && !selectedSpecial) {
    const firstRef = multiSelection.grid[0][0];
    const hit = paletteHitboxes.find((b) => b.type === "tileset" && b.id === firstRef.tileset);
    if (hit) {
      const source = baseTilesets.find((item) => item.id === firstRef.tileset);
      const columns = source ? source.columns || 8 : 8;
      const rows = source ? source.rows || 8 : 8;
      const cell = Math.floor(Math.min(hit.width / columns, hit.height / rows));
      const startCol = firstRef.index % columns;
      const startRow = Math.floor(firstRef.index / columns);
      paletteCtx.strokeStyle = "#ff6b6b";
      paletteCtx.lineWidth = 2;
      paletteCtx.setLineDash([4, 2]);
      paletteCtx.strokeRect(
        hit.x + startCol * cell + 1,
        hit.y + startRow * cell + 1,
        multiSelection.cols * cell - 2,
        multiSelection.rows * cell - 2
      );
      paletteCtx.setLineDash([]);
    }
  }

  if (paletteDrag && paletteDrag.moved) {
    const x1 = Math.min(paletteDrag.startX, paletteDrag.endX);
    const y1 = Math.min(paletteDrag.startY, paletteDrag.endY);
    const x2 = Math.max(paletteDrag.startX, paletteDrag.endX);
    const y2 = Math.max(paletteDrag.startY, paletteDrag.endY);
    paletteCtx.fillStyle = "rgba(100, 180, 255, 0.15)";
    paletteCtx.fillRect(x1, y1, x2 - x1, y2 - y1);
    paletteCtx.strokeStyle = "rgba(100, 180, 255, 0.8)";
    paletteCtx.lineWidth = 1;
    paletteCtx.strokeRect(x1 + 0.5, y1 + 0.5, x2 - x1 - 1, y2 - y1 - 1);
  }
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (canvas.width / rect.width),
    y: (event.clientY - rect.top) * (canvas.height / rect.height),
  };
}

function tileFromEvent(event) {
  const point = canvasPoint(event);
  return {
    x: Math.floor(point.x / tileSize),
    y: Math.floor(point.y / tileSize),
  };
}

function applyToolAt(x, y) {
  const tool = toolSelect.value;

  if (tool === "paint" && multiSelection && !selectedSpecial) {
    const grid = multiSelection.grid;
    for (let gy = 0; gy < grid.length; gy++) {
      for (let gx = 0; gx < grid[gy].length; gx++) {
        const cx = x + gx;
        const cy = y + gy;
        const cell = getCell(cx, cy);
        if (!cell) continue;
        const ref = grid[gy][gx];
        if (activeLayer === "base") {
          cell.base = ref;
        } else {
          cell.upper = ref;
          cell.over = true;
        }
      }
    }
    draw();
    return;
  }

  const cell = getCell(x, y);
  if (!cell) return;
  const tileRef = selectedResourceRef();

  if (tool === "block") {
    cell.block = true;
  } else if (tool === "eraseBlock") {
    cell.block = false;
  } else if (tool === "paint" && activeLayer === "base") {
    cell.base = tileRef;
  } else if (tool === "paint" && activeLayer === "upper") {
    cell.upper = tileRef;
    cell.over = true;
  } else if (tool === "eraseUpper") {
    cell.upper = null;
    cell.over = true;
  }
  draw();
}

function autoBuildFromImage() {
  if (!sourceImage) {
    stats.textContent = "自动拼图失败：请先导入参考图片。";
    return;
  }
  if (tileFeatures.length === 0) {
    stats.textContent = "自动拼图失败：瓦片候选资源还没有加载完成。";
    return;
  }
  syncAlignFromInputs();

  const work = document.createElement("canvas");
  work.width = canvas.width;
  work.height = canvas.height;
  const workCtx = work.getContext("2d", { willReadFrequently: true });
  workCtx.imageSmoothingEnabled = false;
  workCtx.fillStyle = "#000";
  workCtx.fillRect(0, 0, work.width, work.height);
  workCtx.drawImage(sourceImage, align.x, align.y, sourceImage.width * align.scale, sourceImage.height * align.scale);

  const cellCandidates = [];
  const selected = [];
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const feature = extractFeature(workCtx, x * tileSize, y * tileSize, tileSize, tileSize);
      const candidates = rankedTilesForFeature(feature);
      const pos = y * map.width + x;
      cellCandidates[pos] = candidates;
      selected[pos] = candidates[0];
    }
  }

  for (let pass = 0; pass < continuityPasses; pass += 1) {
    const reverse = pass % 2 === 1;
    const yStart = reverse ? map.height - 1 : 0;
    const yEnd = reverse ? -1 : map.height;
    const yStep = reverse ? -1 : 1;
    const xStart = reverse ? map.width - 1 : 0;
    const xEnd = reverse ? -1 : map.width;
    const xStep = reverse ? -1 : 1;

    for (let y = yStart; y !== yEnd; y += yStep) {
      for (let x = xStart; x !== xEnd; x += xStep) {
        const pos = y * map.width + x;
        selected[pos] = chooseBestContinuousTile(cellCandidates[pos], selected, x, y);
      }
    }
  }

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const best = selected[y * map.width + x];
      const cell = getCell(x, y);
      cell.base = { ...best.ref };
    }
  }
  draw();
  stats.textContent = `自动拼图完成：使用 ${tileFeatures.length} 个候选资源。`;
}

function exportMap() {
  const data = {
    id: map.id,
    title: map.title,
    width: map.width,
    height: map.height,
    tileSize,
    layers: ["base", "upper"],
    tilesets: baseTilesets.map((item) => ({
      id: item.id,
      image: item.image,
      columns: item.columns,
      tileWidth: item.tileWidth || 16,
      tileHeight: item.tileHeight || 16,
    })),
    specialTiles: specialTiles.map((item) => ({
      id: item.id,
      kind: item.kind || "tij",
      image: item.image,
      width: item.width,
      height: item.height,
      anchorX: item.anchorX || 0,
      anchorY: item.anchorY || 0,
      frameCount: item.frameCount || 1,
      variantBits: item.variantBits || 8,
      variants: item.variants || [],
    })),
    cells: map.cells.map(normalizeCell),
    imageAlign: { ...align },
    sourceImage: sourceName,
    imageLayer: imageLayer ? { ...imageLayer, draw: { ...(imageLayer.draw || {}) } } : null,
  };
  jsonBox.value = JSON.stringify(data, null, 2);
  return data;
}

function downloadJsonFile() {
  if (!jsonBox.value) exportMap();
  const blob = new Blob([jsonBox.value], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeId = String(map.id || "image-tile-map").replace(/[^\w.-]+/g, "_");
  a.href = url;
  a.download = `${safeId}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function applyMapData(data) {
  map.id = data.id || "image-tile-map";
  map.title = data.title || "图片拼瓦片地图";
  map.width = data.width || 15;
  map.height = data.height || 20;
  map.cells = (data.cells || []).map(normalizeCell);
  while (map.cells.length < map.width * map.height) map.cells.push(data.imageLayer ? makeImageLayerCell() : makeCell());
  if (data.imageAlign) Object.assign(align, data.imageAlign);
  syncAlignToInputs();
  resizeMap(map.width, map.height);
  if (data.imageLayer?.src) {
    await setImageLayerFromSource(data.imageLayer.src, data.imageLayer.name || "底层图片");
    imageLayer = {
      kind: "image",
      name: data.imageLayer.name || "底层图片",
      src: data.imageLayer.src,
      width: data.imageLayer.width || imageLayerImage.width,
      height: data.imageLayer.height || imageLayerImage.height,
      draw: data.imageLayer.draw || {
        x: 0,
        y: 0,
        width: map.width * tileSize,
        height: map.height * tileSize,
      },
      opacity: data.imageLayer.opacity ?? 1,
    };
  } else {
    imageLayer = null;
    imageLayerImage = null;
  }
  draw();
}

async function importMap() {
  const data = JSON.parse(jsonBox.value);
  await applyMapData(data);
}

function updateStats() {
  const blocked = map.cells.filter((cell) => normalizeCell(cell).block).length;
  const upperCount = map.cells.filter((cell) => normalizeCell(cell).upper).length;
  const hoverCell = getCell(hover.x, hover.y);
  stats.textContent = [
    `网格: ${map.width} x ${map.height}`,
    `画布: ${canvas.width} x ${canvas.height}`,
    `参考图: ${sourceName || "未载入"}`,
    `底图: ${imageLayer ? `${imageLayer.name || "底层图片"} (${imageLayer.width}x${imageLayer.height})` : "未载入"}`,
    `当前图层: ${activeLayer === "upper" ? "上层" : "底层"}`,
    `当前资源: ${resourceLabel(selectedResourceRef())}`,
    `资源: 基础 ${baseTilesets.length} 张，特殊 ${specialTiles.length} 类，自动候选 ${tileFeatures.length} 个`,
    `上层格: ${upperCount}`,
    `禁行格: ${blocked}`,
    `悬停: ${hover.x >= 0 ? `${hover.x}, ${hover.y}` : "-"}`,
    `悬停底层: ${hoverCell ? resourceLabel(hoverCell.base) : "-"}`,
    `悬停上层: ${hoverCell && hoverCell.upper ? resourceLabel(hoverCell.upper) : "-"}`,
    multiSelection ? `框选: ${multiSelection.cols}x${multiSelection.rows} 瓦片` : `框选: 无`,
  ].join("\n");
}

sourceImageInput.addEventListener("change", () => {
  const file = sourceImageInput.files && sourceImageInput.files[0];
  if (!file) return;
  sourceName = file.name;
  const url = URL.createObjectURL(file);
  loadImage(url).then((img) => {
    sourceImage = img;
    fitImage();
    URL.revokeObjectURL(url);
  });
});

baseImageInput.addEventListener("change", async () => {
  const file = baseImageInput.files && baseImageInput.files[0];
  if (!file) return;
  try {
    const dataUrl = await readFileAsDataUrl(file);
    await setImageLayerFromSource(dataUrl, file.name, true);
    stats.textContent = `已导入底层图片: ${file.name}`;
  } catch (error) {
    stats.textContent = `底层图片导入失败: ${error.message}`;
  }
});

applyGridButton.addEventListener("click", () => resizeMap(gridColsInput.value, gridRowsInput.value));
autoBuildButton.addEventListener("click", autoBuildFromImage);
clearMapButton.addEventListener("click", clearMap);
fitGridToBaseImageButton.addEventListener("click", fitGridToImageLayer);
clearBaseImageButton.addEventListener("click", () => {
  imageLayer = null;
  imageLayerImage = null;
  baseImageInput.value = "";
  draw();
});
fitImageButton.addEventListener("click", fitImage);
resetAlignButton.addEventListener("click", resetAlign);

layerSelect.addEventListener("change", () => {
  activeLayer = layerSelect.value;
  drawPalette();
  draw();
});

for (const input of [offsetXInput, offsetYInput, scaleInput, alphaInput]) {
  input.addEventListener("input", () => {
    syncAlignFromInputs();
    draw();
  });
}

for (const input of [showImageInput, showTilesInput, showUpperInput, showGridInput, showBlockInput]) {
  input.addEventListener("change", draw);
}

function palettePixelCoords(event) {
  const rect = paletteCanvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (paletteCanvas.width / rect.width),
    y: (event.clientY - rect.top) * (paletteCanvas.height / rect.height)
  };
}

function tileIndexAtPalette(px, py) {
  const hit = paletteHitboxes.find((box) => box.type === "tileset" && px >= box.x && py >= box.y && px < box.x + box.width && py < box.y + box.height);
  if (!hit) return null;
  const source = baseTilesets.find((item) => item.id === hit.id);
  if (!source) return null;
  const columns = source.columns || 8;
  const rows = source.rows || 8;
  const cell = Math.floor(Math.min(hit.width / columns, hit.height / rows));
  const localX = Math.floor((px - hit.x) / cell);
  const localY = Math.floor((py - hit.y) / cell);
  if (localX < 0 || localX >= columns || localY < 0 || localY >= rows) return null;
  return { tileset: hit.id, columns, rows, localX, localY, index: localY * columns + localX };
}

function specialAtPalette(px, py) {
  const hit = paletteHitboxes.find((box) => (box.type === "tij" || box.type === "special") && px >= box.x && py >= box.y && px < box.x + box.width && py < box.y + box.height);
  return hit ? { id: hit.id, variant: hit.variant || 0 } : null;
}

paletteCanvas.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  paletteCanvas.setPointerCapture(event.pointerId);
  const { x, y } = palettePixelCoords(event);
  paletteDrag = { startX: x, startY: y, endX: x, endY: y, moved: false };
});

paletteCanvas.addEventListener("pointermove", (event) => {
  if (!paletteDrag) return;
  const { x, y } = palettePixelCoords(event);
  paletteDrag.endX = x;
  paletteDrag.endY = y;
  paletteDrag.moved = true;
  drawPalette();
});

paletteCanvas.addEventListener("pointerup", (event) => {
  if (!paletteDrag) return;
  const { x, y } = palettePixelCoords(event);
  paletteDrag.endX = x;
  paletteDrag.endY = y;
  const drag = paletteDrag;
  paletteDrag = null;

  const dx = Math.abs(drag.endX - drag.startX);
  const dy = Math.abs(drag.endY - drag.startY);

  if (dx < 4 && dy < 4) {
    // Simple click
    const sp = specialAtPalette(drag.startX, drag.startY);
    if (sp) {
      selectedSpecial = sp;
      multiSelection = null;
      toolSelect.value = "paint";
    } else {
      const ti = tileIndexAtPalette(drag.startX, drag.startY);
      if (ti) {
        selectedSpecial = null;
        selectedTileset = ti.tileset;
        selectedTile = ti.index;
        multiSelection = null;
      }
    }
  } else {
    // Drag selection - select rectangle of tiles within one tileset
    const startTi = tileIndexAtPalette(drag.startX, drag.startY);
    const endTi = tileIndexAtPalette(drag.endX, drag.endY);
    if (startTi && endTi && startTi.tileset === endTi.tileset) {
      const minX = Math.min(startTi.localX, endTi.localX);
      const maxX = Math.max(startTi.localX, endTi.localX);
      const minY = Math.min(startTi.localY, endTi.localY);
      const maxY = Math.max(startTi.localY, endTi.localY);
      const grid = [];
      const source = baseTilesets.find((s) => s.id === startTi.tileset);
      const columns = source ? source.columns || 8 : 8;
      for (let gy = minY; gy <= maxY; gy++) {
        const row = [];
        for (let gx = minX; gx <= maxX; gx++) {
          row.push({ kind: "tile", tileset: startTi.tileset, index: gy * columns + gx });
        }
        grid.push(row);
      }
      multiSelection = { grid, cols: maxX - minX + 1, rows: maxY - minY + 1 };
      selectedSpecial = null;
      selectedTileset = startTi.tileset;
      selectedTile = startTi.index;
      toolSelect.value = "paint";
    }
  }
  drawPalette();
  updateStats();
});

canvas.addEventListener("pointerdown", (event) => {
  pointerDown = true;
  canvas.setPointerCapture(event.pointerId);
  lastPointer = canvasPoint(event);
  hover = tileFromEvent(event);
  if (toolSelect.value !== "pan") applyToolAt(hover.x, hover.y);
  draw();
});

canvas.addEventListener("pointermove", (event) => {
  const point = canvasPoint(event);
  hover = tileFromEvent(event);
  if (pointerDown && toolSelect.value === "pan") {
    align.x += point.x - lastPointer.x;
    align.y += point.y - lastPointer.y;
    syncAlignToInputs();
  } else if (pointerDown) {
    applyToolAt(hover.x, hover.y);
  }
  lastPointer = point;
  draw();
});

canvas.addEventListener("pointerup", (event) => {
  pointerDown = false;
  canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener("wheel", (event) => {
  if (!sourceImage) return;
  event.preventDefault();
  const point = canvasPoint(event);
  const beforeX = (point.x - align.x) / align.scale;
  const beforeY = (point.y - align.y) / align.scale;
  const factor = event.deltaY < 0 ? 1.08 : 0.92;
  align.scale = Math.max(0.05, Math.min(16, align.scale * factor));
  align.x = point.x - beforeX * align.scale;
  align.y = point.y - beforeY * align.scale;
  syncAlignToInputs();
  draw();
});

exportButton.addEventListener("click", exportMap);
downloadButton.addEventListener("click", downloadJsonFile);
copyButton.addEventListener("click", async () => {
  if (!jsonBox.value) exportMap();
  await navigator.clipboard.writeText(jsonBox.value);
});
importButton.addEventListener("click", async () => {
  try {
    await importMap();
  } catch (error) {
    stats.textContent = `导入失败: ${error.message}`;
  }
});


// --- 地图浏览器 ---
const mapCategorySelect = document.getElementById("mapCategory");
const mapListSelect = document.getElementById("mapList");
const refreshMapsBtn = document.getElementById("refreshMaps");
const loadMapBtn = document.getElementById("loadMapBtn");

let mapManifest = null;

const categoryNames = {
  jlmg: "巨龙迷宫",
  mszy: "魔兽庄园",
  sgpy: "三国平原",
  sgz: "三国志"
};

async function loadMapManifest() {
  try {
    const resp = await fetch("./maps/converted/manifest.json", { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    mapManifest = await resp.json();
    populateCategories();
  } catch (err) {
    stats.textContent = `地图清单加载失败: ${err.message}`;
  }
}

function populateCategories() {
  mapCategorySelect.innerHTML = '<option value="">选择分类...</option>';
  if (!mapManifest?.categories) return;
  for (const [key, maps] of Object.entries(mapManifest.categories)) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = `${categoryNames[key] || key} (${maps.length})`;
    mapCategorySelect.appendChild(opt);
  }
}

function populateMapList(category) {
  mapListSelect.innerHTML = "";
  if (!category || !mapManifest?.categories?.[category]) return;
  for (const entry of mapManifest.categories[category]) {
    const opt = document.createElement("option");
    opt.value = entry.path;
    opt.textContent = `${entry.id} (${entry.width}x${entry.height})`;
    mapListSelect.appendChild(opt);
  }
}

async function loadSelectedMap() {
  const mapPath = mapListSelect.value;
  if (!mapPath) {
    stats.textContent = "请先选择一个地图";
    return;
  }
  try {
    const resp = await fetch(`./${mapPath}`, { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    await applyMapData(await resp.json());
    stats.textContent = `已加载地图: ${map.title} (${map.width}x${map.height})`;
  } catch (err) {
    stats.textContent = `加载地图失败: ${err.message}`;
  }
}

mapCategorySelect.addEventListener("change", () => populateMapList(mapCategorySelect.value));
refreshMapsBtn.addEventListener("click", loadMapManifest);
loadMapBtn.addEventListener("click", loadSelectedMap);
mapListSelect.addEventListener("dblclick", loadSelectedMap);

resizeMap(map.width, map.height);
loadTilesets()
  .then(() => {
    drawPalette();
    draw();
    loadMapManifest();
  })
  .catch((error) => {
    stats.textContent = `资源加载失败: ${error.message}`;
  });
