# Git 分支策略（本地 · 适合 AI）

> AI 操作逐步清单见 [ai-git-playbook.md](./ai-git-playbook.md)。

## 模型

```text
main      稳定可玩（不堆半成品）
develop   默认开发与集成（AI 日常提交点）
feature/* 大块功能或重构
hotfix/*  从 main 热修 → 合并回 main + develop
```

单人 + AI：小改可只在 `develop`；大改开 `feature/<scope>`。

## 规则

| 分支 | AI 约束 |
|------|---------|
| `main` | 不直接开新系统；合并前应可启动 |
| `develop` | 默认工作分支 |
| `feature/<scope>` | 英文 scope；一事一支；合并后删除 |
| `hotfix/<fix>` | 修完双合并 |

## 流程摘要

### 日常

```bash
git checkout develop
# 开发…
git add <paths>
git commit -m "feat(scope): ..."
```

### 大重构

```bash
git checkout -b feature/extract-economy
# 多步 refactor / feat / security 小提交
git checkout develop
git merge --no-ff feature/extract-economy
git branch -d feature/extract-economy
```

### 可选：标记稳定

```bash
git checkout main
git merge --no-ff develop
git checkout develop
```

## 禁止

- 在 `main` 实验性连击提交  
- 提交 sqlite / .env / 密钥  
- 无用户授权的 hard reset / 删 .git  
