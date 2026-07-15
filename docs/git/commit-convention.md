# Commit 规范（Conventional Commits + 游戏 scope）

## 格式

```text
<type>(<scope>): <摘要>

[正文：为什么改 / 风险 / 迁移注意]
```

- 摘要建议 ≤ 50 字，中英文均可
- **一次提交只做一类事**（AI 尤其要遵守，方便 revert）

## type

| type | 何时用 |
|------|--------|
| `feat` | 新功能、新 API、新面板 |
| `fix` | Bug |
| `refactor` | 拆模块/挪代码，行为不变或几乎不变 |
| `security` | 鉴权、哈希、越权、注入等 |
| `perf` | 性能 |
| `docs` | 仅文档（含 AGENTS.md） |
| `test` | 测试脚本 |
| `chore` | 工具、忽略规则、杂项 |
| `style` | 纯格式，无逻辑变化 |
| `revert` | 回滚 |

## scope（优先用领域）

`auth` `player` `bag` `shop` `redeem` `battle` `arena` `team` `map` `pet` `career` `admin` `ws` `db` `ui` `agents` `git`

示例：

```text
feat(redeem): 兑换码改为数据库配置
fix(battle): 修复回合开始时速度排序错误
refactor(server): 抽出 bag 路由到领域模块
security(auth): 密码改为 scrypt 并迁移旧哈希
docs(agents): 补充新功能落点表
chore(git): 完善 gitignore 忽略运行时库
```

## AI 提交纪律

1. **先读 `git status` / diff**，只 stage 相关文件  
2. 不把调试日志、sqlite、密钥加进去  
3. 重构与行为变更尽量分成两次 commit  
4. 摘要里写清领域，方便以后 `git log --grep`  
5. 若改了模块约定：同一次或紧接着 `docs(agents): ...`
