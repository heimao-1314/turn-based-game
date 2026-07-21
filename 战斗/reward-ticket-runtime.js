const crypto = require("crypto");

const TICKET_TTL_MS = 10 * 60 * 1000;

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
      created_at TEXT NOT NULL,
      UNIQUE (battle_id, account)
    );
    CREATE INDEX IF NOT EXISTS idx_battle_reward_tickets_claim
      ON battle_reward_tickets (account, claimed_at, expires_at);
  `);

  function issue({ battleId, account, monsterId, monsterCount }) {
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

  function consume(account, ticketId) {
    const timestamp = new Date(now()).toISOString();
    try {
      db.exec("BEGIN IMMEDIATE");
      const ticket = db.prepare(`
        SELECT monster_id, monster_count
        FROM battle_reward_tickets
        WHERE id = ? AND account = ? AND claimed_at IS NULL AND expires_at > ?
      `).get(String(ticketId || ""), account, timestamp);
      if (!ticket) throw new Error("invalid_reward_ticket");
      const claimed = db.prepare(`
        UPDATE battle_reward_tickets SET claimed_at = ?
        WHERE id = ? AND account = ? AND claimed_at IS NULL
      `).run(timestamp, String(ticketId || ""), account);
      if (!claimed.changes) throw new Error("reward_already_claimed");
      db.exec("COMMIT");
      return { ok: true, monsterId: ticket.monster_id, monsterCount: ticket.monster_count };
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      return { ok: false, error: error.message === "reward_already_claimed" ? error.message : "invalid_reward_ticket", status: 409 };
    }
  }

  return { issue, consume };
}

module.exports = { createRewardTicketRuntime };
