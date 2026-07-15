# 回滚指南（AI / 人类速查）

## 还没 commit

```bash
# 丢弃某文件工作区修改
git checkout -- path/to/file

# 取消已 stage
git restore --staged path/to/file
```

## 最近一次 commit 写错了（还没 push）

```bash
# 改 commit 信息或追加文件后重写最后一次
git add ...
git commit --amend --no-edit
```

## 丢掉最近 1 个 commit，保留改动在工作区

```bash
git reset --mixed HEAD~1
```

## 彻底丢掉最近 1 个 commit 和改动（危险）

```bash
git reset --hard HEAD~1
```

## 已 push 或需要安全反做

```bash
git revert <commit-hash>
```

## 误删文件

```bash
git checkout HEAD -- path/to/file
```

## AI 特别注意

- 不要对 `main` 做 `reset --hard` 除非用户明确要求  
- 回滚前用 `git log --oneline -10` 确认目标  
- 数据库不在 Git 里：回滚代码**不会**回滚 `players.sqlite`，需自行备份数据文件  
