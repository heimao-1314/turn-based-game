/**
 * @file cleanup-demo-players.js
 * @description 清理演示/测试玩家账号（含关联数据）的可重复执行工具。
 *
 * 用法:
 *   node scripts/cleanup-demo-players.js --accounts=0000,link,145632,1471371628,1196995425
 *   node scripts/cleanup-demo-players.js --accounts=... --dry-run    # 只报告将删除的行，不删除
 *   node scripts/cleanup-demo-players.js --accounts=... --no-backup  # 跳过备份
 *
 * 不可逆性:
 *   - 会永久删除 players / accounts / phantom_rankings / account_ip_stats 等关联行；
 *   - 默认在 backup/ 目录生成带时间戳的 players.sqlite 快照（VACUUM INTO），
 *     请保留该快照直到确认清理结果无误；
 *   - 玩家数据是运营资产，删除前请核对账号列表。
 */

const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dbPath = process.env.PLAYER_DB_PATH
  ? path.resolve(process.env.PLAYER_DB_PATH)
  : path.join(root, "players.sqlite");

function parseArgs(argv) {
  const args = { accounts: [], dryRun: false, noBackup: false };
  for (const arg of argv) {
    if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--no-backup") args.noBackup = true;
    else if (arg.startsWith("--accounts=")) {
      args.accounts = String(arg.slice("--accounts=".length))
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.accounts.length) {
  console.error("用法: node scripts/cleanup-demo-players.js --accounts=a,b,c [--dry-run] [--no-backup]");
  process.exit(1);
}

/* 涉及账号列的关联表（按需清理，避免孤儿数据） */
const TARGETS = [
  ["players", "account"],
  ["players", "owner_account"],
  ["accounts", "account"],
  ["phantom_rankings", "account"],
  ["account_ip_stats", "account"],
  ["account_anomalies", "account"],
  ["battle_reward_tickets", "account"],
  ["redeem_claims", "account"],
  ["daily_news_reads", "account"],
  ["economy_request_receipts", "account"],
  ["stall_request_receipts", "account"],
  ["stall_listings", "seller_account"],
  ["stall_ledger", "seller_account"],
  ["mad_brag_challenges", "creator_account"],
  ["mad_brag_challenges", "responder_account"],
  ["mad_brag_challenges", "winner_account"],
  ["mad_brag_challenges", "loser_account"]
];

function backupDatabase() {
  const backupDir = path.join(root, "backup");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `players-${stamp}.sqlite`);
  const backupDb = new DatabaseSync(dbPath);
  backupDb.exec("PRAGMA busy_timeout = 10000");
  backupDb.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  backupDb.close();
  return backupPath;
}

function main() {
  console.log(`目标库: ${dbPath}`);
  console.log(`目标账号(${args.accounts.length}): ${args.accounts.join(", ")}`);

  if (!fs.existsSync(dbPath)) {
    console.error("数据库不存在，退出");
    process.exit(1);
  }

  let backupPath = "";
  if (!args.dryRun && !args.noBackup) {
    backupPath = backupDatabase();
    console.log(`备份已写入: ${backupPath}`);
  }

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 10000");
  db.exec("BEGIN IMMEDIATE");
  try {
    const placeholders = args.accounts.map(() => "?").join(",");
    const found = [];
    for (const [table, column] of TARGETS) {
      const count = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} IN (${placeholders})`).get(...args.accounts).n;
      if (count > 0) found.push({ table, column, count });
    }
    if (!found.length) {
      db.exec("ROLLBACK");
      console.log("未找到这些账号的关联数据，无需清理。");
      return;
    }
    console.log(args.dryRun ? "[dry-run] 将删除以下行：" : "已删除以下行：");
    for (const { table, column, count } of found) console.log(`  ${table}.${column}: ${count}`);
    if (!args.dryRun) {
      for (const { table, column } of found) {
        db.prepare(`DELETE FROM ${table} WHERE ${column} IN (${placeholders})`).run(...args.accounts);
      }
      db.exec("COMMIT");
      console.log("清理完成。若需恢复，请使用上方备份文件。");
    } else {
      db.exec("ROLLBACK");
      console.log("[dry-run] 未做任何修改。");
    }
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.close();
  }
}

main();
