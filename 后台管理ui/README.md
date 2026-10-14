# 后台管理ui

管理后台（admin.html）的 UI 领域目录。

## 文件

| 文件 | 职责 |
|------|------|
| login-visual-editor.js | 登录界面封面按钮位置可视化编辑器：在预览图上拖拽「登录游戏」按钮调水平位置、右下角手柄调宽高、箭头调横向位置、5 个菜单标记调纵向 Y |
| admin_apple_glassmorphism-v2.html | Apple 玻璃拟态风格参考稿 |
| 后台管理ui风格.md | 设计系统参考（macOS Liquid Glassmorphism） |

## login-visual-editor.js

- 挂载：`window.LoginVisualEditor`
- 依赖：admin.html 中 `#loginPreview` 预览容器；admin.js System 模块注入 `read`（`readLoginVisualForm`）与 `applyPartial`（`applyLoginVisualPartial`）完成表单双向同步。
- 交互：
  - 拖动「登录游戏」按钮：水平 → `hotspotLeft`，垂直 → `positions[1]`；
  - 右下角手柄：`hotspotWidth` / `hotspotHeight`（按钮保持在预览可视范围内）；
  - 拖动箭头：`arrowLeft`；
  - 拖动菜单标记：`positions[0..4]`。
- 纯客户端 UI 模块，不直接读写服务端；保存仍走 `/api/admin/login-visual`。

## 登录界面配置（`login_visual`）

- 除编辑器字段外，配置还包含 `videoSkipStart`（布尔，是否屏蔽视频封面开头）与 `videoSkipStartTime`（秒，跳过开头时长，默认 0.1）。
- 游戏端在 `菜单UI/login-media-runtime.js` 中应用：开启时视频在到达跳过点前保持隐藏，并把播放头推到跳过点，首次加载与循环回开头都不会闪现开头帧。
