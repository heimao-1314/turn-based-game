/**
 * 1000 玩家压力测试 - 挂机 + 移动 + 打怪
 *
 * 模拟场景：1000 个玩家在"幻影狩猎场"地图挂机打怪
 * - 70% 挂机党：原地不动，低频发心跳
 * - 20% 移动党：随机走动，中频发状态
 * - 10% 活跃党：快速移动 + 频繁打怪 + HTTP 战斗奖励
 *
 * 用法：node scripts/stress-test-1000.js [玩家数] [秒数]
 * 默认：1000 玩家，120 秒
 */
"use strict";
const http = require("http");
const crypto = require("crypto");

const PLAYER_COUNT = parseInt(process.argv[2]) || 1000;
const DURATION_SEC = parseInt(process.argv[3]) || 120;
const HOST = "127.0.0.1";
const PORT = 6588;
const MAP_NAME = "幻影狩猎场";

// 批量连接参数（防止同时 1000 个 TCP 握手把服务器打崩）
const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 200;

// 行为频率配置
const TICK_MS = 1000;
const AFK_HEARTBEAT_SEC = 3;       // 挂机心跳间隔
const MOVE_SEND_SEC = 1;           // 移动发状态间隔
const ACTIVE_SEND_SEC = 1;         // 活跃发状态间隔
const SAVE_INTERVAL_SEC = 30;      // 存档间隔
const BATTLE_DURATION_SEC = 8;     // 一场战斗时长
const BATTLE_IDLE_SEC = 3;         // 战斗间歇

// ============================================================
// WebSocket 帧编解码
// ============================================================
function encodeWsFrame(payload) {
  const buf = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
  const len = buf.length;
  let header;
  if (len < 126) {
    header = Buffer.allocUnsafe(6);
    header[0] = 0x81;
    header[1] = 0x80 | len;
  } else if (len < 65536) {
    header = Buffer.allocUnsafe(8);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.allocUnsafe(14);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  const mask = crypto.randomBytes(4);
  header[header.length - 4] = mask[0];
  header[header.length - 3] = mask[1];
  header[header.length - 2] = mask[2];
  header[header.length - 1] = mask[3];
  const masked = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) masked[i] = buf[i] ^ mask[i % 4];
  return Buffer.concat([header, masked]);
}

function decodeWsFrames(buffer) {
  const messages = [];
  let offset = 0;
  while (offset < buffer.length) {
    if (buffer.length - offset < 2) break;
    const secondByte = buffer[offset + 1];
    const opcode = buffer[offset] & 0x0f;
    let payloadLen = secondByte & 0x7f;
    let headerSize = 2;
    if (payloadLen === 126) { payloadLen = buffer.readUInt16BE(offset + 2); headerSize = 4; }
    else if (payloadLen === 127) { payloadLen = buffer.readUInt32BE(offset + 6); headerSize = 10; }
    const totalSize = headerSize + payloadLen;
    if (buffer.length - offset < totalSize) break;
    const payload = buffer.slice(offset + headerSize, offset + headerSize + payloadLen);
    if (opcode === 0x01 || opcode === 0x02) messages.push(payload);
    if (opcode === 0x0a) { offset += totalSize; continue; }
    offset += totalSize;
  }
  return messages;
}

function encodeWsPing() {
  const frame = Buffer.allocUnsafe(2);
  frame[0] = 0x89;
  frame[1] = 0x80;
  return frame;
}

// ============================================================
// 模拟玩家
// ============================================================
const CLASSES = [
  { className: "法师", gender: "女", sub: "暗影", spriteId: 665, skillId: "mage_shadow" },
  { className: "法师", gender: "男", sub: "光明", spriteId: 663, skillId: "mage_light" },
  { className: "法师", gender: "女", sub: "裁决", spriteId: 669, skillId: "mage_judge" },
  { className: "剑士", gender: "男", sub: "狂暴", spriteId: 649, skillId: "warrior_berserk" },
  { className: "剑士", gender: "女", sub: "刺杀", spriteId: 653, skillId: "warrior_assassin" },
  { className: "枪手", gender: "男", sub: "破魔", spriteId: 683, skillId: "gunner_demon" },
  { className: "枪手", gender: "女", sub: "狙击", spriteId: 677, skillId: "gunner_snipe" },
];

const PETS = [
  { name: "白色幻影", id: 832 },
  { name: "暗影狼", id: 845 },
  { name: "火焰龙", id: 901 },
  { name: "冰霜熊", id: 870 },
  null, // 30% 无宠物
  null,
  null,
];

function createPlayer(index) {
  const cls = CLASSES[index % CLASSES.length];
  const pet = PETS[index % PETS.length];
  const level = 30 + Math.floor(Math.random() * 40);

  // 行为类型分配
  let behavior;
  const r = Math.random();
  if (r < 0.70) behavior = "afk";
  else if (r < 0.90) behavior = "move";
  else behavior = "active";

  return {
    index,
    account: "stress1k_" + index,
    peerId: "peer_s1k_" + index + "_" + Date.now(),
    name: "测试玩家" + index,
    spriteId: cls.spriteId,
    className: cls.className,
    gender: cls.gender,
    sub: cls.sub,
    skillId: cls.skillId,
    pet: pet,
    x: 80 + Math.random() * 300,
    y: 80 + Math.random() * 300,
    direction: ["up", "down", "left", "right"][Math.floor(Math.random() * 4)],
    moving: false,
    mapName: MAP_NAME,
    level: level,
    exp: level * 5000,
    dragonSoul: Math.floor(Math.random() * 50),
    petLevel: pet ? 20 + Math.floor(Math.random() * 30) : 0,
    petExp: pet ? Math.floor(Math.random() * 100000) : 0,
    behavior: behavior,

    // 战斗状态
    inBattle: false,
    battleStartAt: 0,
    battleId: "",
    monsterHp: 0,
    totalKills: 0,
    totalBattleRewards: 0,

    // 网络
    socket: null,
    buffer: Buffer.alloc(0),
    bytesIn: 0,
    bytesOut: 0,
    msgsIn: 0,
    msgsOut: 0,
    httpBytesOut: 0,
    httpBytesIn: 0,
    connected: false,
    connectTime: 0,
    lastSendAt: 0,
    lastSaveAt: 0,
    pingLatency: [],
    errors: 0,
  };
}

// ============================================================
// 消息生成
// ============================================================
function dirCode(d) { return ({ up: "u", down: "d", left: "l", right: "r" })[d] || "d"; }

function stateMsg(p) {
  return JSON.stringify({
    type: "s",
    p: p.peerId,
    n: p.name,
    s: p.spriteId,
    x: Math.round(p.x),
    y: Math.round(p.y),
    m: p.mapName,
    b: p.battleId,
    cv: "1.0.0",
    d: dirCode(p.direction),
    v: p.moving ? 1 : 0,
    h: 0,
    a: p.account,
    f: 1,
    bs: {
      hp: 300000 + p.level * 12000,
      attack: 30000 + p.level * 3000,
      defense: 25000 + p.level * 2000,
      speed: 3000 + p.level * 50,
      mana: 10000 + p.level * 1000,
      crit: 30 + Math.floor(p.level / 5),
      critDamage: 600 + p.level * 10,
      power: 200000 + p.level * 17000,
      skillId: p.skillId,
      level: p.level,
    },
    pt: p.pet ? [
      p.pet.name, p.pet.id,
      Math.round(p.x + 5), Math.round(p.y + 5), "d", 0,
      { hp: 100000 + p.petLevel * 5000, attack: 15000 + p.petLevel * 2000, defense: 15000 + p.petLevel * 1500, speed: 500, mana: 5000, crit: 20, critDamage: 300, power: 100000 + p.petLevel * 8000, level: p.petLevel }
    ] : [],
    tm: { leaderId: "", members: [] },
    l: "",
  });
}

function savePayload(p) {
  return JSON.stringify({
    account: p.account,
    name: p.name,
    x: Math.round(p.x),
    y: Math.round(p.y),
    mapName: p.mapName,
    level: p.level,
    exp: p.exp,
    dragonSoul: p.dragonSoul,
    petLevel: p.petLevel,
    petExp: p.petExp,
    autoStrategy: { actor: { mode: "skill", skillId: p.skillId }, petById: {} },
    selection: { className: p.className, gender: p.gender, sub: p.sub, petId: p.pet?.id || 0 },
    activeMercenaryId: "",
    friends: [],
  });
}

function battleRewardPayload(p) {
  const expReward = 15000 + Math.floor(Math.random() * 5000);
  const forgeGem = Math.random() < 0.4 ? 3 + Math.floor(Math.random() * 5) : 0;
  const equipCount = Math.random() < 0.15 ? 1 : 0;
  return JSON.stringify({
    account: p.account,
    exp: expReward,
    petExp: expReward,
    forgeGem: forgeGem,
    equipmentCount: equipCount,
    monsterLevel: 55,
    fragments: [],
  });
}

// ============================================================
// HTTP 战斗奖励
// ============================================================
function httpBattleReward(p) {
  return new Promise((resolve) => {
    const body = battleRewardPayload(p);
    const req = http.request({
      hostname: HOST, port: PORT, path: "/api/battle-reward",
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
    }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        p.httpBytesOut += Buffer.byteLength(body);
        p.httpBytesIn += Buffer.byteLength(data);
        p.totalBattleRewards++;
        try {
          const json = JSON.parse(data);
          if (json.ok) {
            p.level = json.level || p.level;
            p.exp = json.exp || p.exp;
            p.dragonSoul = json.dragonSoul ?? p.dragonSoul;
            p.petLevel = json.petLevel || p.petLevel;
            p.petExp = json.petExp || p.petExp;
          }
        } catch {}
        resolve(true);
      });
    });
    req.on("error", () => { p.errors++; resolve(false); });
    req.setTimeout(5000, () => { p.errors++; req.destroy(); resolve(false); });
    req.write(body);
    req.end();
  });
}

// ============================================================
// WebSocket 连接
// ============================================================
function connectPlayer(player) {
  return new Promise((resolve) => {
    const key = crypto.randomBytes(16).toString("base64");
    const req = http.request({
      hostname: HOST, port: PORT, path: "/room", method: "GET",
      headers: {
        "Upgrade": "websocket", "Connection": "Upgrade",
        "Sec-WebSocket-Key": key, "Sec-WebSocket-Version": "13",
      },
    });
    req.on("upgrade", (res, socket) => {
      player.socket = socket;
      player.connected = true;
      player.connectTime = Date.now();
      player.buffer = Buffer.alloc(0);
      socket.on("data", (chunk) => {
        player.buffer = Buffer.concat([player.buffer, chunk]);
        const msgs = decodeWsFrames(player.buffer);
        // 计算已消费字节
        let consumed = 0;
        for (const m of msgs) {
          consumed += m.length;
          player.bytesIn += m.length + 10; // 粗略加上帧头
          player.msgsIn++;
        }
        // 重建 buffer（保留未消费的）
        let totalParsed = 0;
        let off = 0;
        for (let i = 0; i < msgs.length; i++) {
          // 快进 offset
          while (totalParsed <= i && off < player.buffer.length) {
            const sb = player.buffer[off + 1];
            let pl = sb & 0x7f;
            let hs = 2;
            if (pl === 126) { pl = player.buffer.readUInt16BE(off + 2); hs = 4; }
            else if (pl === 127) { pl = player.buffer.readUInt32BE(off + 6); hs = 10; }
            off += hs + pl;
            totalParsed++;
          }
        }
        if (off > 0 && off <= player.buffer.length) {
          player.buffer = player.buffer.slice(off);
        }
      });
      socket.on("close", () => { player.connected = false; });
      socket.on("error", () => { player.connected = false; player.errors++; });
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(10000, () => { req.destroy(); resolve(false); });
    req.end();
  });
}

function sendWs(player, msg) {
  if (!player.socket || player.socket.destroyed) return false;
  try {
    const frame = encodeWsFrame(msg);
    player.socket.write(frame);
    player.bytesOut += frame.length;
    player.msgsOut++;
    return true;
  } catch { player.errors++; return false; }
}

// ============================================================
// 玩家行为模拟
// ============================================================
function simulateBehavior(p, tick) {
  const now = Date.now();

  // --- 战斗状态机 ---
  if (p.inBattle) {
    const elapsed = (now - p.battleStartAt) / 1000;
    if (elapsed >= BATTLE_DURATION_SEC) {
      // 战斗结束
      p.inBattle = false;
      p.battleId = "";
      p.totalKills++;
      // 活跃玩家用 HTTP 结算奖励
      if (p.behavior === "active" || (p.behavior === "move" && Math.random() < 0.3)) {
        httpBattleReward(p);
      }
      return;
    }
    // 战斗中每秒发一次战斗状态
    if (tick % 1 === 0) {
      p.monsterHp = Math.max(0, p.monsterHp - Math.floor(Math.random() * 50000));
      sendWs(p, stateMsg(p));
    }
    return;
  }

  // --- 挂机党 ---
  if (p.behavior === "afk") {
    // 低频心跳
    if (tick % AFK_HEARTBEAT_SEC === 0) {
      sendWs(p, stateMsg(p));
    }
    // 挂机也会打怪（自动战斗）
    if (tick % (BATTLE_DURATION_SEC + BATTLE_IDLE_SEC + Math.floor(Math.random() * 5)) === 0) {
      p.inBattle = true;
      p.battleStartAt = now;
      p.battleId = "battle_" + p.index + "_" + tick;
      p.monsterHp = 500000;
      sendWs(p, stateMsg(p));
    }
  }

  // --- 移动党 ---
  else if (p.behavior === "move") {
    // 每秒移动一小步
    if (tick % MOVE_SEND_SEC === 0) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 2 + Math.random() * 3;
      p.x += Math.cos(angle) * dist;
      p.y += Math.sin(angle) * dist;
      // 边界限制
      p.x = Math.max(10, Math.min(500, p.x));
      p.y = Math.max(10, Math.min(500, p.y));
      // 随机方向
      if (Math.random() < 0.2) {
        p.direction = ["up", "down", "left", "right"][Math.floor(Math.random() * 4)];
      }
      p.moving = true;
      sendWs(p, stateMsg(p));
      p.moving = false;
    }
    // 偶尔打怪
    if (tick % (BATTLE_DURATION_SEC + BATTLE_IDLE_SEC + 2 + Math.floor(Math.random() * 8)) === 0) {
      p.inBattle = true;
      p.battleStartAt = now;
      p.battleId = "battle_" + p.index + "_" + tick;
      p.monsterHp = 500000;
      sendWs(p, stateMsg(p));
    }
  }

  // --- 活跃党 ---
  else if (p.behavior === "active") {
    // 快速移动
    if (tick % ACTIVE_SEND_SEC === 0) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 5 + Math.random() * 10;
      p.x += Math.cos(angle) * dist;
      p.y += Math.sin(angle) * dist;
      p.x = Math.max(10, Math.min(500, p.x));
      p.y = Math.max(10, Math.min(500, p.y));
      if (Math.random() < 0.3) {
        p.direction = ["up", "down", "left", "right"][Math.floor(Math.random() * 4)];
      }
      p.moving = true;
      sendWs(p, stateMsg(p));
      p.moving = false;
    }
    // 频繁打怪
    if (tick % (BATTLE_DURATION_SEC + BATTLE_IDLE_SEC) === 0) {
      p.inBattle = true;
      p.battleStartAt = now;
      p.battleId = "battle_" + p.index + "_" + tick;
      p.monsterHp = 500000;
      sendWs(p, stateMsg(p));
    }
  }

  // --- 存档 ---
  if (tick % SAVE_INTERVAL_SEC === 0 && now - p.lastSaveAt > SAVE_INTERVAL_SEC * 1000) {
    sendWs(p, savePayload(p));
    p.lastSaveAt = now;
  }
}

// ============================================================
// 统计输出
// ============================================================
function fmt(b) {
  if (b >= 1073741824) return (b / 1073741824).toFixed(2) + " GB";
  if (b >= 1048576) return (b / 1048576).toFixed(2) + " MB";
  if (b >= 1024) return (b / 1024).toFixed(2) + " KB";
  return b + " B";
}
function fmtRate(bps) {
  if (bps >= 1048576) return (bps / 1048576).toFixed(2) + " MB/s";
  if (bps >= 1024) return (bps / 1024).toFixed(2) + " KB/s";
  return bps.toFixed(0) + " B/s";
}
function pct(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * p)];
}

function getStats(players) {
  let totalIn = 0, totalOut = 0, httpIn = 0, httpOut = 0;
  let totalMsgsIn = 0, totalMsgsOut = 0;
  let alive = 0, inBattle = 0, totalKills = 0, totalRewards = 0, totalErrors = 0;
  let afkCount = 0, moveCount = 0, activeCount = 0;
  for (const p of players) {
    totalIn += p.bytesIn;
    totalOut += p.bytesOut;
    httpIn += p.httpBytesIn;
    httpOut += p.httpBytesOut;
    totalMsgsIn += p.msgsIn;
    totalMsgsOut += p.msgsOut;
    if (p.connected) alive++;
    if (p.inBattle) inBattle++;
    totalKills += p.totalKills;
    totalRewards += p.totalBattleRewards;
    totalErrors += p.errors;
    if (p.behavior === "afk") afkCount++;
    else if (p.behavior === "move") moveCount++;
    else activeCount++;
  }
  return { totalIn, totalOut, httpIn, httpOut, totalMsgsIn, totalMsgsOut, alive, inBattle, totalKills, totalRewards, totalErrors, afkCount, moveCount, activeCount };
}

// ============================================================
// 主流程
// ============================================================
async function run() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   1000 玩家带宽压力测试 - 挂机+移动+打怪     ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log("  玩家数: " + PLAYER_COUNT);
  console.log("  时长:   " + DURATION_SEC + " 秒");
  console.log("  地图:   " + MAP_NAME);
  console.log("  服务器: " + HOST + ":" + PORT);
  console.log("  批量连接: 每批 " + BATCH_SIZE + " 个, 间隔 " + BATCH_DELAY_MS + "ms");
  console.log("");

  // 创建玩家
  const players = [];
  for (let i = 0; i < PLAYER_COUNT; i++) players.push(createPlayer(i));

  // 批量连接
  console.log("连接 " + PLAYER_COUNT + " 个玩家...");
  let connected = 0;
  for (let i = 0; i < PLAYER_COUNT; i += BATCH_SIZE) {
    const batch = players.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(p => connectPlayer(p)));
    for (let j = 0; j < results.length; j++) {
      if (results[j]) connected++;
    }
    process.stdout.write("  " + Math.min(i + BATCH_SIZE, PLAYER_COUNT) + "/" + PLAYER_COUNT + " (已连接: " + connected + ")\r");
    if (i + BATCH_SIZE < PLAYER_COUNT) {
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }
  }
  console.log("\n  已连接: " + connected + "/" + PLAYER_COUNT);
  if (connected === 0) { console.log("无连接，退出"); return; }

  // 发送初始状态
  console.log("发送初始状态...");
  let initStateBytes = 0;
  for (const p of players) {
    if (p.connected) {
      const msg = stateMsg(p);
      sendWs(p, msg);
      initStateBytes += Buffer.byteLength(msg);
    }
  }
  console.log("  初始状态总量: " + fmt(initStateBytes));
  await new Promise(r => setTimeout(r, 1000));

  // 开始模拟
  console.log("\n开始模拟 (" + DURATION_SEC + "秒)...");
  console.log("  挂机党: " + players.filter(p => p.behavior === "afk").length);
  console.log("  移动党: " + players.filter(p => p.behavior === "move").length);
  console.log("  活跃党: " + players.filter(p => p.behavior === "active").length);
  console.log("");

  const startTime = Date.now();
  let tick = 0;
  const samplePoints = []; // 定期采样

  while (Date.now() - startTime < DURATION_SEC * 1000) {
    const tickStart = Date.now();

    for (const p of players) {
      if (!p.connected) continue;
      simulateBehavior(p, tick);
    }

    tick++;
    await new Promise(r => setTimeout(r, TICK_MS));

    // 每 10 秒输出
    if (tick % 10 === 0) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const st = getStats(players);
      const wsOut = st.totalOut;
      const wsIn = st.totalIn;
      const totalOut = wsOut + st.httpOut;
      const totalIn = wsIn + st.httpIn;
      const wsBandwidth = wsOut + wsIn;
      const tickMs = Date.now() - tickStart;

      const sample = {
        elapsed,
        alive: st.alive,
        inBattle: st.inBattle,
        totalKills: st.totalKills,
        wsOutRate: wsOut / elapsed,
        wsInRate: wsIn / elapsed,
        totalOutRate: totalOut / elapsed,
        totalInRate: totalIn / elapsed,
        wsBandwidth,
        httpOut: st.httpOut,
        httpIn: st.httpIn,
        errors: st.totalErrors,
      };
      samplePoints.push(sample);

      console.log(
        "  [" + String(elapsed).padStart(3) + "s] " +
        "存活=" + String(st.alive).padStart(4) + " " +
        "战斗=" + String(st.inBattle).padStart(4) + " " +
        "击杀=" + String(st.totalKills).padStart(5) + " " +
        "WS↑=" + fmtRate(wsOut / elapsed).padStart(10) + " " +
        "WS↓=" + fmtRate(wsIn / elapsed).padStart(10) + " " +
        "HTTP奖=" + String(st.totalRewards).padStart(5) + " " +
        "错误=" + st.totalErrors
      );
    }
  }

  // 最终统计
  const totalElapsed = Math.round((Date.now() - startTime) / 1000);
  const final = getStats(players);
  const totalWsOut = final.totalOut;
  const totalWsIn = final.totalIn;
  const totalAllOut = totalWsOut + final.httpOut;
  const totalAllIn = totalWsIn + final.httpIn;

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║               测试结果                       ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log("");
  console.log("  基本信息:");
  console.log("    目标玩家:  " + PLAYER_COUNT);
  console.log("    实际连接:  " + connected);
  console.log("    最终存活:  " + final.alive);
  console.log("    测试时长:  " + totalElapsed + " 秒");
  console.log("    挂机/移动/活跃: " + final.afkCount + "/" + final.moveCount + "/" + final.activeCount);
  console.log("");
  console.log("  WebSocket 带宽:");
  console.log("    客户端→服务器 (上行):");
  console.log("      总量:     " + fmt(totalWsOut));
  console.log("      平均速率: " + fmtRate(totalWsOut / totalElapsed));
  console.log("      消息数:   " + final.totalMsgsOut.toLocaleString());
  console.log("      每玩家/分钟: " + fmt(totalWsOut / connected / (totalElapsed / 60)));
  console.log("    服务器→客户端 (下行):");
  console.log("      总量:     " + fmt(totalWsIn));
  console.log("      平均速率: " + fmtRate(totalWsIn / totalElapsed));
  console.log("      消息数:   " + final.totalMsgsIn.toLocaleString());
  console.log("      每玩家/分钟: " + fmt(totalWsIn / connected / (totalElapsed / 60)));
  console.log("");
  console.log("  HTTP 战斗奖励带宽:");
  console.log("    上行:       " + fmt(final.httpOut));
  console.log("    下行:       " + fmt(final.httpIn));
  console.log("    奖励次数:   " + final.totalRewards.toLocaleString());
  console.log("");
  console.log("  合计带宽:");
  console.log("    总上行:     " + fmt(totalAllOut));
  console.log("    总下行:     " + fmt(totalAllIn));
  console.log("    总计:       " + fmt(totalAllOut + totalAllIn));
  console.log("    平均速率:   " + fmtRate((totalAllOut + totalAllIn) / totalElapsed));
  console.log("");
  console.log("  战斗统计:");
  console.log("    总击杀:     " + final.totalKills.toLocaleString());
  console.log("    击杀/分钟:  " + Math.round(final.totalKills / (totalElapsed / 60)));
  console.log("    每玩家平均: " + (final.totalKills / connected).toFixed(1) + " 击杀");
  console.log("");
  console.log("  错误:         " + final.totalErrors);

  if (samplePoints.length > 0) {
    const peak = samplePoints.reduce((a, b) => (a.wsBandwidth > b.wsBandwidth ? a : b));
    console.log("");
    console.log("  峰值时刻:");
    console.log("    时间:       " + peak.elapsed + "s");
    console.log("    存活:       " + peak.alive);
    console.log("    战斗中:     " + peak.inBattle);
    console.log("    WS 带宽:    " + fmtRate(peak.wsBandwidth / 10));

    // 推算 1000 人持续运行的带宽
    const avgWsRate = (totalWsOut + totalWsIn) / totalElapsed;
    const avgPerPlayer = avgWsRate / connected;
    console.log("");
    console.log("  推算 (1000 人持续运行):");
    console.log("    WS 带宽:    " + fmtRate(avgWsRate * (1000 / connected)));
    console.log("    HTTP 带宽:  " + fmtRate((final.httpOut + final.httpIn) / totalElapsed * (1000 / connected)));
    console.log("    总带宽:     " + fmtRate((totalAllOut + totalAllIn) / totalElapsed * (1000 / connected)));
    console.log("    每玩家平均: " + fmtRate(avgPerPlayer));
  }

  console.log("\n========================================\n");

  // 清理
  console.log("断开连接...");
  for (const p of players) {
    if (p.socket && !p.socket.destroyed) p.socket.end();
  }
  await new Promise(r => setTimeout(r, 500));
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });

