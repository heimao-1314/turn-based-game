/**
 * @file batch-convert-maps.js
 * @description 地图批量转换工具 - 将 .sc 格式地图文件批量转换为 JSON 格式
 *
 * 本脚本扫描 maps待接入 目录下的所有 .sc 文件，
 * 调用 convert-sc-map 模块逐一转换，输出到 地图/converted 目录，
 * 并生成 conversion-summary.json 汇总转换结果。
 *
 * 使用方法: node 脚本/batch-convert-maps.js
 *
 * 输入: maps待接入/**/*.sc
 * 输出: 地图/converted/*.json, 地图/converted/conversion-summary.json
 */
const fs = require("fs");
const path = require("path");
const { convert } = require("./convert-sc-map");

const root = path.resolve(__dirname, "..");
const sourceRoot = path.join(root, "maps\u5f85\u63a5\u5165");
const outputRoot = path.join(root, "\u5730\u56fe", "converted");

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return entry.isFile() && entry.name.toLowerCase().endsWith(".sc") ? [fullPath] : [];
  });
}

function mapIdFor(inputPath) {
  const relative = path.relative(sourceRoot, inputPath);
  const parsed = path.parse(relative);
  const group = parsed.dir.split(path.sep).filter(Boolean).join("-");
  return `${group}-${parsed.name}`;
}

function main() {
  fs.mkdirSync(outputRoot, { recursive: true });
  const inputs = walk(sourceRoot).sort((a, b) => a.localeCompare(b));
  const results = [];
  for (const inputPath of inputs) {
    const id = mapIdFor(inputPath);
    const outputPath = path.join(outputRoot, `${id}.json`);
    try {
      const map = convert(inputPath, outputPath, { id, title: id });
      results.push({
        id,
        ok: true,
        source: path.relative(root, inputPath).replace(/\\/g, "/"),
        output: path.relative(root, outputPath).replace(/\\/g, "/"),
        width: map.width,
        height: map.height,
        cells: map.cells.length,
        overlays: map.scMeta.overlayCount,
        autoTiles: map.scMeta.specialCount
      });
      console.log(`OK ${id} ${map.width}x${map.height}`);
    } catch (error) {
      results.push({
        id,
        ok: false,
        source: path.relative(root, inputPath).replace(/\\/g, "/"),
        error: error.message
      });
      console.error(`FAIL ${id}: ${error.message}`);
    }
  }
  const summaryPath = path.join(outputRoot, "conversion-summary.json");
  fs.writeFileSync(summaryPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
  const failed = results.filter((item) => !item.ok);
  console.log(`Converted ${results.length - failed.length}/${results.length}; summary: ${path.relative(root, summaryPath).replace(/\\/g, "/")}`);
  if (failed.length) process.exitCode = 1;
}

if (require.main === module) main();
