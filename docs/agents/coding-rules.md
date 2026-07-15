# AI 编码细则（本项目）

配合 [AGENTS.md](../../AGENTS.md)、[module-structure.md](./module-structure.md)、[ai-workflow.md](./ai-workflow.md)。

## 1. 语言

- 沟通：简体中文  
- 标识符：英文  
- 领域目录名：允许中文  
- 注释写原因与边界  

## 2. JavaScript

- 服务端以 CommonJS 为主  
- 早返回；小函数  
- 禁止 `eval` / 动态 `Function` 执行用户输入  
- 禁止无关大范围格式化  

## 3. HTTP API

- `/api/<domain>/<action>`；管理端 `/api/admin/...`  
- `{ ok: true }` / `{ ok: false, error: "snake_case" }`  
- 玩家接口鉴权；管理接口鉴权不得裸奔  
- 改协议同步文档  

## 4. WebSocket

- 明确 `type`（建议 `domain.action`）  
- 校验会话绑定账号，防冒充  
- 断开清理房间与定时器  

## 5. 数据库

- 参数化 SQL  
- 不信任客户端属性/货币增量  
- 新列有默认值与迁移路径  
- 不把 DB 当静态资源暴露  

## 6. 安全

| 主题 | 要求 |
|------|------|
| 密码 | 禁止明文；前端禁止 localStorage 存密码 |
| 会话 | 足够长的随机 token；校验过期 |
| 管理端 | 生产环境变量；禁止硬编码生产口令入库 |
| 兑换码 | 优先 DB |
| 路径 | 静态白名单 |
| XSS | 慎用 innerHTML |
| 经济 | 服务端 roll 奖励 |
| Git | 不提交 `.env`、`*.sqlite*` |

## 7. 客户端

- DOM 查询容错  
- 双端（触屏/键鼠）  
- 样式避免污染全局  

## 8. 测试最低线

1. happy path  
2. 未登录 401  
3. 经济接口防双花（若涉及）  
4. 能启动服务器  

## 9. Git

- 分支：见 `docs/git/branch-strategy.md`  
- 提交：见 `docs/git/commit-convention.md`  
- 回滚：见 `docs/git/rollback-guide.md`  
- stage 前检查 status，拒绝 sqlite/密钥  

## 10. 依赖纪律

- 不擅自引入大型框架  
- 本仓库不维护上线打包/混淆链路（勿自动加回 pkg/obfuscator）  
- 实验功能用环境变量开关  

## 11. 文档更新义务

| 情况 | 更新 |
|------|------|
| 新领域 | AGENTS §3 + 领域 README |
| 新红线 | AGENTS / 本文 |
| 新 API/WS | docs/API文档.md 或领域 README |
| 安全模型 | docs/security-hardening-plan.md |

## 12. 决策优先级

1. 用户当前明确指令  
2. AGENTS.md  
3. agents / git 文档  
4. 同领域现有风格  
5. 一般最佳实践  
