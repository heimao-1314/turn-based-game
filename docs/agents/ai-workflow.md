# AI 完全开发工作流（商用向）

从**接到需求**到**本地 Git 提交**的标准路径。强制规则见 [AGENTS.md](../../AGENTS.md)；Git 细节见 [ai-git-playbook.md](../git/ai-git-playbook.md)；验收见 [commercial-bar.md](./commercial-bar.md)。

---

## 1. 会话启动（每次必做）

1. 读 [AGENTS.md](../../AGENTS.md)  
2. 读本文 + [module-structure.md](./module-structure.md) + [coding-rules.md](./coding-rules.md)  
3. 涉及资产/登录/管理/暴露面 → 读 [commercial-bar.md](./commercial-bar.md) 与 [security-hardening-plan.md](../security-hardening-plan.md)  
4. 执行：

```bash
git status
git branch --show-current
git log --oneline -5
```

5. 确认在 `develop`（或指定 feature）；用 AGENTS §3 定位领域；无则新建目录并计划更新落点表  

若工作区已有无关脏文件：**不要覆盖**；先报告或只 stage 自己的路径。

---

## 2. 需求拆解（商用思维）

对每个需求先写清（可在回复里简短列出）：

| 问题 | 例 |
|------|----|
| 谁可以调用？ | 登录玩家 / 管理员 / 仅本机 |
| 影响哪些资产？ | 金币、道具、经验、战绩 |
| 失败模式？ | 401、冷却、次数用尽、并发 |
| 落点目录？ | `生活技能/` … |
| 是否要先 refactor 搬迁？ | 触及入口大段则是 |

没有鉴权与失败模式的设计 = 尚未可实现。

---

## 3. 实现顺序

```text
A. （可选）refactor：把将修改的旧逻辑迁到模块，行为不变，单独 commit
B. 模块内实现业务 + 校验 + 事务/幂等
C. server.js / app.js 只接线
D. 文档：README / API / AGENTS §3
E. 按 commercial-bar 跑相关验收
F. 精确 git add + conventional commit
```

### 硬约束

- 禁止入口堆业务  
- 经济服务端权威  
- SQL 参数化  
- 不提交 sqlite / .env  
- 危险 git 命令默认禁止  

---

## 4. 新建功能最小模板

### 服务端

```text
领域名/
  README.md      # 职责、API、鉴权、错误码
  server.js      # createXxxRuntime(deps)
```

### 客户端

```text
领域名/
  client.js      # initXxx(ctx)
```

### 接线

- 根 `server.js`：require + 注入 deps + handleApi 认领  
- 根 `app.js`：init 调用  

---

## 5. 验证（提交前）

最低：

1. 服务器可启动  
2. 相关 happy path  
3. 未登录 / 错误 token → 401  
4. 经济类：重复请求不双发  
5. `git status` 无敏感文件  

触及 S*/E* 条时对照 [commercial-bar.md](./commercial-bar.md)。

---

## 6. 提交

```bash
git add <精确路径>
git commit -m "feat(scope): 摘要"
git status
```

Message 规范：[commit-convention.md](../git/commit-convention.md)  
操作纪律：[ai-git-playbook.md](../git/ai-git-playbook.md)

---

## 7. 完成时汇报结构（建议）

1. 做了什么（用户语言）  
2. 代码落点（目录/文件）  
3. 安全/经济如何满足  
4. Git 分支与 commit  
5. 残余风险与后续建议  

---

## 8. 用户可复制提示词

```text
先读 AGENTS.md、docs/agents/、docs/git/ai-git-playbook.md。
商用标准：安全 + 可维护 + 可回滚。
在 develop 用领域模块实现：<需求>
入口禁止堆业务；服务端权威；精确 git add 与 conventional commit；交付前自检。
```
