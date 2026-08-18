const NEWS_URL = "https://60s.viki.moe/v2/60s?encoding=text";
const NEWS_CACHE_MS = 10 * 60 * 1000;

const EXCHANGE_CATALOG = [
  { id: "lucky_box", name: "好运宝箱", icon: "1.11", cost: 1, reward: { type: "player_column", column: "lucky_box", quantity: 1 } },
  { id: "elf_waist_bag", name: "精灵腰包", icon: "2.8", cost: 1, reward: { type: "player_column", column: "elf_waist_bag", quantity: 1 } }
];

function createDailyNewsRuntime({ db, fetchNews = fetch, now = () => new Date() }) {
  let cachedNews = null;
  let cachedAt = 0;

  function dayKey(date = now()) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(date);
  }

  function nowIso() {
    return now().toISOString();
  }

  function ensureSchema() {
    db.exec(`
      CREATE TABLE IF NOT EXISTS daily_news_reads (
        account TEXT NOT NULL,
        read_day TEXT NOT NULL,
        read_at TEXT NOT NULL,
        PRIMARY KEY (account, read_day)
      )
    `);
  }

  async function news() {
    if (cachedNews && Date.now() - cachedAt < NEWS_CACHE_MS) return cachedNews;
    const response = await fetchNews(NEWS_URL, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error("daily_news_unavailable");
    const text = (await response.text()).trim().slice(0, 12000);
    if (!text) throw new Error("daily_news_unavailable");
    cachedNews = text;
    cachedAt = Date.now();
    return text;
  }

  function status(account) {
    const readDay = dayKey();
    const player = db.prepare("SELECT reading_points FROM players WHERE account = ?").get(account);
    if (!player) return { ok: false, status: 404, error: "player_not_found" };
    const read = db.prepare("SELECT 1 FROM daily_news_reads WHERE account = ? AND read_day = ?").get(account, readDay);
    return { ok: true, readDay, hasReadToday: Boolean(read), readingPoints: Number(player.reading_points) || 0 };
  }

  async function read(account) {
    const text = await news();
    const readDay = dayKey();
    db.exec("BEGIN IMMEDIATE");
    try {
      const player = db.prepare("SELECT reading_points FROM players WHERE account = ?").get(account);
      if (!player) {
        db.exec("ROLLBACK");
        return { ok: false, status: 404, error: "player_not_found" };
      }
      const alreadyRead = db.prepare("SELECT 1 FROM daily_news_reads WHERE account = ? AND read_day = ?").get(account, readDay);
      if (!alreadyRead) {
        db.prepare("INSERT INTO daily_news_reads (account, read_day, read_at) VALUES (?, ?, ?)").run(account, readDay, nowIso());
        db.prepare("UPDATE players SET reading_points = reading_points + 1, updated_at = ? WHERE account = ?").run(nowIso(), account);
      }
      const readingPoints = Number(db.prepare("SELECT reading_points FROM players WHERE account = ?").get(account)?.reading_points) || 0;
      db.exec("COMMIT");
      return { ok: true, text, readDay, gainedPoints: alreadyRead ? 0 : 1, readingPoints, hasReadToday: true };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function catalog(account) {
    const result = status(account);
    if (!result.ok) return result;
    return { ...result, items: EXCHANGE_CATALOG.map(({ reward, ...item }) => item) };
  }

  function redeem(account, itemId) {
    const item = EXCHANGE_CATALOG.find((entry) => entry.id === String(itemId || ""));
    if (!item) return { ok: false, status: 400, error: "invalid_reading_exchange_item" };
    db.exec("BEGIN IMMEDIATE");
    try {
      const player = db.prepare("SELECT reading_points FROM players WHERE account = ?").get(account);
      if (!player) {
        db.exec("ROLLBACK");
        return { ok: false, status: 404, error: "player_not_found" };
      }
      if ((Number(player.reading_points) || 0) < item.cost) {
        db.exec("ROLLBACK");
        return { ok: false, status: 409, error: "not_enough_reading_points" };
      }
      if (item.reward.type !== "player_column" || !["lucky_box", "elf_waist_bag"].includes(item.reward.column)) {
        db.exec("ROLLBACK");
        return { ok: false, status: 500, error: "reading_exchange_misconfigured" };
      }
      db.prepare(`UPDATE players SET reading_points = reading_points - ?, ${item.reward.column} = ${item.reward.column} + ?, updated_at = ? WHERE account = ?`)
        .run(item.cost, item.reward.quantity, nowIso(), account);
      const readingPoints = Number(db.prepare("SELECT reading_points FROM players WHERE account = ?").get(account)?.reading_points) || 0;
      db.exec("COMMIT");
      return { ok: true, item: { id: item.id, name: item.name, quantity: item.reward.quantity }, readingPoints };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  ensureSchema();
  return { status, news, read, catalog, redeem };
}

module.exports = createDailyNewsRuntime;
