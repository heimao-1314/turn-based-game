/**
 * @file build-resource-pack.js
 * @description 资源包构建工具 - 将游戏资源加密打包为 Android 资源包
 *
 * 本脚本将项目中的图片、地图、精灵图等资源文件使用 AES-256-GCM 加密，
 * 打包为 Android 应用所需的资源包格式。输出包含：
 * - 加密后的 .dat 资源文件（文件名使用 base36 编号）
 * - manifest.json 清单文件（记录原始路径与加密文件的映射关系）
 *
 * 加密算法: AES-256-GCM（密钥由固定盐值派生）
 * 输出目录: dist-android/assets/resource-pack/
 *
 * 使用方法: node 脚本/build-resource-pack.js
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "dist-android", "assets", "resource-pack");
const encryptedRoots = ["assets", "\u5730\u56fe", "\u7cbe\u7075\u56fe"];
const encryptedRootFiles = new Set([
  "mm1.png",
  "mm2.png",
  "\u8868\u60c5.png",
  "\u9b54\u6cd5\u9635.png",
  "\u6218\u6597\u6570\u5b57.png",
  "\u6218\u6597\u7bad\u5934.png",
  "\u6218\u6597ui.png",
  "\u6309\u952e\u56fe\u7247.png",
  "\u83dc\u5355\u56fe\u68071.png",
  "\u83dc\u5355\u56fe\u68072.png",
  "\u83dc\u5355ui\u8fb9\u6846\u6a2a.png",
  "\u83dc\u5355ui\u8fb9\u6846\u7ad6.png",
  "\u83dc\u5355ui\u8fb9\u6846\u89d2\u843d(\u5de6\u4e0a\u89d2).png",
  "\u5730\u56fe\u53bb\u95ea\u5149\u5e73\u539f.png"
]);
const key = crypto.createHash("sha256").update("dw-pocket-spirit-resource-pack-v1").digest();

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, files);
    if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function relativeUrl(filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function encrypt(buffer) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const sourceFiles = [
  ...encryptedRoots.flatMap((entry) => walk(path.join(root, entry))),
  ...[...encryptedRootFiles].map((name) => path.join(root, name)).filter((filePath) => fs.existsSync(filePath))
];
const uniqueFiles = [...new Map(sourceFiles.map((filePath) => [relativeUrl(filePath), filePath])).values()];
const assets = {};

uniqueFiles.forEach((filePath, index) => {
  const url = relativeUrl(filePath);
  const id = index.toString(36).padStart(5, "0");
  const outputName = `${id}.dat`;
  const encrypted = encrypt(fs.readFileSync(filePath));
  fs.writeFileSync(path.join(outDir, outputName), encrypted);
  assets[url] = {
    file: outputName,
    size: fs.statSync(filePath).size
  };
});

fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify({
  version: 1,
  algorithm: "AES-256-GCM",
  assets
}));

console.log(`Encrypted ${uniqueFiles.length} resources into ${path.relative(root, outDir)}`);
