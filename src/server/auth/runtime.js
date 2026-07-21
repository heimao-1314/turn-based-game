const crypto = require("crypto");

const SCRYPT_PREFIX = "scrypt";
const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };

function legacyPasswordHash(password) {
  return crypto.createHash("sha256").update(String(password || ""), "utf8").digest("hex");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(password || ""), salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS);
  return [SCRYPT_PREFIX, salt.toString("base64url"), derived.toString("base64url")].join("$");
}

function verifyPassword(password, storedHash) {
  const stored = String(storedHash || "");
  if (!stored.startsWith(`${SCRYPT_PREFIX}$`)) {
    const candidate = legacyPasswordHash(password);
    const ok = stored.length === candidate.length && crypto.timingSafeEqual(Buffer.from(stored), Buffer.from(candidate));
    return { ok, needsUpgrade: ok };
  }
  const [, saltEncoded, expectedEncoded] = stored.split("$");
  try {
    const expected = Buffer.from(expectedEncoded, "base64url");
    const actual = crypto.scryptSync(String(password || ""), Buffer.from(saltEncoded, "base64url"), expected.length, SCRYPT_OPTIONS);
    return { ok: expected.length === actual.length && crypto.timingSafeEqual(expected, actual), needsUpgrade: false };
  } catch {
    return { ok: false, needsUpgrade: false };
  }
}

function createAuthRuntime({ db, now = () => Date.now(), recordAnomaly = () => {} }) {
  const attempts = new Map();
  const registrations = new Map();
  const windowMs = 15 * 60 * 1000;
  const maxFailures = 10;

  function rateKey(ip, account) {
    return `${String(ip || "unknown")}:${String(account || "").toLowerCase()}`;
  }

  function isRateLimited(ip, account) {
    const entry = attempts.get(rateKey(ip, account));
    if (!entry || entry.resetAt <= now()) {
      if (entry) attempts.delete(rateKey(ip, account));
      return false;
    }
    return entry.failures >= maxFailures;
  }

  function recordFailure(ip, account) {
    const key = rateKey(ip, account);
    const current = attempts.get(key);
    const entry = !current || current.resetAt <= now()
      ? { failures: 0, resetAt: now() + windowMs }
      : current;
    entry.failures += 1;
    attempts.set(key, entry);
    if (entry.failures >= maxFailures) recordAnomaly(account, "auth_rate_limited", { ip: String(ip || "unknown") }, 2, "reject");
  }

  function clearFailures(ip, account) {
    attempts.delete(rateKey(ip, account));
  }

  function consumeRegistration(ip) {
    const key = String(ip || "unknown");
    const current = registrations.get(key);
    const entry = !current || current.resetAt <= now()
      ? { count: 0, resetAt: now() + windowMs }
      : current;
    if (entry.count >= 5) {
      recordAnomaly("anonymous", "registration_rate_limited", { ip: key }, 2, "reject");
      return false;
    }
    entry.count += 1;
    registrations.set(key, entry);
    return true;
  }

  function savePassword(account, password) {
    const timestamp = new Date(now()).toISOString();
    db.prepare(`
      INSERT INTO accounts (account, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(account) DO UPDATE SET password_hash = excluded.password_hash, updated_at = excluded.updated_at
    `).run(account, hashPassword(password), timestamp, timestamp);
  }

  function verifyAccountPassword(account, password, ip) {
    if (isRateLimited(ip, account)) return { ok: false, error: "auth_rate_limited", status: 429 };
    const row = db.prepare("SELECT password_hash FROM accounts WHERE account = ?").get(account);
    const verified = row ? verifyPassword(password, row.password_hash) : { ok: false };
    if (!verified.ok) {
      recordFailure(ip, account);
      return { ok: false, error: "bad_credentials", status: 401 };
    }
    clearFailures(ip, account);
    if (verified.needsUpgrade) savePassword(account, password);
    return { ok: true };
  }

  return { hashPassword, savePassword, verifyAccountPassword, isRateLimited, recordFailure, consumeRegistration };
}

module.exports = { createAuthRuntime, legacyPasswordHash };
