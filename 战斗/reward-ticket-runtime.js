const crypto = require("crypto");

const TICKET_TTL_MS = 10 * 60 * 1000;
const MIN_REWARD_BATTLE_INTERVAL_MS = 5000;

function createRewardTicketRuntime({ db, now = () => Date.now() }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS battle_reward_tickets (
      id TEXT PRIMARY KEY,
      battle_id TEXT NOT NULL,
      account TEXT NOT NULL,
      monster_id TEXT NOT NULL,
      monster_count INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      claimed_at TEXT,
      result_json TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (battle_id, account)
    );
    CREATE INDEX IF NOT EXISTS idx_battle_reward_tickets_claim
      ON battle_reward_tickets (account, claimed_at, expires_at);
  `);
  const columns = db.prepare("PRAGMA table_info(battle_reward_tickets)").all();
  if (!columns.some((column) => column.name === "result_json")) {
    db.exec("ALTER TABLE battle_reward_tickets ADD COLUMN result_json TEXT");
  }

  function prune() {
    db.prepare("DELETE FROM battle_reward_tickets WHERE expires_at <= ?")
      .run(new Date(now()).toISOString());
  }

  function issue({ battleId, account, monsterId, monsterCount }) {
    prune();
    const id = crypto.randomBytes(32).toString("base64url");
    const createdAt = new Date(now()).toISOString();
    const expiresAt = new Date(now() + TICKET_TTL_MS).toISOString();
    const result = db.prepare(`
      INSERT OR IGNORE INTO battle_reward_tickets
        (id, battle_id, account, monster_id, monster_count, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, battleId, account, monsterId, monsterCount, expiresAt, createdAt);
    if (result.changes) return id;
    return db.prepare(`
      SELECT id FROM battle_reward_tickets
      WHERE battle_id = ? AND account = ? AND claimed_at IS NULL AND expires_at > ?
    `).get(battleId, account, createdAt)?.id || "";
  }

  function canStart(account) {
    prune();
    const cutoff = new Date(now() - MIN_REWARD_BATTLE_INTERVAL_MS).toISOString();
    const recent = db.prepare(`
      SELECT id FROM battle_reward_tickets
      WHERE account = ? AND created_at > ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(account, cutoff);
    return recent ? { ok: false, error: "battle_cooldown" } : { ok: true };
  }

  function claim(account, ticketId, settle) {
    prune();
    const timestamp = new Date(now()).toISOString();
    try {
      db.exec("BEGIN IMMEDIATE");
      const ticket = db.prepare(`
        SELECT id, monster_id, monster_count, expires_at, claimed_at, result_json
        FROM battle_reward_tickets
        WHERE id = ? AND account = ?
      `).get(String(ticketId || ""), account);
      if (!ticket) throw new Error("invalid_reward_ticket");
      if (ticket.result_json) {
        let result = null;
        try { result = JSON.parse(ticket.result_json); } catch {}
        if (!result || typeof result !== "object") throw new Error("invalid_reward_ticket");
        db.exec("COMMIT");
        return { ok: true, result, replayed: true };
      }
      if (ticket.claimed_at || ticket.expires_at <= timestamp) throw new Error("invalid_reward_ticket");
      const settlement = typeof settle === "function"
        ? settle({ monsterId: ticket.monster_id, monsterCount: ticket.monster_count })
        : { monsterId: ticket.monster_id, monsterCount: ticket.monster_count };
      if (!settlement || settlement.ok === false) {
        const error = new Error(settlement?.error || "reward_settlement_failed");
        error.status = settlement?.status;
        throw error;
      }
      const claimed = db.prepare(`
        UPDATE battle_reward_tickets SET claimed_at = ?, result_json = ?
        WHERE id = ? AND account = ? AND claimed_at IS NULL AND result_json IS NULL
      `).run(timestamp, JSON.stringify(settlement), String(ticketId || ""), account);
      if (!claimed.changes) throw new Error("reward_already_claimed");
      db.exec("COMMIT");
      return { ok: true, result: settlement, replayed: false };
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      if (error.message === "bad_monster_reward") return { ok: false, error: error.message, status: error.status || 400 };
      if (error.message === "reward_settlement_failed") return { ok: false, error: error.message, status: error.status || 500 };
      if (error.status && error.message) return { ok: false, error: error.message, status: error.status };
      return { ok: false, error: "invalid_reward_ticket", status: 409 };
    }
  }

  function consume(account, ticketId) {
    const claimed = claim(account, ticketId);
    if (!claimed.ok || claimed.replayed) {
      return claimed.replayed
        ? { ok: false, error: "invalid_reward_ticket", status: 409 }
        : claimed;
    }
    return { ok: true, monsterId: claimed.result.monsterId, monsterCount: claimed.result.monsterCount };
  }

  function listPending(account) {
    prune();
    const timestamp = new Date(now()).toISOString();
    return db.prepare(`
      SELECT id, battle_id, monster_id, monster_count
      FROM battle_reward_tickets
      WHERE account = ? AND claimed_at IS NULL AND expires_at > ?
      ORDER BY created_at ASC
    `).all(account, timestamp).map((ticket) => ({
      id: ticket.id,
      battleId: ticket.battle_id,
      monsterId: ticket.monster_id,
      monsterCount: ticket.monster_count
    }));
  }

  return { issue, claim, consume, canStart, listPending };
}

module.exports = { createRewardTicketRuntime };
