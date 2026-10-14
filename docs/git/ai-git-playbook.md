# AI 本地 Git 操作手册（必读）

> 本仓库使用本地 Git，已连接 GitHub 远程 `heimao-1314/turn-based-game`，日常分支为 `develop`。AI 必须把 Git 当作**可回滚的工程记忆**，而不是「最后随手存个档」。提交与推送是两个独立步骤，推送应在用户授权范围内进行。

配套：[branch-strategy.md](./branch-strategy.md) · [commit-convention.md](./commit-convention.md) · [rollback-guide.md](./rollback-guide.md) · 根目录 [AGENTS.md](../../AGENTS.md)

---

## 1. 每次动手前（强制）

在改任何业务文件之前执行并阅读输出：

```bash
git status
git branch --show-current
git log --oneline -5
```

检查：

1. 当前是否在 `develop`（或用户指定的 `feature/*`）  
2. 工作区是否有**他人/上次**遗留改动：有则先询问用户或纳入计划，禁止静默覆盖  
3. 是否误在 `main` 上开发大功能  

若在 `main` 且任务是新功能：

```bash
git checkout develop
```

---

## 2. 正确开发循环

```text
拉取上下文（文档+status）
→ 实现（领域模块）
→ 自检（AGENTS / commercial-bar）
→ git status
→ git diff / git diff --stat
→ git add <精确路径...>
→ git commit -m "type(scope): 摘要"
→ git status（应为 clean 或仅剩无关本地文件）
```

### 2.1 精确 add（强制习惯）

**推荐：**

```bash
git add 宠物模块/server.js server.js docs/agents/...
```

**谨慎使用：**

```bash
git add .
```

仅当 `git status` 已确认全部改动都该进库，且**没有** sqlite、.env、日志、临时文件时。

### 2.2 提交粒度

| 场景 | 做法 |
|------|------|
| 新功能 | `feat(scope): ...` 可含接线 |
| 先搬迁再改行为 | 先 `refactor(scope): extract ...`，再 `feat/fix` |
| 安全修复 | `security(scope): ...` |
| 纯文档 | `docs(scope): ...` |
| 多领域无关改动 | **拆成多次 commit**，禁止大杂烩 |

一次 commit 只做一类事，方便 `git revert`。

### 2.3 提交前 30 秒审查

```bash
git diff --cached --stat
git diff --cached
```

确认：

- 无 `players.sqlite` / `.env` / 密码 / token  
- 无意外删除大量文件  
- 无与需求无关的格式化噪声（除非任务就是格式化）  

---

## 3. 分支怎么用（AI）

### 小改（默认）

直接在 `develop` 提交。

### 大改（重构鉴权、经济、拆 server.js 大块）

```bash
git checkout develop
git checkout -b feature/extract-auth
# 多步小 commit
git checkout develop
git merge --no-ff feature/extract-auth
git branch -d feature/extract-auth
```

### 稳定线

只有用户要求「合并到稳定/发布」时才动 `main`：

```bash
git checkout main
git merge --no-ff develop
git checkout develop
```

---

## 4. 什么能进 Git / 什么不能

### 应提交

- 源码、前端静态、领域模块  
- `AGENTS.md`、`docs/**`  
- `.gitignore`、`.gitattributes`、`.env.example`  
- 不含密钥的配置模板、脚本测试  

### 禁止提交

| 路径/类型 | 原因 |
|-----------|------|
| `*.sqlite*` | 玩家/运营数据 |
| `.env`、真实密钥文件 | 凭据 |
| `node_modules/` | 可恢复依赖 |
| `output/`、日志、`_codex_server_*.txt` | 运行时垃圾 |
| 用户本机绝对路径隐私、生产口令 | 泄露 |

若 `git add` 后发现误加：

```bash
git restore --staged path
# 若已 commit 但尚未需要保留历史：按 rollback-guide 处理；优先新 commit 删除敏感文件并轮换密钥
```

---

## 5. 危险命令（默认禁止）

| 命令 | 为何危险 | AI 策略 |
|------|----------|---------|
| `git reset --hard` | 丢工作区与提交 | 除非用户明确要求并确认范围 |
| `git clean -fdx` | 删未跟踪文件 | 禁止 |
| `git push --force` | 改写远程历史 | 本地无远程也勿养成习惯；禁止 |
| 删除 `.git` | 毁掉历史 | 禁止 |
| `git config --global` | 改用户全局 | 禁止；仅可本地 repo config 且必要时 |
| 乱 `commit --amend` | 改写已有提交 | 仅限「刚提交且用户要求改 message/漏文件」 |

安全回滚优先：

```bash
git revert <hash>
```

---

## 6. 出问题怎么回滚（优先序）

1. **还没 commit**：`git restore -- path` 或 `git checkout -- path`  
2. **刚 commit 想撤销但保留改动**：`git reset --mixed HEAD~1`（确认仅丢 1 个且在 develop）  
3. **要反做某次已存在提交**：`git revert <hash>`  
4. **误删文件**：`git checkout HEAD -- path`  

详见 [rollback-guide.md](./rollback-guide.md)。

**永远记住：** 代码回滚 ≠ 数据库回滚。

---

## 7. 提交信息速查

```text
feat(bag): 仓库取出增加服务端数量校验
fix(ws): 修复断线后房间成员未清理
security(auth): 拒绝 body 冒充 account
refactor(arena): 将结算逻辑迁出 server.js
docs(agents): 补充商用验收条
chore(git): 收紧 gitignore
```

规范全文：[commit-convention.md](./commit-convention.md)

---

## 8. AI 完成任务时的 Git 汇报模板

```text
分支: develop
提交: <hash> <message>
纳入文件: <列表或统计>
未纳入: players.sqlite / .env（预期忽略）
```

---

## 9. 反模式（看到就改）

- ❌ 改完不 status 直接 `git add . && commit`  
- ❌ 一次 commit 同时「重构 + 新功能 + 文档大改 + 格式化」  
- ❌ 把「本地能跑」当「可以提交密钥」  
- ❌ 在 `main` 上连续 experiment  
- ❌ 用 hard reset 当撤销工具  
- ❌ 提交后工作区仍残留本应提交的模块文件却声称完成  
