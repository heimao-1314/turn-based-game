# Git 分支策略（适合 AI 连续开发）

## 默认模型（保持简单）

```text
main      可运行的稳定线（随时能启动游戏）
develop   日常集成线（AI 默认在此开发）
feature/* 单功能分支（可选；大改/并行时用）
hotfix/*  从 main 拉出的紧急修复
```

单人 + AI 开发时：**可以只在 develop 上提交**；功能变大或需要并行时再开 `feature/*`。

## 规则

| 分支 | 用途 | AI 约束 |
|------|------|---------|
| `main` | 稳定可玩 | 不直接堆半成品；合并前应能 `node server.js` 启动 |
| `develop` | 默认工作分支 | 新功能/重构默认提交到这里 |
| `feature/<scope>` | 单一领域改动 | 命名用英文 scope：`feature/auth-session`、`feature/bag-repo` |
| `hotfix/<fix>` | 生产热修 | 修完合并回 `main` 与 `develop` |

## AI 推荐流程

### 小改动（几小时内能完成）

```bash
git checkout develop
# ... 按 AGENTS.md 改模块 ...
git add <相关文件>
git commit -m "feat(bag): ..."
```

### 大改动（重构入口、鉴权、经济）

```bash
git checkout develop
git checkout -b feature/extract-auth
# 先迁移再改行为，小步提交
git commit -m "refactor(auth): extract session helpers"
git commit -m "feat(auth): scrypt password hash"
git checkout develop
git merge --no-ff feature/extract-auth
git branch -d feature/extract-auth
```

### 发布到 main（可选）

```bash
git checkout main
git merge --no-ff develop
git tag -a v1.x.y -m "说明"
git checkout develop
```

## 禁止

- 在 `main` 上做实验性大爆炸提交
- 把 `players.sqlite`、`.env`、密钥提交进仓库
- 一个分支同时塞多个无关系统（难回滚）
