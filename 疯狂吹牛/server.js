const ALLOWED_STAKES = new Set([
  "silver",
  "immortal_pill",
  "peerless_pet_scroll_ticket"
]);

function createMadBragRuntime(deps) {
  const db = deps.db;
  const defaultServerId = deps.defaultServerId || "penguin_village";

  function nowIso() {
    return new Date().toISOString();
  }

  function normalizeText(value, max = 80) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
  }

  function normalizeStake(raw = {}) {
    const type = String(raw.type || "").trim();
    const quantity = Math.max(1, Math.min(999999999, Math.floor(Number(raw.quantity) || 0)));
    if (!ALLOWED_STAKES.has(type) || !quantity) return null;
    if (type === "silver") return { type, id: "silver", name: "银币", icon: "1.11", quantity, value: quantity };
    const meta = deps.itemMeta(type);
    if (!deps.itemColumn(type) || !meta) return null;
    return {
      type: "item",
      id: type,
      name: meta.name || type,
      icon: meta.icon || "2.8",
      quantity,
      value: Math.max(1, deps.itemValue(type)) * quantity
    };
  }

  function publicChallenge(row, includeAnswer = false) {
    if (!row) return null;
    const item = {
      id: row.id,
      serverId: row.server_id || defaultServerId,
      creatorAccount: row.creator_account,
      creatorName: row.creator_name,
      question: row.question,
      optionA: row.option_a,
      optionB: row.option_b,
      stake: {
        type: row.stake_type,
        id: row.stake_id,
        name: row.stake_name,
        icon: row.stake_icon,
        quantity: row.stake_quantity,
        value: row.stake_value
      },
      status: row.status,
      responderAccount: row.responder_account || "",
      responderName: row.responder_name || "",
      responderChoice: row.responder_choice || "",
      winnerAccount: row.winner_account || "",
      winnerName: row.winner_name || "",
      loserAccount: row.loser_account || "",
      loserName: row.loser_name || "",
      feeQuantity: row.fee_quantity || 0,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at || ""
    };
    if (includeAnswer) item.correctOption = row.correct_option;
    return item;
  }

  function ensureSchema() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS mad_brag_challenges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id TEXT NOT NULL DEFAULT 'penguin_village',
        creator_account TEXT NOT NULL,
        creator_name TEXT NOT NULL,
        question TEXT NOT NULL,
        option_a TEXT NOT NULL,
        option_b TEXT NOT NULL,
        correct_option TEXT NOT NULL,
        stake_type TEXT NOT NULL,
        stake_id TEXT NOT NULL,
        stake_name TEXT NOT NULL,
        stake_icon TEXT NOT NULL,
        stake_quantity INTEGER NOT NULL,
        stake_value INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        responder_account TEXT NOT NULL DEFAULT '',
        responder_name TEXT NOT NULL DEFAULT '',
        responder_choice TEXT NOT NULL DEFAULT '',
        winner_account TEXT NOT NULL DEFAULT '',
        winner_name TEXT NOT NULL DEFAULT '',
        loser_account TEXT NOT NULL DEFAULT '',
        loser_name TEXT NOT NULL DEFAULT '',
        fee_quantity INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        resolved_at TEXT NOT NULL DEFAULT ''
      )
    `);
    const columns = db.prepare("PRAGMA table_info(mad_brag_challenges)").all().map((column) => column.name);
    if (!columns.includes("server_id")) {
      db.exec(`ALTER TABLE mad_brag_challenges ADD COLUMN server_id TEXT NOT NULL DEFAULT '${defaultServerId}'`);
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_mad_brag_server_status ON mad_brag_challenges (server_id, status, id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_mad_brag_server_creator ON mad_brag_challenges (server_id, creator_account, id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_mad_brag_server_responder ON mad_brag_challenges (server_id, responder_account, id)");
  }

  function hasStake(row, stake) {
    if (stake.type === "silver") return (Number(row?.silver) || 0) >= stake.quantity;
    const column = deps.itemColumn(stake.id);
    return column && (Number(row?.[column]) || 0) >= stake.quantity;
  }

  function addStake(account, serverId, stake, quantity) {
    if (stake.type === "silver") {
      db.prepare("UPDATE players SET silver = silver + ?, updated_at = ? WHERE account = ? AND server_id = ?").run(quantity, nowIso(), account, serverId);
      return;
    }
    const column = deps.itemColumn(stake.id);
    db.prepare(`UPDATE players SET ${column} = ${column} + ?, updated_at = ? WHERE account = ? AND server_id = ?`).run(quantity, nowIso(), account, serverId);
  }

  function takeStake(account, serverId, stake, quantity) {
    if (stake.type === "silver") {
      db.prepare("UPDATE players SET silver = silver - ?, updated_at = ? WHERE account = ? AND server_id = ?").run(quantity, nowIso(), account, serverId);
      return;
    }
    const column = deps.itemColumn(stake.id);
    db.prepare(`UPDATE players SET ${column} = ${column} - ?, updated_at = ? WHERE account = ? AND server_id = ?`).run(quantity, nowIso(), account, serverId);
  }

  function create(account, payload = {}) {
    const creator = deps.fetchPlayer(account);
    if (!creator) return { ok: false, status: 404, error: "player_not_found" };
    const question = normalizeText(payload.question, 90);
    const optionA = normalizeText(payload.optionA, 36);
    const optionB = normalizeText(payload.optionB, 36);
    const correct = String(payload.correctOption || "").toUpperCase();
    const stake = normalizeStake(payload.stake);
    if (!question || !optionA || !optionB || !["A", "B"].includes(correct) || !stake) {
      return { ok: false, status: 400, error: "bad_challenge" };
    }
    if (!hasStake(creator, stake)) return { ok: false, status: 409, error: "not_enough_stake" };
    const serverId = creator.server_id || defaultServerId;
    const createdAt = nowIso();
    const info = db.prepare(`
      INSERT INTO mad_brag_challenges (
        server_id, creator_account, creator_name, question, option_a, option_b, correct_option,
        stake_type, stake_id, stake_name, stake_icon, stake_quantity, stake_value, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      serverId,
      account,
      String(creator.name || account).slice(0, 24),
      question,
      optionA,
      optionB,
      correct,
      stake.type,
      stake.id,
      stake.name,
      stake.icon,
      stake.quantity,
      stake.value,
      createdAt
    );
    return { ok: true, challenge: publicChallenge(db.prepare("SELECT * FROM mad_brag_challenges WHERE id = ? AND server_id = ?").get(info.lastInsertRowid, serverId)) };
  }

  function list(account) {
    const viewer = deps.fetchPlayer(account);
    if (!viewer) return { ok: false, status: 404, error: "player_not_found" };
    const serverId = viewer.server_id || defaultServerId;
    const rows = db.prepare(`
      SELECT * FROM mad_brag_challenges
      WHERE server_id = ? AND status = 'open'
      ORDER BY id DESC
      LIMIT 50
    `).all(serverId);
    return { ok: true, challenges: rows.map((row) => ({ ...publicChallenge(row), mine: row.creator_account === account })) };
  }

  function mine(account) {
    const player = deps.fetchPlayer(account);
    if (!player) return { ok: false, status: 404, error: "player_not_found" };
    const serverId = player.server_id || defaultServerId;
    const rows = db.prepare("SELECT * FROM mad_brag_challenges WHERE server_id = ? AND creator_account = ? ORDER BY id DESC LIMIT 50").all(serverId, account);
    return { ok: true, challenges: rows.map((row) => publicChallenge(row)) };
  }

  function responses(account) {
    const player = deps.fetchPlayer(account);
    if (!player) return { ok: false, status: 404, error: "player_not_found" };
    const serverId = player.server_id || defaultServerId;
    const rows = db.prepare("SELECT * FROM mad_brag_challenges WHERE server_id = ? AND responder_account = ? ORDER BY id DESC LIMIT 50").all(serverId, account);
    return { ok: true, challenges: rows.map((row) => publicChallenge(row)) };
  }

  function answer(account, challengeId, choice) {
    const responder = deps.fetchPlayer(account);
    if (!responder) return { ok: false, status: 404, error: "player_not_found" };
    const serverId = responder.server_id || defaultServerId;
    const selected = String(choice || "").toUpperCase();
    if (!["A", "B"].includes(selected)) return { ok: false, status: 400, error: "bad_choice" };
    db.exec("BEGIN IMMEDIATE");
    try {
      const row = db.prepare("SELECT * FROM mad_brag_challenges WHERE id = ? AND server_id = ?").get(Math.floor(Number(challengeId) || 0), serverId);
      if (!row || row.status !== "open") {
        db.exec("ROLLBACK");
        return { ok: false, status: 404, error: "challenge_not_found" };
      }
      if (row.creator_account === account) {
        db.exec("ROLLBACK");
        return { ok: false, status: 409, error: "cannot_answer_self" };
      }
      const creator = deps.fetchPlayer(row.creator_account);
      const freshResponder = deps.fetchPlayer(account);
      const stake = {
        type: row.stake_type,
        id: row.stake_id,
        name: row.stake_name,
        icon: row.stake_icon,
        quantity: row.stake_quantity,
        value: row.stake_value
      };
      if (!creator || !freshResponder || creator.server_id !== serverId || freshResponder.server_id !== serverId) {
        db.exec("ROLLBACK");
        return { ok: false, status: 404, error: "player_not_found" };
      }
      if (!hasStake(creator, stake) || !hasStake(freshResponder, stake)) {
        db.exec("ROLLBACK");
        return { ok: false, status: 409, error: "not_enough_stake" };
      }

      const responderWon = selected === row.correct_option;
      const winner = responderWon ? freshResponder : creator;
      const loser = responderWon ? creator : freshResponder;
      const fee = Math.floor(stake.quantity * 0.1);
      const payout = stake.quantity * 2 - fee;
      takeStake(creator.account, serverId, stake, stake.quantity);
      takeStake(freshResponder.account, serverId, stake, stake.quantity);
      addStake(winner.account, serverId, stake, payout);
      const resolvedAt = nowIso();
      db.prepare(`
        UPDATE mad_brag_challenges
        SET status = 'resolved',
          responder_account = ?,
          responder_name = ?,
          responder_choice = ?,
          winner_account = ?,
          winner_name = ?,
          loser_account = ?,
          loser_name = ?,
          fee_quantity = ?,
          resolved_at = ?
        WHERE id = ? AND server_id = ?
      `).run(
        account,
        String(freshResponder.name || account).slice(0, 24),
        selected,
        winner.account,
        String(winner.name || winner.account).slice(0, 24),
        loser.account,
        String(loser.name || loser.account).slice(0, 24),
        fee,
        resolvedAt,
        row.id,
        serverId
      );
      const next = db.prepare("SELECT * FROM mad_brag_challenges WHERE id = ? AND server_id = ?").get(row.id, serverId);
      db.exec("COMMIT");
      return {
        ok: true,
        won: winner.account === account,
        correct: selected === row.correct_option,
        challenge: publicChallenge(next),
        player: deps.playerToApi(deps.fetchPlayer(account))
      };
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      return { ok: false, status: 500, error: "server_error" };
    }
  }

  function rankings(account) {
    const player = deps.fetchPlayer(account);
    if (!player) return { ok: false, status: 404, error: "player_not_found" };
    const serverId = player.server_id || defaultServerId;
    const rows = db.prepare("SELECT * FROM mad_brag_challenges WHERE server_id = ? AND status = 'resolved'").all(serverId);
    const scores = new Map();
    function touch(account, name) {
      if (!scores.has(account)) scores.set(account, { account, name: name || account, profit: 0, wins: 0, losses: 0 });
      return scores.get(account);
    }
    rows.forEach((row) => {
      const unit = Math.max(1, Math.floor((Number(row.stake_value) || 0) / Math.max(1, Number(row.stake_quantity) || 1)));
      const feeValue = unit * (Number(row.fee_quantity) || 0);
      const value = Number(row.stake_value) || 0;
      const winner = touch(row.winner_account, row.winner_name);
      const loser = touch(row.loser_account, row.loser_name);
      winner.profit += value - feeValue;
      winner.wins += 1;
      loser.profit -= value;
      loser.losses += 1;
    });
    const entries = [...scores.values()];
    return {
      ok: true,
      profit: entries.filter((item) => item.profit > 0).sort((a, b) => b.profit - a.profit).slice(0, 30),
      loss: entries.filter((item) => item.profit < 0).sort((a, b) => a.profit - b.profit).slice(0, 30)
    };
  }

  ensureSchema();
  return { create, list, mine, responses, answer, rankings };
}

module.exports = createMadBragRuntime;
