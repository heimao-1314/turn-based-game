/**
 * @file server.js
 * @description 联网战斗服务端入口。
 *
 * 真实实现位于 runtime.js。保留这个入口是为了让根服务器和测试只依赖
 * `联网战斗/server.js`，旧的单人 PVP、队伍 PVP 模块不再参与联网战斗链路。
 */
module.exports = require("./runtime.js");
