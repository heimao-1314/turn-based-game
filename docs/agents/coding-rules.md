# AI 编码细则（商用向）

配合 [AGENTS.md](../../AGENTS.md)、[module-structure.md](./module-structure.md)、[ai-workflow.md](./ai-workflow.md)、[commercial-bar.md](./commercial-bar.md)。

## 1. 语言与注释

- 沟通：简体中文  
- 代码标识符：英文；领域目录允许中文  
- 注释写**不变量、安全边界、并发假设**，不复述字面代码  
- 对外 error code 用稳定 `snake_case`  

## 2. JavaScript

- 服务端 CommonJS 为主  
- 早返回；纯函数与副作用分离  
- 禁止 `eval` / 动态 `Function` 执行用户输入  
- 禁止借机全文件无意义 reformat  
- 新增代码应比周围旧代码**更短路径、更显式校验**  

## 3. HTTP API

- 路径：`/api/<domain>/<action>`；管理端 `/api/admin/...`  
- 响应：`{ ok: true, ... }` / `{ ok: false, error: "code" }`  
- 鉴权分层：玩家会话 vs 管理凭证；禁止「知道 account 就能改」  
- 改协议同步 `docs/API文档.md` 或领域 README  
- 输入校验：类型、范围、长度、枚举；先校验再查库  

## 4. WebSocket

- `type` 建议 `domain.action`  
- 身份以连接 meta / 会话为准  
- 断线清理房间、匹配、定时器  
- 广播最小化字段，避免把他人背包全量推给无关人  

## 5. 数据库

- 仅 `prepare` + 占位符  
- 资产写：`BEGIN IMMEDIATE` … 校验 … 写 … `COMMIT`  
- 不信任客户端等级/攻击/货币增量  
- 新列默认值 + 启动迁移路径，避免老库崩溃  
- DB 文件不入库、不静态暴露；生产可用 `PLAYER_DB_PATH` 放到站点外  

## 6. 安全编码清单

| 主题 | 要求 |
|------|------|
| 密码 | 禁止明文；禁止弱化算法；前端禁止存密码 |
| 会话 | 高熵 token；过期；绑定角色/区服若业务需要 |
| 管理端 | 环境变量；短时效凭证方向；失败可限流 |
| 兑换码 | DB 规则；服务端校验 |
| 路径 | 白名单 + normalize + 拒绝 `..` |
| XSS | 慎用 innerHTML |
| 日志 | 无密码/token 全文 |
| 经济 | 服务端 roll；幂等；anomaly |
| 依赖 | 不拿混淆当安全 |

## 7. 客户端

- DOM 空指针容错  
- 触屏/键鼠双端  
- 状态更新可追踪，避免隐式全局魔法字符串扩散  
- UI 可以乐观显示，**入账以服务端响应为准** 并回滚乐观态  

## 8. 测试最低线

1. happy path  
2. 401/403  
3. 经济重复请求  
4. 启动成功  

测试放 `scripts/` 或领域旁；不要只靠手工且无说明。

## 9. Git（摘要）

全文：[ai-git-playbook.md](../git/ai-git-playbook.md)

- 默认分支 `develop`  
- 精确 add；conventional commits  
- 禁止危险 reset/force/clean  
- 不提交 sqlite/.env  

## 10. 依赖与架构

- 不擅自引入大型框架/ORM  
- 不恢复上线打包混淆链路作为安全手段  
- 实验功能环境变量开关，默认关闭  

## 11. 文档义务

| 情况 | 更新 |
|------|------|
| 新领域 | AGENTS §3 + README |
| 新红线 | AGENTS / 本文 / commercial-bar |
| 新 API/WS | API 文档或 README |
| 安全模型 | security-hardening-plan |
| Git 习惯变更 | docs/git/* |

## 12. 决策优先级

与 AGENTS §0.3 相同：用户指令 → AGENTS → agents/git 文档 → 同领域风格 → 通用实践；并列时选更安全可回滚。
