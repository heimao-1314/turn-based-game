# 回滚指南

> 优先读 [ai-git-playbook.md](./ai-git-playbook.md) 的危险命令表。

## 未 commit

```bash
git restore -- path/to/file
git restore --staged path/to/file
```

## 改写刚做的 commit（仅限确认是自己刚提交且用户需要）

```bash
git add ...
git commit --amend --no-edit
```

## 丢掉最近 1 个 commit，保留改动

```bash
git reset --mixed HEAD~1
```

## 彻底丢掉最近 1 个 commit（危险）

```bash
git reset --hard HEAD~1
```

**AI 默认不做 hard reset**，除非用户明确要求并确认分支。

## 安全反做任意提交

```bash
git revert <commit-hash>
```

## 误删文件

```bash
git checkout HEAD -- path/to/file
```

## 数据

- 回滚代码 **不会** 回滚 `players.sqlite`  
- 批量改经济/迁库前先备份 DB 文件  
