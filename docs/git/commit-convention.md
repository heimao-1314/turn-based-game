# Commit 规范（Conventional Commits）

> AI 何时 commit、如何 add 见 [ai-git-playbook.md](./ai-git-playbook.md)。

## 格式

```text
<type>(<scope>): <摘要>

[正文：为什么 / 风险 / 迁移 / 安全影响]
```

- 摘要简洁（中英文均可）  
- **一次提交一类事**（便于 revert 与安全审计）  

## type

| type | 用途 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug |
| `security` | 鉴权、越权、注入、经济刷取修复等 |
| `refactor` | 行为不变的结构搬家 |
| `perf` | 性能 |
| `docs` | 文档（含 AGENTS） |
| `test` | 测试 |
| `chore` | 工具杂项 |
| `style` | 纯格式 |
| `revert` | 回滚 |

## scope 示例

`auth` `player` `bag` `shop` `redeem` `battle` `arena` `team` `map` `pet` `career` `admin` `ws` `db` `ui` `agents` `git` `economy`

## 示例

```text
feat(redeem): 兑换码改为数据库配置与每号限次
fix(battle): 修复速度相同回合顺序不稳定
security(auth): 忽略客户端伪造 account 并记录 anomaly
refactor(server): 抽出 bag 路由到领域模块（行为不变）
docs(agents): 增加商用验收条与 Git 手册
```

## AI 纪律

1. commit 前 `status` + `diff`  
2. 精确 add  
3. 重构与行为变更拆开  
4. 安全修复用 `security` 类型  
5. 禁止把密钥/DB 写入历史  
