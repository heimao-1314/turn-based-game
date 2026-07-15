# AGENTS.md — AI 编程强制规则（本仓库）

> **每次改代码前必读本文。**  
> 本项目面向 **AI 完全开发**：新功能与改动默认落到模块目录，禁止继续把逻辑堆进巨型入口文件。

## 0. 一句话总则

**`server.js` 和 `app.js` 只做装配与薄封装，不做新业务。**  
新逻辑写进对应模块；改旧逻辑先把相关代码迁出，再改。

## 1. 必读文档（按顺序）

| 优先级 | 文件 | 内容 |
|--------|------|------|
| 1 | [AGENTS.md](./AGENTS.md)（本文） | 强制规则、禁止事项、落点表 |
| 2 | [docs/agents/ai-workflow.md](./docs/agents/ai-workflow.md) | AI 从需求到提交的完整工作流 |
| 3 | [docs/agents/module-structure.md](./docs/agents/module-structure.md) | 目录职责、新建模块模板、迁移策略 |
| 4 | [docs/agents/coding-rules.md](./docs/agents/coding-rules.md) | 命名、API、安全、DB、WS 细则 |
| 5 | [docs/git/](./docs/git/) | 分支 / 提交 / 回滚 |
| 6 | [docs/security-hardening-plan.md](./docs/security-hardening-plan.md) | 安全措施与生产要求 |
| 7 | 相关玩法文档 `docs/*.md` | 战斗 / API / 地图等 |

## 2. 巨型文件红线（硬约束）

### 2.1 禁止直接往这些文件「堆业务」

| 文件 | 允许写什么 | 禁止写什么 |
|------|------------|------------|
| `server.js` | `require` 模块、创建 server、挂路由/运行时、启动引导 | 新 API 业务、新 SQL 流程、新玩法数值、大段工具函数 |
| `app.js` | 初始化、注册模块、极薄全局胶水 | 新 UI 系统、新玩法流程、大段状态机、新面板逻辑 |
| `admin.js` | 管理端入口胶水 | 大段新后台业务（拆到模块内 admin 文件） |
| `styles.css` | 全局变量、重置、跨页基础样式 | 某功能独占大段样式 |

### 2.2 行数预算

- 改 `server.js` / `app.js`：**单次 diff 业务净增建议 ≤ 30 行**；超过必须进模块。  
- 入口仅允许 3～15 行接线代码。  
- 触达入口内已有大段逻辑（约 >50 行）：**先抽出模块，再改行为**。

### 2.3 入口改动白名单

1. `require` / 注册新模块  
2. 路由表 / WS 消息表挂 handler  
3. 客户端启动序列 `initXxx`  
4. 入口级 bug（仍优先下沉）  
5. 删除已迁移死代码  

## 3. 新功能落点速查表

| 需求类型 | 优先写入 | 不要写入 |
|----------|----------|----------|
| HTTP API / 账户 / 背包 / 商店 / 兑换码 | 领域目录或 `src/server/` | `server.js` 巨型 if 内 |
| WebSocket / 房间 | `联网战斗/`、`队伍/`、`src/server/realtime/` | `server.js` 消息堆业务 |
| 全服竞技场 | `全服竞技场/` | `app.js` / `server.js` 正文 |
| 仙气修炼 | `仙气修炼/` | 同上 |
| 疯狂吹牛 | `疯狂吹牛/` | 同上 |
| 地图 / 管理端地图 | `地图系统/` | 同上 |
| 宠物 | `宠物模块/` | 同上 |
| 职业 | `职业模块/` | 同上 |
| 生活技能 | `生活技能/` | 同上 |
| 副本 | `副本模块/` | 同上 |
| 回合战斗表现 | `战斗/` | `app.js` 继续堆 |
| 组队 | `队伍/` | 同上 |
| 菜单 UI | `菜单UI/` | 同上 |
| 小地图飞图 | `飞图小地图/` | 同上 |
| 前后端共享纯函数 | `src/shared/` 或领域 `shared.js` | server/app 双份复制 |
| 管理后台能力 | 领域 `admin.js` 或 `admin/` | 仅堆 `admin.js` |
| 脚本 / 测试 | `scripts/` | 业务目录 |
| 文档 | `docs/`、`docs/agents/`、模块 `README.md` | 只写在聊天里 |

**新系统：** 新建领域目录，并更新本表。

## 4. 标准工作流

详见 [ai-workflow.md](./docs/agents/ai-workflow.md)。

```text
1. 定位领域（§3）
2. 读该目录导出方式（createXxxRuntime 等）
3. 模块内实现
4. server.js / app.js 只接线
5. 协议变更则更新文档
6. 自检 §6 → commit（docs/git/commit-convention.md）
```

## 5. 安全底线

1. `NODE_ENV=production` 时管理员密钥必须来自环境变量（见 `.env.example`）  
2. 静态文件白名单；禁止任意路径 `fs.readFile` 对外  
3. 奖励 / 背包 / 交易：**服务端权威**  
4. 密码只允许加强（scrypt/argon2 方向），禁止明文  
5. 禁止密钥、完整 token 入库或写进前端常量  
6. 兑换码优先数据库配置，不在 `app.js` 硬编码新码  
7. **禁止** 提交 `*.sqlite*`、`.env`  

## 6. 每次交付前自检

- [ ] 业务主代码不在 `server.js` / `app.js`  
- [ ] 新文件在正确领域目录  
- [ ] 无明文密码存储；无客户端可信经济结算  
- [ ] SQL 参数化；管理接口有鉴权  
- [ ] 不提交 sqlite / .env / node_modules  
- [ ] 新目录已更新 §3；协议已更新文档  
- [ ] 提交信息符合 conventional commits  

## 7. Git 约定（本仓库已启用）

- 默认开发分支：**`develop`**  
- 稳定分支：`main`  
- 忽略规则：`.gitignore`（数据库、密钥、日志、output 等）  
- 分支 / 提交 / 回滚：`docs/git/`  
- **不要** `git init` 第二次；**不要** 强推改写已共享历史（除非用户明确要求）  

## 8. 与现有风格对齐

- Node.js + 内置 `http` + 自研 WebSocket + `node:sqlite`  
- 模块导出优先 `createXxxRuntime(deps)` / `createXxxApi(deps)`  
- 中文领域目录可保留；大规模新树推荐 `src/server|client|shared`  
- 不为重构而重构；无测试时用绞杀者迁移  

## 9. 明确不要做

- ❌ 「先写在 app.js/server.js，以后再拆」  
- ❌ 双份实现（迁走后不删旧代码）  
- ❌ 擅自整迁 Express/Nest/React（除非用户明确要求）  
- ❌ 用混淆代替安全设计  
- ❌ 绕过静态白名单 / 管理鉴权  
- ❌ 提交真实生产密码或玩家数据库  

## 10. 用户可复制提示词

```text
先读 AGENTS.md 和 docs/agents/。
当前在 develop 分支工作。
功能：<一句话>
约束：业务代码不要写进 app.js/server.js，只允许入口接线；
按领域目录实现；服务端权威；SQL 参数化；
完成后按 docs/git 规范提交。
```

## 11. 维护责任

- 新增领域目录 → 更新 §3 + 领域 README  
- 入口再次膨胀 → 先做「只迁移不改行为」提交  
- 文档冲突 → 以更严格、更利拆分的规则为准  
