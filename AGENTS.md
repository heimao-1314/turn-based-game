# AGENTS.md — AI 编程强制规则（商用向）

> **每次改代码前必读本文。**  
> 本仓库目标：做出**可商用**的回合制网页游戏。标准是：
>
> 1. **安全**：外网可暴露时不因低级漏洞丢库、被刷货币、被越权改号  
> 2. **可维护**：AI 可持续开发多年，而不是把 `app.js` / `server.js` 堆成不可回滚的屎山  
> 3. **可回滚**：Git 历史清晰，出问题能定位、能撤销，且**不把玩家数据当代码提交**

本项目面向 **AI 完全开发**。AI 不是「写完能跑就行」，而是「写完能上线、能审计、能迭代」。

---

## 0. 产品与工程总则

### 0.1 一句话

**`server.js` 和 `app.js` 只做装配与薄封装，不做新业务。**  
新逻辑进领域模块；改旧逻辑先迁出再改；经济与权限**永远服务端权威**。

### 0.2 商用级默认立场

| 原则 | 含义 |
|------|------|
| 零信任客户端 | 浏览器/app.js 可被篡改；凡影响金币、经验、道具、战绩、权限的，以服务端校验与结算为准 |
| 最小暴露面 | 静态资源白名单；DB/源码/文档/`.git`/`.env` 不可下载 |
| 可审计 | 关键操作可追踪（账号、动作、前后状态摘要）；异常记 anomaly，不只 `console.log` |
| 可回滚 | 小步提交；重构与行为变更分离；不把半成品直接扔进 `main` |
| 渐进增强 | 允许技术债，但**禁止扩大债**：新代码必须比旧代码更模块化、更安全 |
| 数据≠代码 | `players.sqlite` 是运营资产；Git 管源码与配置模板，不管玩家库 |

### 0.3 决策优先级

1. 用户当前明确指令  
2. 本文件硬约束  
3. `docs/agents/*`、`docs/git/*`、`docs/security-hardening-plan.md`  
4. 同领域现有实现风格  
5. 一般最佳实践  

冲突时选：**更安全、更可回滚、更不膨胀入口文件** 的方案。

---

## 1. 必读文档（按顺序）

| 优先级 | 文件 | 内容 |
|--------|------|------|
| 1 | [AGENTS.md](./AGENTS.md)（本文） | 商用总则、红线、落点、安全、Git、自检 |
| 2 | [docs/agents/ai-workflow.md](./docs/agents/ai-workflow.md) | 需求→实现→验证→提交 |
| 3 | [docs/agents/module-structure.md](./docs/agents/module-structure.md) | 目录与模块模板 |
| 4 | [docs/agents/coding-rules.md](./docs/agents/coding-rules.md) | API/WS/DB/编码细则 |
| 5 | [docs/agents/commercial-bar.md](./docs/agents/commercial-bar.md) | 商用验收条（安全/经济/可维护） |
| 6 | [docs/git/ai-git-playbook.md](./docs/git/ai-git-playbook.md) | **AI 如何正确使用本地 Git** |
| 7 | [docs/git/](./docs/git/) 其他 | 分支 / 提交信息 / 回滚 |
| 8 | [docs/security-hardening-plan.md](./docs/security-hardening-plan.md) | 已落地安全与生产要求 |
| 9 | 相关 `docs/*.md` | 战斗 / API / 地图业务背景 |

---

## 2. 巨型文件红线（硬约束）

### 2.1 禁止堆业务的入口

| 文件 | 允许 | 禁止 |
|------|------|------|
| `server.js` | require、创建 server、注册路由/运行时、启动引导 | 新 API 业务体、新 SQL 流程、新玩法数值、大段工具函数 |
| `app.js` | 初始化、注册模块、极薄胶水 | 新 UI 系统、新玩法状态机、大段面板逻辑 |
| `admin.js` | 管理端入口胶水 | 大段新后台业务 |
| `styles.css` | 全局变量/重置/跨页基础 | 单功能大段独占样式 |

### 2.2 预算

- 入口文件单次 **业务净增建议 ≤ 30 行**；超过必须进模块。  
- 入口接线通常 **3～15 行**。  
- 若需求触及入口内已有 **>50 行** 相关逻辑：**先抽取模块（行为不变）→ 再改需求**（绞杀者）。  
- **禁止** 以「以后再拆」为由在入口新增整系统。

### 2.3 入口改动白名单

1. `require` / 注册模块  
2. 路由表 / WS 分发表挂 handler  
3. 客户端 `initXxx` 接入启动序列  
4. 入口级致命 bug（仍优先下沉）  
5. 删除已迁移死代码  

---

## 3. 新功能落点速查表

| 需求类型 | 优先写入 | 禁止 |
|----------|----------|------|
| HTTP API / 账户 / 背包 / 商店 / 兑换码 | 领域目录或 `src/server/` | `server.js` 巨型 if 内堆逻辑 |
| WebSocket / 房间 | `联网战斗/`、`队伍/`、realtime 模块 | `server.js` 消息分支堆业务 |
| 全服竞技场 | `全服竞技场/` | 入口正文 |
| 仙气修炼 | `仙气修炼/` | 同上 |
| 疯狂吹牛 | `疯狂吹牛/` | 同上 |
| 地图 / 地图管理 API | `地图系统/` | 同上 |
| 宠物 | `宠物模块/` | 同上 |
| 职业 | `职业模块/` | 同上 |
| 生活技能 | `生活技能/` | 同上 |
| 副本 | `副本模块/` | 同上 |
| 回合战斗表现 | `战斗/` | `app.js` 继续堆 |
| 组队 | `队伍/` | 同上 |
| 菜单 UI | `菜单UI/` | 同上 |
| 聊天 / 频道 / 私聊 | `聊天模块/` | `app.js` / `server.js` 正文 |
| 小地图飞图 | `飞图小地图/` | 同上 |
| 鉴权 / 会话 / 密码 | 优先 `src/server/auth/` 或独立 auth 模块 | 散落复制 |
| 前后端共享纯函数 | `src/shared/` 或领域 `shared.js` | server/app 双份真理 |
| 管理能力 | 领域 `admin.js` / admin 路由模块 | 只堆 `admin.js` |
| 脚本与测试 | `scripts/` | 业务目录 |
| 文档 | `docs/`、领域 README | 只写在聊天里 |

**新系统：** 新建领域目录 + README，并更新本表。

---

## 4. 标准工作流（摘要）

完整步骤见 [ai-workflow.md](./docs/agents/ai-workflow.md)。

```text
git status / 确认 develop
→ 读本文与 agents 文档
→ 定位领域（§3）
→ 模块内实现（安全默认打开）
→ 入口仅接线
→ 商用自检（§6 + commercial-bar）
→ 精确 git add → conventional commit
→ 需要时更新 AGENTS 落点 / API 文档
```

### 4.1 服务端模块形态

- 优先 `createXxxRuntime(deps)` / `createXxxApi(deps)`  
- **注入** `db`、`sendJson`、鉴权函数、配置；禁止模块内偷偷新建全局 DB 连接或硬编码生产密钥  
- SQL：`prepare` + `?`；货币/背包写操作加事务  

### 4.2 客户端模块形态

- `initXxx(ctx)`；ctx 含 state/api/ws/ui  
- 禁止 `localStorage` 存明文密码  
- 慎用 `innerHTML`；动态内容转义  

### 4.3 改旧功能

```text
逻辑已在模块？ → 只改模块
逻辑仍在入口巨型文件？ → 先原样搬迁 → 再改行为
```

---

## 5. 商用安全底线（不可破坏）

更细清单见 [commercial-bar.md](./docs/agents/commercial-bar.md) 与安全加固文档。

### 5.1 认证与授权

1. 玩家接口：有效会话 + 账号绑定；禁止仅靠客户端传 `account` 认人  
2. 管理接口：强鉴权；生产密钥来自环境变量；禁止把真实生产口令写进仓库  
3. 密码：禁止明文；禁止退回更弱哈希；前端禁止存明文密码  
4. 会话：足够熵的 token；过期失效；注意重启后会话策略（扩展时优先可持久化）  
5. 防冒充：WS/HTTP 以服务端 session meta 为准，忽略或严审客户端自称身份  

### 5.2 经济与玩法权威

1. 奖励、掉落、结算、强化、交易、商店、兑换码：**服务端计算**  
2. 客户端上报的 exp/金币/装备结果字段：**不得直接入账**（可记 anomaly）  
3. 领奖接口：鉴权 + 冷却/次数/票据（battle ticket / run id）+ 幂等  
4. 兑换码：库表配置（次数、时效、每号限制），禁止在 `app.js` 硬编码新「万能码」  
5. 并发：背包/货币更新用事务，避免双花与丢失更新  

### 5.3 注入、路径、暴露面

1. SQL 参数化；禁止字符串拼用户输入  
2. 静态资源白名单；`path.normalize` 后拒绝 `..` 逃逸  
3. `players.sqlite` / `.env` / `.git` / 服务端源码不得可下载  
4. 生产建议 DB 路径在站点根外（`PLAYER_DB_PATH`）  
5. 日志禁止打印密码、完整 token、整包敏感背包（可打摘要）  

### 5.4 滥用与运营安全

1. 登录/注册/改密/兑换/管理接口：应有失败次数或速率限制意识（无则新增时补上）  
2. 异常与作弊尝试：`recordAnomaly`（或等价）+ 该拒绝时拒绝写库，不只记日志  
3. CORS、管理端暴露面按需收紧，不为图省事全网匿名可管  

### 5.5 密钥与配置

1. 使用 `.env.example` 作模板；真实 `.env` **永不提交**  
2. `NODE_ENV=production` 时管理员类配置必须非默认  
3. 代码里的开发默认口令不得当作生产可用方案文档化传播  

---

## 6. 可维护性底线

1. **一个领域一个目录**；README 写清职责、导出、API/WS、依赖  
2. **单一真相**：数值表/校验函数放 shared，禁止 server/app 各抄一份后分叉  
3. **小 PR/小 commit**：一个提交一类事；大重构拆步  
4. **不无关格式化**整文件，减少 diff 噪音  
5. **改协议必改文档**（`docs/API文档.md` 或领域 README）  
6. **新依赖**：默认不引入；大框架整迁需用户明确同意  
7. **测试**：至少覆盖鉴权失败、经济 happy path、重复领奖不双发（相关时）  
8. **可观测**：关键错误有稳定 error code；不要静默吞掉安全失败  

---

## 7. Git 硬约束（本地仓库，AI 必守）

完整手册：[ai-git-playbook.md](./docs/git/ai-git-playbook.md)

### 7.1 分支

| 分支 | 用途 |
|------|------|
| `develop` | **默认工作分支**（AI 日常提交点） |
| `main` | 稳定可玩线；不堆半成品 |
| `feature/<scope>` | 大改/并行时从 develop 拉出 |
| `hotfix/<fix>` | 从 main 热修，再合并回 main + develop |

- 开始工作前：`git status`、`git branch`，确认在 `develop`（或用户指定 feature）  
- **不要**在 `main` 上直接做大特征开发  

### 7.2 提交

- 格式：`type(scope): 摘要`（见 commit-convention）  
- **精确 `git add <路径>`**，禁止无脑 `git add .` 若 status 里可能有 sqlite/密钥/杂文件  
- 提交前必须看：`git status` + `git diff --stat`  
- 重构 commit 与行为变更 commit **拆开**  
- 禁止提交：`*.sqlite*`、`.env`、`node_modules`、日志、含密钥文件  

### 7.3 危险操作（默认禁止）

除非用户**明确要求**，AI 不得：

- `git reset --hard`（尤其对 `main`）  
- `git push --force` / 改写已共享历史（即使将来有远程）  
- `git clean -fdx`  
- 删除 `.git`  
- 修改 `git config --global`  
- 用 amend 改写**非本次会话刚创建且用户未要求**的旧提交  

### 7.4 数据与回滚认知

- 回滚代码 **不会** 回滚 `players.sqlite`  
- 涉及迁库/清档/批量改经济前：提醒用户备份 DB，或在 `scripts/` 写可重复执行的迁移并说明不可逆性  

### 7.5 提交信息类型（商用常用）

`feat` `fix` `security` `refactor` `perf` `docs` `test` `chore` `revert`

安全相关优先用 `security(scope):`，便于审计检索。

---

## 8. 每次交付前自检清单

### 结构

- [ ] 业务主代码不在 `server.js` / `app.js`  
- [ ] 新文件在正确领域目录；命名能看出职责  
- [ ] 无双份实现；迁走后旧代码已删或确认为薄委托  

### 安全 / 商用

- [ ] 经济/权限服务端权威  
- [ ] SQL 参数化；管理/玩家鉴权未裸奔  
- [ ] 无明文密码存储；无新硬编码万能兑换码  
- [ ] 无静态路径逃逸；无密钥写入仓库文件  
- [ ] 失败路径返回稳定 error，不误把异常当成功  

### Git

- [ ] 当前分支正确（多为 develop）  
- [ ] `git status` 干净意图；无 sqlite/.env 待提交  
- [ ] 精确 add；commit message 符合规范  
- [ ] 需要时已更新 AGENTS §3 / API 文档 / 领域 README  

### 验证

- [ ] 能启动：`node server.js` 或 `一键启动.bat`  
- [ ] 相关 happy path；未登录 401；涉及经济则防重复领取  

---

## 9. 与现有技术栈对齐

- 运行时：Node.js  
- HTTP：内置 `http`；WS：自研升级  
- DB：`node:sqlite`（`DatabaseSync`）  
- 模块：CommonJS 为主；工厂注入依赖  
- 中文领域目录可保留；大规模新代码可用 `src/server|client|shared`  
- **不维护** 上线打包/混淆链路；不要擅自加回 pkg/obfuscator 当「安全方案」  

---

## 10. 明确不要做

- ❌ 业务先堆入口「以后再拆」  
- ❌ 双份真理（搬迁后不删旧逻辑）  
- ❌ 信任客户端战斗/奖励结果直接入账  
- ❌ 为省事关闭鉴权、白名单、生产密钥检查  
- ❌ 提交玩家库、真实口令、完整 session  
- ❌ 无必要全文件 reformat / 乱改无关模块  
- ❌ 擅自整迁大型框架（Express/Nest/React 全盘）除非用户明确要求  
- ❌ 危险 git 操作（§7.3）  
- ❌ 用「文档里写了 TODO」代替本次应做的鉴权/校验  

---

## 11. 用户可复制提示词

```text
先读 AGENTS.md、docs/agents/、docs/git/ai-git-playbook.md。
这是要商用的游戏：安全与可维护优先。
在 develop 分支按领域模块实现：<需求>
约束：
- 禁止把业务堆进 app.js/server.js（只准接线）
- 服务端权威；SQL 参数化；鉴权不裸奔
- 按 docs/git 正确使用本地 Git：精确 add、conventional commit、不做危险 reset
- 交付前走 AGENTS 自检清单
```

---

## 12. 维护责任

- 新增领域 → 更新 §3 + 领域 README  
- 新增安全/Git 红线 → 更新本文与对应 docs  
- 发现入口再次膨胀 → 先 `refactor` 迁移提交，再 `feat/fix`  
- 文档互斥时以**更严、更利商用安全与可回滚**为准  
