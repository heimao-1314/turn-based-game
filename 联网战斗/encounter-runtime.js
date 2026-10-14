const crypto = require("crypto");

const TILE_SIZE = 16;
const REQUIRED_TRAVEL_TILES = 6;
const MAX_STEP_DISTANCE = TILE_SIZE * 4;
const ENCOUNTER_TTL_MS = 15_000;
const IDLE_ENCOUNTER_INTERVAL_MS = 5_000;
const MAX_MOVEMENT_SPEED_PX_PER_MS = 0.12;
const MOVEMENT_SLACK_PX = TILE_SIZE / 2;

const mapEncounters = {
  "\u539f\u91ce\u602a\u533a": { monsterId: "amumu", chance: 0.28 },
  "\u5e7b\u5f71\u72e9\u730e\u573a": { monsterId: "phantom", chance: 0.32 }
};

function createEncounterRuntime(deps) {
  const movementByAccount = new Map();
  const encountersByAccount = new Map();
  const idleEncounterCooldownByAccount = new Map();
  const now = deps.now || (() => Date.now());
  const random = deps.random || Math.random;

  function realmKey(meta = {}) {
    return `${String(meta.serverId || "")}:${Math.floor(Number(meta.channelId) || 0)}`;
  }

  function accountKey(account, meta) {
    return `${realmKey(meta)}:${String(account || "")}`;
  }

  function clearExpired(account, meta) {
    const key = accountKey(account, meta);
    const encounter = encountersByAccount.get(key);
    if (encounter && encounter.expiresAt <= now()) encountersByAccount.delete(key);
  }

  function rejectMovement(account, detail) {
    deps.recordAnomaly?.(account, "invalid_encounter_movement", detail, 2, "reject");
  }

  function rejectEncounter(account, error, meta, monsterId) {
    deps.recordAnomaly?.(account, "invalid_pve_encounter", {
      error,
      mapName: String(meta.mapName || ""),
      monsterId: String(monsterId || "")
    }, 2, "reject");
    return { ok: false, error, status: 409 };
  }

  function issueEncounter(meta, config) {
    const account = String(meta.account || "");
    if (!account || !meta.peerId) return null;
    const key = accountKey(account, meta);
    const encounter = {
      id: crypto.randomBytes(24).toString("base64url"),
      account,
      realm: realmKey(meta),
      peerId: String(meta.peerId || ""),
      mapName: String(meta.mapName || ""),
      monsterId: config.monsterId,
      expiresAt: now() + ENCOUNTER_TTL_MS
    };
    encountersByAccount.set(key, encounter);
    deps.sendSocketJson(meta.socket, {
      type: "pveEncounter",
      to: meta.peerId,
      encounterId: encounter.id,
      wildMonsterId: encounter.monsterId,
      expiresAt: new Date(encounter.expiresAt).toISOString()
    });
    return encounter;
  }

  function observeState(meta = {}, data = {}) {
    const account = String(meta.account || "");
    const config = mapEncounters[String(meta.mapName || "")];
    if (!account || !config || !meta.peerId) return;
    const canonicalLeaderId = String(meta.team?.leaderId || "");
    if (canonicalLeaderId && canonicalLeaderId !== meta.peerId) return;
    clearExpired(account, meta);
    const key = accountKey(account, meta);
    const existingEncounter = encountersByAccount.get(key);
    if (
      existingEncounter
      && (
        existingEncounter.peerId !== String(meta.peerId || "")
        || existingEncounter.mapName !== String(meta.mapName || "")
      )
    ) {
      encountersByAccount.delete(key);
    }

    const x = Number(data.x);
    const y = Number(data.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const observedAt = now();
    const previous = movementByAccount.get(key);
    if (!previous || previous.mapName !== meta.mapName || previous.peerId !== meta.peerId) {
      movementByAccount.set(key, { mapName: meta.mapName, peerId: meta.peerId, x, y, distance: 0, observedAt });
      return;
    }
    const distance = Math.hypot(x - previous.x, y - previous.y);
    const elapsedMs = Math.max(0, observedAt - previous.observedAt);
    const maxDistanceForElapsed = Math.min(MAX_STEP_DISTANCE, MOVEMENT_SLACK_PX + elapsedMs * MAX_MOVEMENT_SPEED_PX_PER_MS);
    if (distance > maxDistanceForElapsed) {
      previous.distance = 0;
      rejectMovement(account, {
        mapName: meta.mapName,
        distance: Math.round(distance),
        elapsedMs: Math.round(elapsedMs)
      });
      return;
    }
    previous.x = x;
    previous.y = y;
    previous.observedAt = observedAt;
    if (encountersByAccount.has(key)) return;
    previous.distance += distance;
    if (previous.distance < REQUIRED_TRAVEL_TILES * TILE_SIZE || random() >= config.chance) return;
    previous.distance = 0;
    issueEncounter(meta, config);
  }

  function requestIdleEncounter(meta = {}) {
    const account = String(meta.account || "");
    const config = mapEncounters[String(meta.mapName || "")];
    if (!account || !config || !meta.peerId) return { ok: false, error: "pve_idle_unsupported" };
    const canonicalLeaderId = String(meta.team?.leaderId || "");
    if (canonicalLeaderId && canonicalLeaderId !== meta.peerId) return { ok: false, error: "team_leader_required" };
    const key = accountKey(account, meta);
    clearExpired(account, meta);
    if (encountersByAccount.has(key)) return { ok: false, error: "pve_encounter_pending" };
    const nextAllowedAt = idleEncounterCooldownByAccount.get(key) || 0;
    if (nextAllowedAt > now()) return { ok: false, error: "pve_idle_cooldown" };
    idleEncounterCooldownByAccount.set(key, now() + IDLE_ENCOUNTER_INTERVAL_MS);
    const encounter = issueEncounter(meta, config);
    return encounter ? { ok: true, encounter } : { ok: false, error: "pve_idle_unsupported" };
  }

  function consume({ account, encounterId, monsterId, meta = {} }) {
    const key = accountKey(account, meta);
    clearExpired(account, meta);
    const encounter = encountersByAccount.get(key);
    if (!encounter || encounter.id !== String(encounterId || "")) {
      return rejectEncounter(account, "pve_encounter_required", meta, monsterId);
    }
    if (
      encounter.peerId !== String(meta.peerId || "")
      || encounter.monsterId !== String(monsterId || "")
      || encounter.mapName !== String(meta.mapName || "")
    ) {
      return rejectEncounter(account, "pve_encounter_mismatch", meta, monsterId);
    }
    encountersByAccount.delete(key);
    return { ok: true, encounter };
  }

  function handleDisconnect(meta = {}) {
    const account = String(meta.account || "");
    if (!account) return;
    const key = accountKey(account, meta);
    const peerId = String(meta.peerId || "");
    const movement = movementByAccount.get(key);
    if (!movement || movement.peerId === peerId) movementByAccount.delete(key);
    idleEncounterCooldownByAccount.delete(key);
    const encounter = encountersByAccount.get(key);
    if (!encounter || encounter.peerId === peerId) encountersByAccount.delete(key);
  }

  return { observeState, requestIdleEncounter, consume, handleDisconnect };
}

module.exports = { createEncounterRuntime };
