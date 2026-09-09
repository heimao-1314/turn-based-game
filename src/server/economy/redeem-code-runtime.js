const crypto = require("crypto");

function codeHash(code) {
  return crypto.createHash("sha256").update(String(code || "").trim().toUpperCase(), "utf8").digest("hex");
}

function createRedeemCodeRuntime({ db, itemColumnForId, titleReward, initialCodes = [], now = () => new Date() }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS redeem_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code_hash TEXT NOT NULL UNIQUE,
      rewards_json TEXT NOT NULL,
      starts_at TEXT,
      ends_at TEXT,
      max_claims INTEGER NOT NULL DEFAULT 0,
      claimed_count INTEGER NOT NULL DEFAULT 0,
      per_account_limit INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS redeem_claims (
      code_id INTEGER NOT NULL,
      account TEXT NOT NULL,
      claim_count INTEGER NOT NULL DEFAULT 1,
      claimed_at TEXT NOT NULL,
      PRIMARY KEY (code_id, account),
      FOREIGN KEY (code_id) REFERENCES redeem_codes(id)
    );
  `);

  const createdAt = now().toISOString();
  for (const entry of initialCodes) {
    const hash = String(entry?.codeHash || "");
    if (!/^[a-f0-9]{64}$/i.test(hash) || !entry?.rewards || typeof entry.rewards !== "object") continue;
    db.prepare(`
      INSERT OR IGNORE INTO redeem_codes (code_hash, rewards_json, max_claims, claimed_count, per_account_limit, enabled, created_at, updated_at)
      VALUES (?, ?, 0, 0, ?, 1, ?, ?)
    `).run(hash, JSON.stringify(entry.rewards), Math.max(1, Math.floor(Number(entry.perAccountLimit) || 1)), createdAt, createdAt);
  }

  function normalizedRewards(value) {
    const source = value && typeof value === "object" ? value : {};
    const rewards = [];
    for (const [id, rawAmount] of Object.entries(source)) {
      const column = itemColumnForId(id);
      const amount = Math.floor(Number(rawAmount) || 0);
      if (column && amount > 0 && amount <= 999999999) rewards.push({ id, column, amount });
    }
    const title = Math.floor(Number(source[titleReward?.id]) || 0) > 0 ? titleReward : null;
    return { rewards, title };
  }

  function claim(account, code) {
    const timestamp = now().toISOString();
    const hash = codeHash(code);
    try {
      db.exec("BEGIN IMMEDIATE");
      const entry = db.prepare(`
        SELECT * FROM redeem_codes
        WHERE code_hash = ? AND enabled = 1
          AND (starts_at IS NULL OR starts_at <= ?)
          AND (ends_at IS NULL OR ends_at > ?)
      `).get(hash, timestamp, timestamp);
      if (!entry) throw new Error("bad_code");
      if (entry.max_claims > 0 && entry.claimed_count >= entry.max_claims) throw new Error("code_exhausted");
      const existing = db.prepare("SELECT claim_count FROM redeem_claims WHERE code_id = ? AND account = ?").get(entry.id, account);
      if (existing && existing.claim_count >= entry.per_account_limit) throw new Error("already_claimed");
      const { rewards, title } = normalizedRewards(JSON.parse(entry.rewards_json || "{}"));
      if (!rewards.length && !title) throw new Error("invalid_code_reward");
      const player = title ? db.prepare("SELECT claimed_titles_json FROM players WHERE account = ?").get(account) : null;
      if (title && !player) throw new Error("player_not_found");
      const assignments = rewards.map((reward) => `${reward.column} = ${reward.column} + ?`);
      const params = rewards.map((reward) => reward.amount);
      if (title) {
        const claimed = JSON.parse(player.claimed_titles_json || "[]").filter((entry) => entry?.title !== title.title);
        claimed.push({ title: title.title, claimedAt: timestamp, expiresAt: new Date(now().getTime() + title.durationMs).toISOString() });
        assignments.push("claimed_titles_json = ?", "equipped_title = ?");
        params.push(JSON.stringify(claimed), title.title);
      }
      const updated = db.prepare(`UPDATE players SET ${assignments.join(", ")}, updated_at = ? WHERE account = ?`).run(...params, timestamp, account);
      if (!updated.changes) throw new Error("player_not_found");
      db.prepare(`
        INSERT INTO redeem_claims (code_id, account, claim_count, claimed_at) VALUES (?, ?, 1, ?)
        ON CONFLICT(code_id, account) DO UPDATE SET claim_count = claim_count + 1, claimed_at = excluded.claimed_at
      `).run(entry.id, account, timestamp);
      const counted = db.prepare(`
        UPDATE redeem_codes SET claimed_count = claimed_count + 1, updated_at = ?
        WHERE id = ? AND (max_claims = 0 OR claimed_count < max_claims)
      `).run(timestamp, entry.id);
      if (!counted.changes) throw new Error("code_exhausted");
      db.exec("COMMIT");
      return { ok: true, rewards: rewards.map(({ id, amount }) => ({ id, amount })), title: title ? { title: title.title, durationMs: title.durationMs } : null };
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      const errorCode = ["bad_code", "code_exhausted", "already_claimed", "invalid_code_reward", "player_not_found"].includes(error.message)
        ? error.message
        : "redeem_failed";
      return { ok: false, error: errorCode, status: errorCode === "redeem_failed" ? 500 : 409 };
    }
  }

  return { claim };
}

module.exports = { createRedeemCodeRuntime, codeHash };
