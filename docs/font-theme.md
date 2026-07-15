# 字体主题模块

## 目标

本项目不使用点阵像素字体，而是使用更适合像素游戏气质的清晰中文 UI 字体栈：圆润、易读、低干扰，并能在小字号下保持稳定。

字体配置集中在根目录的 `font-theme.css`，避免字体选择散落在 `styles.css` 和 `app.js` 中。

## 当前字体变量

- `--font-ui`
  - 用途：默认界面、按钮、输入框、菜单。
  - 当前栈：`Noto Sans SC`、`Alibaba PuHuiTi`、微软雅黑、系统字体。

- `--font-map-label`
  - 用途：地图上角色、宠物、NPC 头顶名称。
  - 当前栈：优先清晰黑体类字体，保证小字号可读。

- `--font-dialog`
  - 用途：气泡、对白、聊天类 Canvas 文本。
  - 当前栈：优先 `LXGW WenKai`，没有安装时回退到清晰黑体。

- `--font-accent`
  - 用途：后续可用于活动标题、强调按钮、特殊标签。
  - 当前栈：优先 `Smiley Sans`，没有安装时回退到清晰黑体。

## 推荐字体

- `Noto Sans SC / 思源黑体`
  - 稳定、清晰，适合地图名字、NPC 名字、系统 UI。

- `Alibaba PuHuiTi / 阿里巴巴普惠体`
  - 现代、干净，适合菜单、排行榜、属性面板。

- `LXGW WenKai / 霞鹜文楷`
  - 有 RPG 对话感，适合对白和任务文本，不建议用于很小的数字密集 UI。

- `Smiley Sans / 得意黑`
  - 活泼，有游戏标题感，适合活动标题和强调文案，不建议大段正文。

## 替换成本地字体文件

如需离线内置字体，将字体文件放到 `assets/fonts/`，然后在 `font-theme.css` 顶部增加：

```css
@font-face {
  font-family: "Game UI";
  src: url("assets/fonts/GameUI.woff2") format("woff2");
  font-display: swap;
}

:root {
  --font-ui: "Game UI", "Noto Sans SC", "Microsoft YaHei UI", sans-serif;
}
```

Canvas 文字会通过 `app.js` 读取同一套 CSS 变量，因此替换变量后，DOM UI 和地图/战斗 Canvas 文本会一起生效。
