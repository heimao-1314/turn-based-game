/**
 * @file app-config.js
 * @description 应用全局配置 - 定义运行模式和服务器地址
 *
 * 配置项:
 * - serverOrigin: 在线服务器地址（空字符串表示使用当前站点）
 * - enableBandwidthOptimizer: 是否启用实验性带宽优化模块
 *
 * 注意: 此文件在 index.html 中最先加载，配置会挂载到 window.APP_CONFIG
 */
window.APP_CONFIG = {
  serverOrigin: "",
  enableBandwidthOptimizer: false
};
