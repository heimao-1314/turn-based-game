const TILE = 16;
const canvas = document.querySelector('#canvas');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;
const viewport = document.querySelector('#viewport');
const select = document.querySelector('#mapSelect');
const search = document.querySelector('#search');
const info = document.querySelector('#info');
const statusEl = document.querySelector('#status');
const gridEl = document.querySelector('#grid');
const animEl = document.querySelector('#anim');
const actorToggleEl = document.querySelector('#actorToggle');
const collisionEl = document.querySelector('#collision');
const occlusionEl = document.querySelector('#occlusion');

let maps = [];
let byId = new Map();
let byKey = new Map();
let areas = {};
let worldMap = { nodes: [], edges: [] };
let worldNames = {};
let calibratedMapPoints = {};
let externalTiles = {};
let baseSheets = [];
let mapArt = {};
let current = null;
let viewMode = 'map';
let diagramHits = [];
let scale = 2;
let tick = 0;
let objectUrls = [];
let chj53 = null;
let actor = null;
let actorSpawnOverride = null;
let teleporting = false;
const keys = new Set();
const CANVAS_FONT = '"Microsoft YaHei", "SimHei", "Noto Sans CJK SC", sans-serif';
const TITLE_OVERRIDES = { 'jlmg/401.sj': '\u7eff\u8272\u5723\u5730' };
function applyTitleOverrides(mapData) {
  for (const m of mapData.maps || []) {
    if (TITLE_OVERRIDES[m.key]) { m.title = TITLE_OVERRIDES[m.key]; m.describe = TITLE_OVERRIDES[m.key]; }
  }
  for (const area of Object.values(mapData.areas || {})) {
    for (const n of area.nodes || []) if (TITLE_OVERRIDES[n.key]) n.title = TITLE_OVERRIDES[n.key];
  }
}

const actionMap = {
  down:  { idle: 0, walk: 1, flip: false, dx: 0, dy: 1 },
  up:    { idle: 2, walk: 3, flip: false, dx: 0, dy: -1 },
  left:  { idle: 4, walk: 5, flip: false, dx: -1, dy: 0 },
  right: { idle: 4, walk: 5, flip: true, dx: 1, dy: 0 }
};

const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function u16(b, off) { return b[off] | (b[off + 1] << 8); }
function blobUrl(bytes, type = 'image/png') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  objectUrls.push(url); return url;
}
function blobUrlNoTrack(bytes, type = 'image/png') {
  return URL.createObjectURL(new Blob([bytes], { type }));
}
function b64ToUrl(b64) {
  const bin = atob(b64); const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return blobUrl(arr);
}

async function loadChjSprite(url) {
  const b = new Uint8Array(await fetch(url).then(r => r.arrayBuffer()));
  const frameW = b[2], frameH = b[3], actionCount = b[6];
  const offsets = Array.from(b.slice(7, 7 + actionCount + 1));
  const tableLen = b[7 + actionCount];
  const frameTableStart = 8 + actionCount;
  const frameTable = Array.from(b.slice(frameTableStart, frameTableStart + tableLen));
  const imageOffset = frameTableStart + tableLen;
  const image = await loadImage(blobUrlNoTrack(b.slice(imageOffset)));
  const actions = [];
  for (let i = 0; i < actionCount; i++) {
    actions.push(frameTable.slice(offsets[i], offsets[i + 1]));
  }
  return { frameW, frameH, actionCount, offsets, frameTable, actions, image };
}

function resetActor() {
  if (!current) return;
  const start = actorSpawnOverride || current.move || { x: Math.floor(current.width / 2), y: Math.floor(current.height / 2) };
  actorSpawnOverride = null;
  actor = {
    tileX: Math.max(0, Math.min(current.width - 1, start.x ?? 0)),
    tileY: Math.max(0, Math.min(current.height - 1, start.y ?? 0)),
    x: 0, y: 0, fromX: 0, fromY: 0, targetX: 0, targetY: 0,
    direction: 'down', moving: false, stepProgress: 1, frameTick: 0, idleTick: 0,
    lastMoveDir: null,
    blockedFlash: 0
  };
  actor.x = actor.fromX = actor.targetX = actor.tileX * TILE;
  actor.y = actor.fromY = actor.targetY = actor.tileY * TILE;
}

function cellFlags(x, y) {
  if (!current || x < 0 || y < 0 || x >= current.width || y >= current.height) return 0;
  return current.cells[(y * current.width + x) * 4 + 3] & 0xff;
}

function canStep(dir) {
  if (!current || !actor) return false;
  const d = actionMap[dir];
  const tx = actor.tileX + d.dx, ty = actor.tileY + d.dy;
  if (tx < 0 || ty < 0 || tx >= current.width || ty >= current.height) return false;
  // 原客户端移动判定看“目标格朝向来源的边”：
  // 上移看目标格下边 bit3；下移看目标格上边 bit0；
  // 左移看目标格右边 bit2；右移看目标格左边 bit1。
  const f = cellFlags(tx, ty);
  if (dir === 'up') return !!(f & 8);
  if (dir === 'down') return !!(f & 1);
  if (dir === 'left') return !!(f & 4);
  if (dir === 'right') return !!(f & 2);
  return false;
}

function wantedDirection() {
  if (keys.has('ArrowUp') || keys.has('w')) return 'up';
  if (keys.has('ArrowDown') || keys.has('s')) return 'down';
  if (keys.has('ArrowLeft') || keys.has('a')) return 'left';
  if (keys.has('ArrowRight') || keys.has('d')) return 'right';
  return null;
}

function startStep(dir) {
  actor.direction = dir;
  if (!canStep(dir)) {
    actor.blockedFlash = 5;
    return;
  }
  const d = actionMap[dir];
  actor.lastMoveDir = dir;
  actor.fromX = actor.x; actor.fromY = actor.y;
  actor.tileX += d.dx; actor.tileY += d.dy;
  actor.targetX = actor.tileX * TILE; actor.targetY = actor.tileY * TILE;
  actor.stepProgress = 0; actor.moving = true;
}

function updateActor() {
  if (!actor || !actorToggleEl.checked || teleporting) return;
  const dir = wantedDirection();
  if (!actor.moving && dir) startStep(dir);
  if (actor.moving) {
    actor.stepProgress = Math.min(1, actor.stepProgress + 0.045);
    actor.x = actor.fromX + (actor.targetX - actor.fromX) * actor.stepProgress;
    actor.y = actor.fromY + (actor.targetY - actor.fromY) * actor.stepProgress;
    actor.frameTick += 0.48;
    actor.idleTick = 0;
    if (actor.stepProgress >= 1) {
      actor.x = actor.targetX; actor.y = actor.targetY; actor.moving = false;
      triggerTeleportIfNeeded();
    }
  } else {
    actor.frameTick = 0;
    actor.idleTick += 0.18;
  }
  if (actor.blockedFlash > 0) actor.blockedFlash--;
}

function teleportPointForActorPosition(moveDir = actor?.lastMoveDir) {
  if (!current || !actor) return null;
  return (current.points || []).find(p =>
    p.x === actor.tileX &&
    p.y === actor.tileY &&
    teleportDirMatchesMove(p.dir, moveDir) &&
    (current.teleports || []).some(t => t.dir === p.dir)
  ) || null;
}

function teleportDirMatchesMove(dir, moveDir) {
  if (moveDir === 'up') return dir >= 50 && dir < 60;
  if (moveDir === 'down') return dir >= 60 && dir < 80;
  if (moveDir === 'left') return dir >= 80 && dir < 120;
  if (moveDir === 'right') return dir >= 120;
  return false;
}

function oppositeDirectionForTeleportCode(code) {
  if (code === 50) return 'down';
  if (code === 60) return 'up';
  if (code === 80) return 'right';
  if (code === 120) return 'left';
  return actor?.direction || 'down';
}

async function triggerTeleportIfNeeded(forcedPoint = null) {
  if (!current || !actor || teleporting) return;
  const point = forcedPoint || teleportPointForActorPosition();
  if (!point) return;
  const code = point.dir;
  const tele = (current.teleports || []).find(t => t.dir === code);
  if (!tele) return;
  const target = byId.get(tele.to_id);
  if (!target) return;
  teleporting = true;
  statusEl.textContent = `传送中：${current.title} (${point.x},${point.y}/${point.s}) → ${target.title}`;
  keys.clear();
  actorSpawnOverride = {
    x: Math.max(0, Number(tele.to_x ?? 0)),
    y: Math.max(0, Number(tele.to_y ?? 0))
  };
  const nextDir = oppositeDirectionForTeleportCode(code);
  select.value = target.key;
  await openMap(target);
  if (actor) actor.direction = nextDir;
  if (actor) actor.lastMoveDir = null;
  teleporting = false;
}

function currentActorFrame() {
  const map = actionMap[actor.direction] || actionMap.down;
  const action = actor.moving ? map.walk : map.idle;
  let frames = chj53?.actions?.[action];
  if (!frames || frames.length === 0) frames = chj53?.actions?.[0] || [0];
  const raw = frames[Math.floor((actor.moving ? actor.frameTick : actor.idleTick) / 8) % frames.length] ?? 0;
  return { index: raw >= 128 ? raw - 128 : raw, flip: raw >= 128 || map.flip };
}

function drawActor() {
  if (!actorToggleEl.checked || !actor || !chj53) return;
  const { index, flip } = currentActorFrame();
  const sx = index * chj53.frameW;
  const footX = actor.x + 8, footY = actor.y + 16;
  const dx = Math.round(footX + 8 - chj53.frameW / 2);
  const dy = Math.round(footY - chj53.frameH);
  if (actor.blockedFlash > 0) {
    ctx.fillStyle = 'rgba(255,40,40,.35)';
    ctx.fillRect(actor.tileX * TILE, actor.tileY * TILE, TILE, TILE);
  }
  ctx.save();
  if (flip) {
    ctx.translate(dx + chj53.frameW, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(chj53.image, sx, 0, chj53.frameW, chj53.frameH, 0, 0, chj53.frameW, chj53.frameH);
  } else {
    ctx.drawImage(chj53.image, sx, 0, chj53.frameW, chj53.frameH, dx, dy, chj53.frameW, chj53.frameH);
  }
  ctx.restore();
}

function parseTileObject(bytes, off, len, externalId = -1) {
  const frames = (bytes[off] & 0x0f) + 1;
  const animated = (bytes[off] & 0x10) >= 16;
  const mapping = bytes.slice(off + 2, off + 2 + 20 * frames);
  const png = bytes.slice(off + 2 + 20 * frames, off + len);
  return { frames, animated, mapping, imagePromise: loadImage(blobUrl(png)), image: null, externalId };
}
async function parseMap(map) {
  objectUrls.forEach(URL.revokeObjectURL); objectUrls = [];
  const b = hexToBytes(map.hex);
  const tilesetCount = b[2] & 0x0f;
  const tilesetTable = u16(b, 4);
  const tileAliasCount = b[6] & 0xff;
  const tileAliasTable = u16(b, 8);
  const overlayCount = b[10] & 0xff;
  const overlayTable = u16(b, 12);
  const pointsCount = b[14] & 0xff;
  const pointsTable = u16(b, 16);
  const width = b[18] & 0xff;
  const height = b[19] & 0xff;
  const cells = b.slice(20, 20 + width * height * 4);

  const tilesets = [];
  for (let i = 0; i < tilesetCount; i++) {
    const off = u16(b, tilesetTable + i * 4);
    const lenOrId = u16(b, tilesetTable + i * 4 + 2);
    if (off === 0) {
      const ext = externalTiles[String(lenOrId)];
      if (ext) {
        const t = { frames: ext.frames, animated: ext.animated, mapping: Uint8Array.from(ext.mapping), imagePromise: loadImage(b64ToUrl(ext.pngBase64)), image: null, externalId: lenOrId };
        tilesets.push(t);
      } else {
        tilesets.push(null);
      }
    } else {
      tilesets.push(parseTileObject(b, off, lenOrId));
    }
  }
  for (const t of tilesets) if (t) t.image = await t.imagePromise;

  const aliases = [];
  let maxAlias = 0;
  for (let i = 0; i < tileAliasCount; i++) {
    const frames = b[tileAliasTable + i * 3] & 0xff;
    const base = u16(b, tileAliasTable + i * 3 + 1);
    aliases.push({ frames, base });
    if (base > maxAlias) maxAlias = base;
  }
  const extraSheets = [];
  if (maxAlias >= 192) {
    const count = Math.ceil((maxAlias - 192 + 1) / 16);
    let p = tileAliasTable + tileAliasCount * 3;
    for (let i = 0; i < count; i++) {
      const off = u16(b, p + i * 4); const len = u16(b, p + i * 4 + 2);
      extraSheets.push(await loadImage(blobUrl(b.slice(off, off + len))));
    }
  }
  const overlays = [];
  if (overlayCount > 0) {
    const imgCache = new Map();
    for (let i = 0; i < overlayCount; i++) {
      const p = overlayTable + i * 12;
      const off = u16(b, p); const len = u16(b, p + 2);
      let img = imgCache.get(off);
      if (!img) { img = await loadImage(blobUrl(b.slice(off, off + len))); imgCache.set(off, img); }
      overlays.push({ img, x: u16(b, p + 4), y: u16(b, p + 6), w: b[p + 8], h: b[p + 9], show: b[p + 10] !== 0 });
    }
  }
  const points = [];
  for (let i = 0; i < pointsCount; i++) {
    const p = pointsTable + i * 4;
    const s = b[p + 2] | (b[p + 3] << 8);
    points.push({ x: b[p], y: b[p + 1], s, dir: Math.floor(s / 100) });
  }
  return { ...map, bytes: b, width, height, cells, tilesets, aliases, extraSheets, overlays, points };
}

function draw8(img, sx8, dx, dy, half) {
  ctx.drawImage(img, sx8 * 8, 0, 8, 8, dx + (half % 2) * 8, dy + Math.floor(half / 2) * 8, 8, 8);
}
function drawAutotile(t, variant, dx, dy) {
  if (!t || !t.image) return;
  const frame = t.frames > 0 ? (animEl.checked ? Math.floor(tick / (t.animated ? 2 : 4)) % t.frames : 0) : 0;
  const flags = variant & 0xff;
  const b0 = !!(flags & 1), b1 = !!(flags & 2), b2 = !!(flags & 4), b3 = !!(flags & 8);
  const b4 = !!(flags & 0x10), b5 = !!(flags & 0x20), b6 = !!(flags & 0x40), b7 = !!(flags & 0x80);
  const idx = [
    b1 && b0 ? 12 : (b1 && !b0 ? 4 : (!b1 && b0 ? 8 : (!b1 && !b0 && b4 ? 16 : 0))),
    b2 && b0 ? 13 : (b2 && !b0 ? 5 : (!b2 && b0 ? 9 : (!b2 && !b0 && b5 ? 17 : 1))),
    b1 && b3 ? 14 : (b1 && !b3 ? 6 : (!b1 && b3 ? 10 : (!b1 && !b3 && b6 ? 18 : 2))),
    b2 && b3 ? 15 : (b2 && !b3 ? 7 : (!b2 && b3 ? 11 : (!b2 && !b3 && b7 ? 19 : 3)))
  ];
  for (let h = 0; h < 4; h++) draw8(t.image, t.mapping[frame * 20 + idx[h]], dx, dy, h);
}
function drawAlias(parsed, aliasIndex, dx, dy) {
  if (aliasIndex >= 255 || !parsed.aliases[aliasIndex]) return;
  const a = parsed.aliases[aliasIndex];
  let tile = a.base;
  if (a.frames > 0 && animEl.checked) tile += Math.floor(tick / 2) % (a.frames + 1);
  if (tile >= 192) {
    const n = tile - 192; const sheet = parsed.extraSheets[Math.floor(n / 16)];
    if (sheet) ctx.drawImage(sheet, (n % 16) * 16, 0, 16, 16, dx, dy, 16, 16);
  } else {
    const sheet = baseSheets[tile >> 6];
    if (sheet) ctx.drawImage(sheet, ((tile & 0x3f) & 7) * 16, ((tile & 0x3f) >> 3) * 16, 16, 16, dx, dy, 16, 16);
  }
}
function drawMap() {
  if (!current) return;
  diagramHits = [];
  tick++;
  canvas.width = current.width * TILE;
  canvas.height = current.height * TILE;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);

  const high = [];
  for (let y = 0; y < current.height; y++) {
    for (let x = 0; x < current.width; x++) {
      const p = (y * current.width + x) * 4;
      const c0 = current.cells[p], c1 = current.cells[p + 1], c2 = current.cells[p + 2], c3 = current.cells[p + 3];
      const dx = x * TILE, dy = y * TILE;
      const ts = c0 & 0x0f;
      if (ts < 15) drawAutotile(current.tilesets[ts], c1, dx, dy);
      else drawAlias(current, c1, dx, dy);
      if (c3 & 0x80) high.push([x, y, c2]); else drawAlias(current, c2, dx, dy);
    }
  }
  drawActor();
  for (const [x, y, a] of high) drawAlias(current, a, x * TILE, y * TILE);
  for (const o of current.overlays) if (o.show) ctx.drawImage(o.img, 0, 0, o.w || o.img.width, o.h || o.img.height, o.x, o.y, o.w || o.img.width, o.h || o.img.height);

  // 飞图/传送点标注
  ctx.font = '10px sans-serif'; ctx.textBaseline = 'top';
  drawTeleportPoints();
  if (current.move) markPoint(current.move.x, current.move.y, '#35e28a', 'F');
  if (occlusionEl.checked) drawOcclusion();
  if (collisionEl.checked) drawCollision();
  if (gridEl.checked) drawGrid();
}

function renderCurrentView() {
  if (viewMode === 'world') { scale = 1; return drawWorldMap(); }
  if (viewMode === 'area') { scale = 1; return drawAreaMap(current?.world); }
  return drawMap();
}

const areaArtConfig = {
  sgz: { img: 'sgz', scale: 3, margin: 34, title: '闪光镇', offsetX: -105, offsetY: -41 },
  sgpy: { img: 'sgpy', scale: 3, margin: 34, title: '闪光平原', offsetX: -25, offsetY: -25 },
  jlmg: { img: 'jlmg', scale: 3, margin: 34, title: '精灵迷宫', offsetX: 39, offsetY: -1 }
};

const worldArtNodes = [
  { world: 'sgz', name: '闪光镇', x: 87.4, y: 119.4 },
  { world: 'sgpy', name: '闪光平原', x: 111.4, y: 143.4 },
  { world: 'jlmg', name: '精灵迷宫', x: 135.4, y: 143.4 }
];

function drawPanelBackground(width, height, title, subtitle) {
  const g = ctx.createLinearGradient(0, 0, 0, height);
  g.addColorStop(0, '#111827');
  g.addColorStop(.55, '#07111b');
  g.addColorStop(1, '#06080d');
  ctx.fillStyle = g; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(86,177,255,.05)';
  for (let x = -height; x < width; x += 72) {
    ctx.beginPath(); ctx.moveTo(x, height); ctx.lineTo(x + height, 0); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(120,190,255,.08)'; ctx.stroke();
  }
  ctx.fillStyle = '#f6fbff'; ctx.font = `bold 22px ${CANVAS_FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(title, 22, 34);
  if (subtitle) { ctx.fillStyle = '#9fb1c9'; ctx.font = `12px ${CANVAS_FONT}`; ctx.fillText(subtitle, 24, 55); }
}

function drawImageFrame(img, x, y, w, h) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#020407'; ctx.fillRect(x - 12, y - 12, w + 24, h + 24);
  ctx.restore();
  ctx.strokeStyle = '#2d425f'; ctx.lineWidth = 2; ctx.strokeRect(x - 12.5, y - 12.5, w + 25, h + 25);
  ctx.drawImage(img, x, y, w, h);
}

function drawCallout(x, y, text, active = false, align = 'center') {
  ctx.save();
  ctx.font = active ? `bold 13px ${CANVAS_FONT}` : `12px ${CANVAS_FONT}`;
  const pad = 6;
  const tw = ctx.measureText(text).width;
  const bx = align === 'left' ? x + 13 : align === 'right' ? x - tw - pad * 2 - 13 : x - tw / 2 - pad;
  const by = y - 35;
  ctx.fillStyle = active ? 'rgba(255,204,51,.94)' : 'rgba(15,24,38,.88)';
  ctx.strokeStyle = active ? '#fff1a8' : '#3b577c';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(bx, by, tw + pad * 2, 22, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = active ? '#211500' : '#eaf2ff';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(text, bx + pad, by + 11);
  ctx.restore();
}

function artPointForAreaNode(world, node) {
  const cfg = areaArtConfig[world];
  if (!cfg) return null;
  return { x: node.x * 24 + cfg.offsetX, y: node.y * 24 + cfg.offsetY };
}


function calibratedArea(world) {
  return calibratedMapPoints?.areas?.[world] || null;
}
function calibratedPoint(world, key) {
  return calibratedArea(world)?.maps?.[key] || null;
}
function displayMapTitle(key, fallback = '') {
  const m = byKey.get(key);
  return m?.title || fallback || key;
}
function drawCalibratedEdges(world, artX, artY, scale) {
  const cal = calibratedArea(world);
  if (!cal?.edges?.length || !cal?.maps) return 0;
  let drawn = 0;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const e of cal.edges) {
    const a = cal.maps[e.from], b = cal.maps[e.to];
    if (!a || !b) continue;
    const ax = artX + a.x * scale, ay = artY + a.y * scale;
    const bx = artX + b.x * scale, by = artY + b.y * scale;
    const active = current && (current.key === e.from || current.key === e.to);
    const color = active ? 'rgba(255,230,90,.95)' : 'rgba(120,205,255,.58)';
    ctx.strokeStyle = 'rgba(0,0,0,.72)'; ctx.lineWidth = active ? 6 : 4;
    if (e.from === e.to) {
      ctx.beginPath(); ctx.arc(ax + 18, ay - 18, 18, 0, Math.PI * 1.75); ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = active ? 3 : 2;
      ctx.beginPath(); ctx.arc(ax + 18, ay - 18, 18, 0, Math.PI * 1.75); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = active ? 3 : 2;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }
    drawn++;
  }
  ctx.restore();
  return drawn;
}
function drawAreaMap(world) {
  diagramHits = [];
  const area = areas[world];
  const cfg = areaArtConfig[world];
  const img = cfg && mapArt[cfg.img];
  if (!area || !cfg || !img) return drawMap();

  const margin = cfg.margin, s = cfg.scale;
  const artX = margin, artY = 78;
  const artW = img.width * s, artH = img.height * s;
  canvas.width = artW + margin * 2;
  canvas.height = artH + artY + 70;
  ctx.imageSmoothingEnabled = false;
  drawPanelBackground(canvas.width, canvas.height, `${cfg.title} \u533a\u57df\u5730\u56fe`, '\u5df2\u5e94\u7528\u5bfc\u51fa\u7684\u771f\u5b9e\u50cf\u7d20\u70b9\u4f4d\uff1b\u70b9\u51fb\u8282\u70b9\u8fdb\u5165\u5bf9\u5e94\u5730\u56fe');
  drawImageFrame(img, artX, artY, artW, artH);

  const cal = calibratedArea(world);
  const edgeCount = drawCalibratedEdges(world, artX, artY, s);
  const nodeEntries = cal?.maps ? Object.entries(cal.maps) : area.nodes.map(n => [n.key, { ...n, ...artPointForAreaNode(world, n) }]);

  for (const [key, point] of nodeEntries) {
    if (!point || point.x == null || point.y == null) continue;
    if (point.x < 0 || point.y < 0 || point.x > img.width || point.y > img.height) continue;
    const x = artX + point.x * s, y = artY + point.y * s;
    const active = current && current.key === key;
    const m = byKey.get(key);
    const title = point.title || m?.title || key;
    ctx.save();
    ctx.fillStyle = active ? 'rgba(255,210,54,.82)' : 'rgba(55,230,140,.50)';
    ctx.strokeStyle = active ? '#fff3a6' : '#12331e';
    ctx.lineWidth = active ? 4 : 2;
    ctx.beginPath(); ctx.arc(x, y, active ? 18 : 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x - 16, y); ctx.lineTo(x + 16, y); ctx.moveTo(x, y - 16); ctx.lineTo(x, y + 16); ctx.stroke();
    if (active) drawCallout(x, y, title, true);
    ctx.restore();
    diagramHits.push({ type: 'map', key, x, y, r: 22 });
  }

  const legendY = canvas.height - 38;
  ctx.fillStyle = '#9fb1c9'; ctx.font = `12px ${CANVAS_FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(`\u8282\u70b9\uff1a${nodeEntries.length}  \u4f20\u9001\u7ebf\uff1a${edgeCount || area.edges.length}  \u5f53\u524d\uff1a${current?.title || '-'}`, 24, legendY);
}

function drawWorldMap() {
  diagramHits = [];
  const img = mapArt.world;
  if (!img) return;
  const s = 3;
  const artX = 90, artY = 82;
  const artW = img.width * s, artH = img.height * s;
  canvas.width = artW + 180; canvas.height = artH + 150;
  ctx.imageSmoothingEnabled = false;
  drawPanelBackground(canvas.width, canvas.height, '世界地图', '三个绿色入口从左到右：闪光镇 → 闪光平原 → 精灵迷宫；点击绿色点进入区域地图');
  drawImageFrame(img, artX, artY, artW, artH);

  for (const n of worldArtNodes) {
    const x = artX + n.x * s, y = artY + n.y * s;
    const wm = (worldMap.nodes || []).find(m => m.world === n.world) || { count: 0 };
    const active = current && current.world === n.world;
    ctx.save();
    ctx.fillStyle = active ? 'rgba(255,204,51,.30)' : 'rgba(53,226,138,.15)';
    ctx.strokeStyle = active ? '#fff1a6' : '#54efa0'; ctx.lineWidth = active ? 4 : 3;
    ctx.beginPath(); ctx.arc(x, y, active ? 24 : 19, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    drawCallout(x, y, `${n.name} / ${wm.count || 0}图`, active, n.world === 'sgz' ? 'right' : 'left');
    ctx.restore();
    diagramHits.push({ type: 'world', world: n.world, x, y, r: 28 });
  }
}
function markPoint(tx, ty, color, label) {
  if (tx == null || ty == null) return;
  const x = tx * TILE + 8, y = ty * TILE + 8;
  ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#000'; ctx.fillText(label, x - 3, y - 5);
}
function markSmallPoint(tx, ty, color, label) {
  if (tx == null || ty == null) return;
  const x = tx * TILE + 8, y = ty * TILE + 8;
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,.8)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = '7px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y - 7);
  ctx.restore();
}
function markEdgeDir(dir, color, label) {
  const w = current.width, h = current.height;
  let x = Math.floor(w / 2), y = Math.floor(h / 2);
  if (dir === 50) y = 0; else if (dir === 60) y = h - 1; else if (dir === 80) x = 0; else if (dir === 120) x = w - 1;
  else if (dir === 70) { x = 0; y = h - 1; } else if (dir === 90) { x = 0; y = 0; } else if (dir === 110) { x = w - 1; y = 0; } else if (dir === 130) { x = w - 1; y = h - 1; }
  markPoint(x, y, color, label);
}
function drawTeleportPoints() {
  const teleDirs = new Set((current.teleports || []).map(t => t.dir));
  const labels = new Map();
  for (const p of current.points || []) {
    if (!teleDirs.has(p.dir)) continue;
    const key = `${p.x},${p.y}`;
    labels.set(key, labels.has(key) ? `${labels.get(key)}/${p.dir}` : String(p.dir));
  }
  for (const [key, label] of labels.entries()) {
    const [x, y] = key.split(',').map(Number);
    markSmallPoint(x, y, '#ffcc33', label);
  }
}
function drawOcclusion() {
  ctx.save();
  ctx.fillStyle = 'rgba(80,160,255,.28)';
  ctx.strokeStyle = 'rgba(120,200,255,.75)';
  for (let y = 0; y < current.height; y++) {
    for (let x = 0; x < current.width; x++) {
      const p = (y * current.width + x) * 4;
      if (current.cells[p + 3] & 0x80) {
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
        ctx.strokeRect(x * TILE + .5, y * TILE + .5, TILE - 1, TILE - 1);
      }
    }
  }
  ctx.restore();
}
function drawCollision() {
  ctx.save();
  ctx.lineWidth = 2;
  ctx.font = '9px sans-serif';
  ctx.textBaseline = 'top';
  for (let y = 0; y < current.height; y++) {
    for (let x = 0; x < current.width; x++) {
      const p = (y * current.width + x) * 4;
      const f = current.cells[p + 3] & 0xff;
      const px = x * TILE, py = y * TILE;
      const open = f & 0x0f;
      if (!open) {
        ctx.fillStyle = 'rgba(255,40,40,.33)';
        ctx.fillRect(px, py, TILE, TILE);
      }
      ctx.strokeStyle = 'rgba(60,255,110,.9)';
      ctx.beginPath();
      // bit0: 上边可进入/下移目标；bit1: 左边；bit2: 右边；bit3: 下边
      if (f & 1) { ctx.moveTo(px + 4, py + 1); ctx.lineTo(px + 12, py + 1); }
      if (f & 2) { ctx.moveTo(px + 1, py + 4); ctx.lineTo(px + 1, py + 12); }
      if (f & 4) { ctx.moveTo(px + 15, py + 4); ctx.lineTo(px + 15, py + 12); }
      if (f & 8) { ctx.moveTo(px + 4, py + 15); ctx.lineTo(px + 12, py + 15); }
      ctx.stroke();
      if (f & 0x30) {
        ctx.fillStyle = 'rgba(255,210,50,.85)';
        ctx.fillText((f & 0x30).toString(16), px + 2, py + 2);
      }
    }
  }
  ctx.restore();
}
function drawGrid() {
  ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.lineWidth = 1;
  for (let x = 0; x <= canvas.width; x += TILE) { ctx.beginPath(); ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, canvas.height); ctx.stroke(); }
  for (let y = 0; y <= canvas.height; y += TILE) { ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(canvas.width, y + .5); ctx.stroke(); }
}
function applyScale() {
  canvas.style.width = `${canvas.width * scale}px`;
  canvas.style.height = `${canvas.height * scale}px`;
  const viewLabel = viewMode === 'world' ? 'World' : (viewMode === 'area' ? 'Area' : `${current?.width ?? '-'}x${current?.height ?? '-'} tiles`);
  statusEl.textContent = current ? `${viewLabel} / ${canvas.width}x${canvas.height}px / ${Math.round(scale*100)}%` : '';
}
async function openMap(map) {
  statusEl.textContent = '加载中...';
  viewMode = 'map';
  current = await parseMap(map);
  resetActor();
  renderCurrentView(); applyScale(); renderInfo();
}
function renderInfo() {
  const m = current;
  const teles = (m.teleports || []).map(t => {
    const target = byId.get(t.to_id);
    const label = (m.tns || []).find(x => x.dir === t.dir)?.label || t.dir;
    return `<div class="tele"><span class="badge">${t.dir}</span>${escapeHtml(label)} → ${target ? `<a data-id="${target.id}">${target.title}</a>` : t.to_id}<br><span class="muted">落点: ${t.to_x},${t.to_y} raw: ${escapeHtml(t.raw || '')}</span></div>`;
  }).join('') || '<span class="muted">无传送</span>';
  info.innerHTML = `<h2>${escapeHtml(m.title || m.key)}</h2>
    <div><span class="badge">${m.id ?? 'extra'}</span><span class="badge">${m.world}</span><span class="badge">${m.name}</span></div>
    <p>${escapeHtml(m.describe || '')}</p>
    <div class="muted">尺寸：${m.width} × ${m.height} tiles；飞图点：${m.move ? `${m.move.x},${m.move.y}` : '-'}</div>
    <h3>传送关系</h3>${teles}`;
  info.querySelectorAll('a[data-id]').forEach(a => a.onclick = () => selectMapById(Number(a.dataset.id)));
}
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function refreshList() {
  const q = search.value.trim().toLowerCase();
  select.innerHTML = '';
  for (const m of maps) {
    const text = `${m.id ?? ''} ${m.title} ${m.world}/${m.name}`;
    if (q && !text.toLowerCase().includes(q)) continue;
    const opt = document.createElement('option');
    opt.value = m.key; opt.textContent = `${m.id ?? 'extra'} | ${m.title} | ${m.world}/${m.name}`;
    select.appendChild(opt);
  }
}
function selectMapById(id) { const m = byId.get(id); if (m) { select.value = m.key; openMap(m); } }

select.onchange = () => openMap(byKey.get(select.value));
search.oninput = refreshList;
gridEl.onchange = renderCurrentView;
occlusionEl.onchange = renderCurrentView;
collisionEl.onchange = renderCurrentView;
actorToggleEl.onchange = renderCurrentView;
animEl.onchange = renderCurrentView;
document.querySelector('#fitBtn').onclick = () => { if (!current) return; scale = Math.max(.5, Math.min(4, Math.floor(Math.min((viewport.clientWidth-20)/canvas.width, (viewport.clientHeight-20)/canvas.height)*100)/100)); applyScale(); };
document.querySelector('#oneBtn').onclick = () => { scale = 1; applyScale(); };
document.querySelector('#mapViewBtn').onclick = () => { viewMode = 'map'; renderCurrentView(); applyScale(); };
document.querySelector('#areaViewBtn').onclick = () => { viewMode = 'area'; location.hash = 'area'; renderCurrentView(); applyScale(); };
document.querySelector('#worldViewBtn').onclick = () => { viewMode = 'world'; location.hash = 'world'; renderCurrentView(); applyScale(); };
document.querySelector('#resetActorBtn').onclick = () => { resetActor(); viewMode = 'map'; renderCurrentView(); applyScale(); };
viewport.addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); scale = Math.max(.25, Math.min(8, scale * (e.deltaY < 0 ? 1.15 : .87))); applyScale(); }, { passive: false });
canvas.addEventListener('click', e => {
  if (viewMode === 'map') return;
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * canvas.width / rect.width;
  const y = (e.clientY - rect.top) * canvas.height / rect.height;
  const hit = diagramHits.find(h => Math.hypot(x - h.x, y - h.y) <= h.r);
  if (!hit) return;
  if (hit.type === 'map') {
    const m = byKey.get(hit.key);
    if (m) openMap(m);
  } else if (hit.type === 'world') {
    const m = maps.find(m => m.world === hit.world);
    if (m) {
      current = current && current.world === hit.world ? current : null;
      openMap(m).then(() => { viewMode = 'area'; renderCurrentView(); applyScale(); });
    }
  }
});
window.addEventListener('keydown', e => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d'].includes(k)) {
    keys.add(k); e.preventDefault();
  }
});
window.addEventListener('keyup', e => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  keys.delete(k);
});

async function boot() {
  const [mapData, ext, pointData] = await Promise.all([fetch('./data/maps.json').then(r => r.json()), fetch('./data/external-tiles.json').then(r => r.json()), fetch('./data/map-points.json').then(r => r.ok ? r.json() : null).catch(() => null)]);
  applyTitleOverrides(mapData);
  maps = mapData.maps.sort((a,b) => String(a.world).localeCompare(String(b.world)) || String(a.id ?? 999999).localeCompare(String(b.id ?? 999999)));
  areas = mapData.areas || {};
  worldMap = mapData.worldMap || { nodes: [], edges: [] };
  worldNames = mapData.worldNames || {};
  externalTiles = ext;
  calibratedMapPoints = pointData || {};
  byId = new Map(maps.filter(m => m.id != null).map(m => [m.id, m]));
  byKey = new Map(maps.map(m => [m.key, m]));
  [baseSheets, chj53, mapArt] = await Promise.all([
    Promise.all(['00','01','02'].map(n => loadImage(`./assets/d/${n}.png`))),
    loadChjSprite('./assets/c/53.chj'),
    Promise.all(['world','sgz','sgpy','jlmg'].map(n => loadImage(`./assets/map-art/${n}.png`).then(img => [n, img]))).then(entries => Object.fromEntries(entries))
  ]);
  refreshList();
  if (maps[0]) { select.value = maps[0].key; await openMap(maps[0]); }
  if (location.hash === '#world') {
    viewMode = 'world'; renderCurrentView(); applyScale();
  } else if (location.hash === '#area') {
    viewMode = 'area'; renderCurrentView(); applyScale();
  }
  const loop = () => {
    if (current) {
      updateActor();
      if (viewMode === 'map' && (animEl.checked || actorToggleEl.checked)) { renderCurrentView(); applyScale(); }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
boot().catch(err => { console.error(err); statusEl.textContent = String(err?.stack || err); });

