# AI 完全开发工作流

本文告诉 AI：**从接到需求到提交**，每一步怎么做，才不会把项目再次堆成屎山。

## 1. 会话启动（每次必做）

1. 读 [AGENTS.md](../../AGENTS.md)  
2. 读 [module-structure.md](./module-structure.md)、[coding-rules.md](./coding-rules.md)  
3. 若涉及安全：读 [security-hardening-plan.md](../security-hardening-plan.md)  
4. `git status` + 当前分支确认（默认应在 `develop`）  
5. 用落点表定位领域目录；没有则新建目录并更新 AGENTS §3  

## 2. 实现顺序

```text
定位领域 → 读同目录现有导出 → 模块内实现
→ 根入口仅接线（server.js / app.js）
→ 安全/SQL/鉴权自检 → 本地启动验证
→ 更新文档（若约定/API 变化）→ 小步 commit
```

### 硬约束回顾

- **禁止** 在 `app.js` / `server.js` 堆新业务（只准薄接线）  
- 单次入口业务净增建议 ≤ 30 行  
- 改旧巨型逻辑：先抽出模块（行为不变），再改需求  
- 经济/奖励：**服务端权威**  
- SQL：**参数化**  
- 不提交 sqlite / .env / 密钥  

## 3. 新建功能模板

### 服务端

```text
领域名/
  README.md
  server.js    # createXxxRuntime(deps) 或 handleApi
```

根 `server.js`：`require` + 注册调用。

### 客户端

```text
领域名/
  client.js    # initXxx(ctx)
```

根 `app.js`：启动序列调用 init。

## 4. 验证清单（提交前）

- [ ] 业务代码主落点不在 app.js/server.js  
- [ ] `node server.js` 可启动（或用户环境等价方式）  
- [ ] 未登录接口 401；管理接口仍鉴权  
- [ ] 无新的明文密码存储 / 客户端可信结算  
- [ ] `git status` 无 sqlite、.env、node_modules  
- [ ] 需要时已更新 AGENTS 落点表 / API 文档  

## 5. 提交

```bash
git add <精确路径>
git commit -m "feat(scope): 摘要"
```

规范见 [commit-convention.md](../git/commit-convention.md)。

## 6. 与用户协作话术（用户可复制）

```text
先读 AGENTS.md 与 docs/agents/。
在 develop 分支按领域模块实现：<需求>
约束：禁止把业务堆进 app.js/server.js；服务端权威；SQL 参数化；
完成后自检并按 conventional commit 提交。
```

## 7. 分支

见 [branch-strategy.md](../git/branch-strategy.md)。默认 `develop`；大重构开 `feature/<scope>`。
