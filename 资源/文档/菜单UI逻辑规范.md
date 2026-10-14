# 菜单 UI 逻辑规范

本文记录当前网页端菜单系统的素材、结构、按键逻辑和复用规则。后续新增菜单类界面，统一使用这套菜单 UI 包裹。

## 素材

- `菜单ui边框角落(左上角).png`：左上角边框。其它三个角通过 CSS 翻转生成。
- `菜单ui边框横.png`：上下横边，横向 repeat。
- `菜单ui边框竖.png`：左右竖边，纵向 repeat。
- `菜单图标1.png`：18x18 图标横向排列，共 51 个。
- `菜单图标2.png`：18x18 图标横向排列，共 28 个。

图标编号格式为 `图集.序号`，例如 `2.8` 表示 `菜单图标2.png` 的第 8 个图标。CSS 背景偏移为：

```js
background-position: -((序号 - 1) * 18)px 0;
```

## 边框复用

JS 里使用 `decorateMenuFrame(element)` 给任意菜单容器添加边框：

- 自动添加四个 `.menu-frame-corner`
- 自动添加四条 `.menu-frame-edge`
- 角落翻转规则：
  - `tl`：原图
  - `tr`：`scaleX(-1)`
  - `bl`：`scaleY(-1)`
  - `br`：`scale(-1, -1)`

使用方式：

```js
decorateMenuFrame(document.querySelector("#someMenu"));
```

如果是按钮，也可以直接加：

```html
<button class="menu-framed-button">确定</button>
```

然后在渲染后调用：

```js
document.querySelectorAll(".menu-framed-button").forEach(decorateMenuFrame);
```

## 主菜单

主菜单 DOM：

```html
<div id="mainMenu" class="main-menu">
  <div id="mainMenuTabs" class="main-menu-tabs"></div>
  <div id="mainMenuList" class="main-menu-list"></div>
  <div class="main-menu-footer">
    <button id="mainMenuConfirm" class="menu-framed-button">确定</button>
    <button id="mainMenuBack" class="menu-framed-button">返回</button>
  </div>
</div>
```

主标题：

- `1 常用`
- `3 辅助`
- `7 聊天`
- `9 任务`
- `0 系统`
- `商城`

按键逻辑：

- 左右键：切换主标题
- 上下键：选择二级菜单项
- 确定键：执行当前菜单项
- 返回键：关闭菜单

触屏键盘快捷入口：

- 确定：打开 `常用`，默认选中 `个人状态`
- 返回：打开 `辅助`
- 聊天：打开 `聊天`，默认选中 `本线广播`
- 任务：打开 `任务`
- 系统：打开 `系统`
- 频道：打开 `聊天`，默认选中 `本线广播`

战斗中这些菜单快捷键不生效，按键只服务战斗 UI。

## 二级菜单

二级菜单项布局：

```html
<button class="main-menu-item">
  <i class="main-menu-icon icon-sheet-2"></i>
  <span>菜单文字</span>
  <i class="main-menu-icon icon-sheet-2"></i>
</button>
```

要求：

- 文字左右各夹一个图标。
- 二级菜单项左对齐。
- 当前选中项使用整行半透明背景，宽度填满。
- 列表高度不足时允许纵向滚动，选中项自动滚到可见区域。

## 菜单项动作

菜单项通过 `item.action` 执行功能，不要依赖显示文字做业务判断。

当前动作：

- `stats`：打开属性面板。
- `chat`：打开聊天输入。
- `logout`：退出游戏。
- 空动作：显示短暂“暂未开放”提示，提示会自动消失。

## 其它菜单类 UI

后续新增菜单类窗口时统一遵循：

1. 外层容器使用 `decorateMenuFrame(container)`。
2. 操作按钮使用 `.menu-framed-button` 并调用 `decorateMenuFrame(button)`。
3. 列表项需要填满整行时使用类似 `.main-menu-item` 的整行背景。
4. 不要用普通圆角卡片替代菜单边框。
5. 临时提示使用 `showMenuHint(text)`，不要直接长期写入聊天区域。

## 已接入

- 主菜单。
- 主菜单底部“确定 / 返回”按钮。
- 附近角色 / 击杀面板：外层和击杀按钮都使用菜单边框。
