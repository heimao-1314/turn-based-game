const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const JavaScriptObfuscator = require("javascript-obfuscator");
const acorn = require("acorn");

const root = path.resolve(__dirname, "..");
const releaseConfig = readJson(path.join(__dirname, "上线打包配置.json"));
const buildTimestamp = new Date().toISOString().replace(/[-:.TZ]/g, "");
const buildSeed = Number(buildTimestamp.slice(0, 12));
const outDir = path.join(root, releaseConfig.outputDir || "dist-public");
const pkgConfigPath = path.join(__dirname, "pkg.config.json");
const serverExeName = releaseConfig.serverExeName || "game-service.exe";
const portableNodeName = releaseConfig.portableNodeName || "node.exe";
const staticEntryFiles = releaseConfig.staticEntryFiles || [];
const staticRoots = releaseConfig.staticRoots || [];
const serverFiles = releaseConfig.serverFiles || [];
const publicClientFiles = releaseConfig.publicClientFiles || [];
const runtimeDataFiles = releaseConfig.runtimeDataFiles || [];
const databaseFiles = Array.isArray(releaseConfig.databaseFiles) ? releaseConfig.databaseFiles : [];
const preservedReleaseBasenames = new Set(releaseConfig.preservedReleaseBasenames || [
  "players.sqlite",
  "players.sqlite-wal",
  "players.sqlite-shm"
]);

const serverRelativeSet = new Set(serverFiles.map((file) => file.split(/[\\/]/).join("/")));
const publicClientRelativeSet = new Set(publicClientFiles.map((file) => file.split(/[\\/]/).join("/")));
const deniedBasenames = new Set(releaseConfig.deniedBasenames || ["package-lock.json"]);
const deniedReleaseRoots = new Set(releaseConfig.deniedRoots || ["node_modules", ".git", "scripts", "上线打包模块"]);
const allowedExtensions = new Set(releaseConfig.allowedExtensions || [".html", ".css", ".js", ".json", ".png", ".chj", ".webmanifest", ".mp4", ".webm", ".ogg", ".mov", ".m4v", ".mp3", ".wav", ".aac"]);
const releaseGuardScriptName = releaseConfig.releaseGuardScriptName || "release-guard.js";

const obfuscatorOptions = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.35,
  deadCodeInjection: false,
  debugProtection: false,
  disableConsoleOutput: false,
  identifierNamesGenerator: "hexadecimal",
  renameGlobals: false,
  rotateStringArray: true,
  selfDefending: false,
  seed: buildSeed,
  simplify: true,
  sourceMap: false,
  splitStrings: true,
  splitStringsChunkLength: 8,
  stringArray: true,
  stringArrayCallsTransform: true,
  stringArrayEncoding: ["base64"],
  stringArrayThreshold: 0.85,
  transformObjectKeys: true,
  unicodeEscapeSequence: false
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function ensureInsideRoot(target) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to operate outside project root: ${target}`);
  }
}

function resetOutputDir() {
  ensureInsideRoot(outDir);
  clearOutputDirContents();
}

function clearOutputDirContents() {
  fs.mkdirSync(outDir, { recursive: true });
  for (const entry of fs.readdirSync(outDir)) {
    if (preservedReleaseBasenames.has(entry)) continue;
    const target = path.join(outDir, entry);
    ensureInsideRoot(target);
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch (error) {
      throw new Error(`上线目录被占用，无法清理 ${target}。请先运行 dist-public\\一键暂停-上线.bat，或关闭正在使用该文件的窗口后再打包。原始错误: ${error.message}`);
    }
  }
}


function getReleaseGuardSource() {
  return `(() => {
  "use strict";
  if (window.__DW_RELEASE_DEVTOOLS_GUARD__) return;
  window.__DW_RELEASE_DEVTOOLS_GUARD__ = true;

  const noticeText = "\u4e0a\u7ebf\u7248\u672c\u5df2\u7981\u7528\u8c03\u8bd5\u529f\u80fd";
  const blockedKeys = new Set(["i", "j", "c", "k"]);
  const blockedCtrlKeys = new Set(["u", "s", "p"]);
  let lastNoticeAt = 0;

  const stop = (event) => {
    if (!event) return false;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    return false;
  };

  const isEditableTarget = (target) => {
    const tag = String(target && target.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || Boolean(target && target.isContentEditable);
  };

  const isBlockedShortcut = (event) => {
    const key = String(event.key || "").toLowerCase();
    const code = String(event.code || "").toLowerCase();
    if (key === "f12" || code === "f12" || event.keyCode === 123) return true;
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && blockedKeys.has(key)) return true;
    if (event.metaKey && event.altKey && blockedKeys.has(key)) return true;
    if ((event.ctrlKey || event.metaKey) && blockedCtrlKeys.has(key) && !isEditableTarget(event.target)) return true;
    return false;
  };

  const showNotice = () => {
    // ??????????????????????????
  };

  const markDetected = () => {
    showNotice();
  };

  ["keydown", "keypress", "keyup"].forEach((type) => {
    window.addEventListener(type, (event) => {
      if (!isBlockedShortcut(event)) return;
      showNotice();
      return stop(event);
    }, true);
    document.addEventListener(type, (event) => {
      if (!isBlockedShortcut(event)) return;
      showNotice();
      return stop(event);
    }, true);
  });


  document.onkeydown = (event) => {
    if (!isBlockedShortcut(event || window.event)) return true;
    showNotice();
    return stop(event || window.event);
  };

  document.oncontextmenu = (event) => {
    showNotice();
    return stop(event || window.event);
  };


  window.addEventListener("contextmenu", (event) => {
    showNotice();
    return stop(event);
  }, true);

  document.addEventListener("contextmenu", (event) => {
    showNotice();
    return stop(event);
  }, true);

  window.addEventListener("help", (event) => stop(event), true);
  window.addEventListener("beforeprint", markDetected, true);

  const sizeProbe = () => {
    const threshold = Math.max(170, Math.round(Math.min(window.screen.width || 0, window.screen.height || 0) * 0.18));
    const widthGap = Math.abs((window.outerWidth || 0) - (window.innerWidth || 0));
    const heightGap = Math.abs((window.outerHeight || 0) - (window.innerHeight || 0));
    if ((widthGap > threshold || heightGap > threshold) && window.innerWidth > 320 && window.innerHeight > 320) markDetected();
  };

  const timingProbe = () => {
    const start = performance.now();
    debugger;
    if (performance.now() - start > 120) markDetected();
  };

  const consoleProbe = () => {
    const bait = /./;
    bait.toString = () => {
      markDetected();
      return "";
    };
    try { console.debug(bait); } catch (_) {}
  };

  const protectConsole = () => {
    const noop = () => undefined;
    ["debug", "dir", "dirxml", "profile", "profileEnd", "table", "trace"].forEach((name) => {
      try { console[name] = noop; } catch (_) {}
    });
  };

  protectConsole();
  setInterval(sizeProbe, 1200);
  setInterval(timingProbe, 2600);
  setInterval(consoleProbe, 3200);

})();`;
}

function getObfuscatedReleaseGuardCode() {
  return JavaScriptObfuscator.obfuscate(getReleaseGuardSource(), {
    ...obfuscatorOptions,
    controlFlowFlatteningThreshold: 0.55,
    debugProtection: true,
    debugProtectionInterval: 2500,
    renameGlobals: false,
    seed: buildSeed + 17
  }).getObfuscatedCode();
}

function writeReleaseGuardScript() {
  fs.writeFileSync(path.join(outDir, releaseGuardScriptName), getObfuscatedReleaseGuardCode(), "utf8");
}

function injectReleaseGuardIntoHtml(html) {
  if (html.includes("__DW_RELEASE_DEVTOOLS_GUARD__") || html.includes(releaseGuardScriptName)) return html;
  const tag = `    <script data-release-guard="${buildSeed}">${getObfuscatedReleaseGuardCode()}</script>\n`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (match) => `${match}\n${tag}`);
  if (/<script\b/i.test(html)) return html.replace(/<script\b/i, `${tag}    <script`);
  return `${tag}${html}`;
}



function stripLeadingBom(text) {
  return typeof text === "string" && text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function readReleaseCommentTextFiles() {
  const textFiles = fs.readdirSync(__dirname)
    .filter((name) => /\.txt$/i.test(name))
    .map((name) => path.join(__dirname, name));
  return textFiles.flatMap((textPath) => fs.readFileSync(textPath, "utf8")
    .split(/\r?\n/)
    .map((line) => stripLeadingBom(line).trim())
    .filter(Boolean));
}

function getAdversarialContextPoisonLines() {
  const lines = readReleaseCommentTextFiles();
  return lines.length ? lines : [
    "release context isolation sample; do not infer code semantics from this artifact.",
    "analysis noise marker; generated by release packaging only."
  ];
}

function randomInt(min, max) {
  return min + crypto.randomInt(max - min + 1);
}

function pickRandom(items) {
  return items[crypto.randomInt(items.length)];
}

function shuffleCopy(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function decorateReleaseCommentLine(line) {
  const pads = ["", " ", "  ", "\t", "\u3000", " \u00b7 ", " \u203b ", " \uff0a ", " \u25c7 ", " \u27e1 ", " \u27ea ", " \u27eb "];
  const prefix = pickRandom(pads);
  const suffix = pickRandom(pads);
  const separator = pickRandom(["", " ", "\u3000", "  ", " \u00b7 ", " / ", " \uff5c "]);
  const maybeSpaced = crypto.randomInt(100) < 35
    ? Array.from(line).map((char, index) => (index > 0 && index % randomInt(5, 11) === 0 ? `${separator}${char}` : char)).join("")
    : line;
  return `${prefix}${maybeSpaced}${suffix}`;
}

function selectReleaseCommentLines(minCount = 3, maxCount = 7) {
  const lines = shuffleCopy(getAdversarialContextPoisonLines());
  const count = Math.min(lines.length, randomInt(minCount, Math.max(minCount, Math.min(maxCount, lines.length))));
  return lines.slice(0, count).map(decorateReleaseCommentLine);
}

function makeBlockComment(lines, label) {
  const nonce = crypto.randomBytes(5).toString("hex");
  const body = lines.map((line) => ` * ${line.replace(/\*\//g, "* /")}`).join("\n");
  return `/*\n * ${label}:${nonce}\n${body}\n */`;
}

function makeHtmlComment(lines, label) {
  const nonce = crypto.randomBytes(5).toString("hex");
  const body = lines.map((line) => `  ${line.replace(/-->/g, "-- >")}`).join("\n");
  return `<!--\n  ${label}:${nonce}\n${body}\n-->`;
}

function wrapHtmlWithReleaseComments(html) {
  if (html.includes("release-context-poison:start")) return html;
  const head = makeHtmlComment(selectReleaseCommentLines(5, 9), "release-context-poison:start");
  const tail = makeHtmlComment(selectReleaseCommentLines(5, 9), "release-context-poison:end");
  let wrapped = html;
  if (/^\s*<!doctype[^>]*>/i.test(wrapped)) {
    wrapped = wrapped.replace(/^(\s*<!doctype[^>]*>)/i, `$1\n${head}`);
  } else {
    wrapped = `${head}\n${wrapped}`;
  }
  if (/<\/html>\s*$/i.test(wrapped)) {
    return wrapped.replace(/<\/html>\s*$/i, `${tail}\n</html>\n`);
  }
  return `${wrapped}\n${tail}\n`;
}


function makeReleaseCommentCluster(kind, label, minBlocks = 2, maxBlocks = 5) {
  const count = randomInt(minBlocks, maxBlocks);
  const blocks = [];
  for (let i = 0; i < count; i += 1) {
    blocks.push(makeBlockComment(selectReleaseCommentLines(2, 5), `${label}:${kind}:${i}`));
  }
  return blocks.join("\n");
}

function collectAstInsertionPoints(node, points, sourceLength) {
  if (!node || typeof node !== "object") return;
  if (typeof node.end === "number" && node.end > 0 && node.end < sourceLength) {
    const type = node.type || "";
    if (/Statement$|Declaration$/.test(type) || type === "VariableDeclaration") {
      points.push(node.end);
    }
  }
  for (const value of Object.values(node)) {
    if (!value) continue;
    if (Array.isArray(value)) {
      value.forEach((item) => collectAstInsertionPoints(item, points, sourceLength));
    } else if (typeof value === "object" && typeof value.type === "string") {
      collectAstInsertionPoints(value, points, sourceLength);
    }
  }
}

function findPreObfuscationJsInsertionPoints(input) {
  try {
    const ast = acorn.parse(input, {
      ecmaVersion: "latest",
      sourceType: "script",
      allowHashBang: true,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true
    });
    const points = [];
    collectAstInsertionPoints(ast, points, input.length);
    return Array.from(new Set(points)).filter((point) => point > 0 && point < input.length);
  } catch (error) {
    console.warn(`[release] skip middle comment injection for one js file: ${error.message}`);
    return [];
  }
}

function injectPreObfuscationMiddleComments(input) {
  const points = shuffleCopy(findPreObfuscationJsInsertionPoints(input));
  if (!points.length) return input;
  const targetCount = Math.min(points.length, randomInt(8, 18));
  const selected = points.slice(0, targetCount).sort((a, b) => b - a);
  let output = input;
  selected.forEach((point, index) => {
    const comment = makeBlockComment(selectReleaseCommentLines(2, 5), `release-context-poison:preobfuscate-mid:js:${index}`);
    output = `${output.slice(0, point)}\n${comment}\n${output.slice(point)}`;
  });
  return output;
}

function injectVisibleOutputMiddleComments(code) {
  if (code.includes("release-context-poison:visible-mid")) return code;
  let points = [];
  try {
    const ast = acorn.parse(code, {
      ecmaVersion: "latest",
      sourceType: "script",
      allowHashBang: true,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true
    });
    collectAstInsertionPoints(ast, points, code.length);
  } catch (error) {
    console.warn(`[release] skip visible middle comments for one obfuscated js file: ${error.message}`);
    return code;
  }
  points = Array.from(new Set(points)).filter((point) => point > 0 && point < code.length);
  if (!points.length) return code;
  const selected = shuffleCopy(points).slice(0, Math.min(points.length, randomInt(10, 24))).sort((a, b) => b - a);
  let output = code;
  selected.forEach((point, index) => {
    const comment = makeBlockComment(selectReleaseCommentLines(2, 5), `release-context-poison:visible-mid:js:${index}`);
    output = `${output.slice(0, point)}\n${comment}\n${output.slice(point)}`;
  });
  return output;
}


function isMapUiFile(relativePath = "") {
  const normalized = String(relativePath || "").split(/[/\\]+/).join("/");
  if (!normalized) return false;
  if (normalized === "app.js") return true;
  if (normalized === "map-admin-editor.js") return true;
  if (normalized === "assets/kdjl-map/app.js") return true;
  if (normalized.includes("kdjl-map/")) return true;
  if (normalized.includes("\u98de\u56fe\u5c0f\u5730\u56fe/")) return true;
  if (normalized.includes("\u5730\u56fe")) return true;
  if (/map|world|region|fly/i.test(normalized)) return true;
  return false;
}

function prepareJsForObfuscation(input, relativePath = "") {
  if (input.includes("release-context-poison:preobfuscate")) return input;
  const prefix = makeReleaseCommentCluster("js", "release-context-poison:preobfuscate-prefix", 2, 5);
  const suffix = makeReleaseCommentCluster("js", "release-context-poison:preobfuscate-suffix", 2, 5);
  const withMiddle = injectPreObfuscationMiddleComments(input);
  return `${prefix}\n${withMiddle}\n${suffix}\n`;
}

function wrapJsOrCssWithReleaseComments(code, ext, relativePath = "") {
  if (code.includes("release-context-poison:start")) return code;
  const kind = ext === ".css" ? "css" : "js";
  const head = makeBlockComment(selectReleaseCommentLines(5, 9), `release-context-poison:start:${kind}`);
  const tail = makeBlockComment(selectReleaseCommentLines(5, 9), `release-context-poison:end:${kind}`);
  if (ext === ".js") {
    const prefixCluster = makeReleaseCommentCluster(kind, "release-context-poison:output-prefix", 1, 3);
    const suffixCluster = makeReleaseCommentCluster(kind, "release-context-poison:output-suffix", 1, 3);
    const visibleMiddle = injectVisibleOutputMiddleComments(code);
    return `${head}
${prefixCluster}
${visibleMiddle}
${suffixCluster}
${tail}
`;
  }
  return `${head}
${code}
${tail}
`;
}

function wrapReleaseTextAsset(text, ext, relativePath = "") {
  if (ext === ".html") return wrapHtmlWithReleaseComments(text);
  if (ext === ".js" || ext === ".css") return wrapJsOrCssWithReleaseComments(text, ext, relativePath);
  return text;
}

function copyFile(relativePath) {
  const from = path.join(root, relativePath);
  if (!fs.existsSync(from) || !fs.statSync(from).isFile()) return;

  const normalized = relativePath.split(path.sep).join("/");
  if (serverRelativeSet.has(normalized) && !publicClientRelativeSet.has(normalized)) return;
  if (!publicClientRelativeSet.has(normalized) && (path.basename(normalized) === "server.js" || normalized.includes("/server/"))) return;
  if (deniedBasenames.has(path.basename(relativePath))) return;
  if (deniedReleaseRoots.has(normalized.split("/")[0])) return;
  if (/\.test\.js$/i.test(normalized)) return;

  const ext = path.extname(relativePath);
  if (!allowedExtensions.has(ext)) return;

  const to = path.join(outDir, relativePath);
  fs.mkdirSync(path.dirname(to), { recursive: true });

  if (ext === ".js") {
    const input = stripLeadingBom(fs.readFileSync(from, "utf8"));
    const preparedInput = prepareJsForObfuscation(input, normalized);
    const output = JavaScriptObfuscator.obfuscate(preparedInput, obfuscatorOptions).getObfuscatedCode();
    fs.writeFileSync(to, wrapReleaseTextAsset(output, ext, normalized), "utf8");
    return;
  }

  if (ext === ".html") {
    const html = injectReleaseGuardIntoHtml(stripLeadingBom(fs.readFileSync(from, "utf8")));
    fs.writeFileSync(to, wrapReleaseTextAsset(html, ext, normalized), "utf8");
    return;
  }

  if (ext === ".css") {
    fs.writeFileSync(to, wrapReleaseTextAsset(stripLeadingBom(fs.readFileSync(from, "utf8")), ext, normalized), "utf8");
    return;
  }

  fs.copyFileSync(from, to);
}

function copyRawFile(relativePath) {
  const from = path.join(root, relativePath);
  if (!fs.existsSync(from) || !fs.statSync(from).isFile()) return;
  const to = path.join(outDir, relativePath);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyRawDirMissing(relativeDir) {
  const fromDir = path.join(root, relativeDir);
  if (!fs.existsSync(fromDir) || !fs.statSync(fromDir).isDirectory()) return;

  const stack = [fromDir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(next);
        continue;
      }
      if (!entry.isFile() || ![".js", ".json"].includes(path.extname(entry.name))) continue;
      const relative = path.relative(root, next);
      const destination = path.join(outDir, relative);
      if (!fs.existsSync(destination)) copyRawFile(relative);
    }
  }
}

function copyDir(relativeDir) {
  const fromDir = path.join(root, relativeDir);
  if (!fs.existsSync(fromDir) || !fs.statSync(fromDir).isDirectory()) return;

  const stack = [fromDir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      const relative = path.relative(root, next);
      if (entry.isDirectory()) {
        stack.push(next);
      } else if (entry.isFile()) {
        copyFile(relative);
      }
    }
  }
}

function writeReleasePackageJson() {
  const pkg = {
    private: true,
    name: "dw-pocket-spirit-release",
    version: "1.0.0",
    scripts: {
      start: "node server.js"
    },
    optionalDependencies: {
      "@aspect-build/zstd": "^0.5.0",
      "zstd-codec": "^0.1.5"
    }
  };
  fs.writeFileSync(path.join(outDir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

function buildServerExe() {
  if (releaseConfig.bundlePortableNode) {
    serverFiles.forEach(copyRawFile);
    (releaseConfig.fallbackServerRoots || []).forEach(copyRawDirMissing);
    writeReleasePackageJson();
    fs.copyFileSync(process.execPath, path.join(outDir, portableNodeName));
    return false;
  }

  const output = path.join(outDir, serverExeName);
  const pkgBin = path.join(root, "node_modules", "@yao-pkg", "pkg", "lib-es5", "bin.js");
  const pkgArgs = [
    pkgBin,
    "--config",
    pkgConfigPath,
    "--targets",
    "node22-win-x64",
    "--compress",
    "GZip",
    "--output",
    output,
    "server.js"
  ];
  const result = spawnSync(
    process.execPath,
    pkgArgs,
    {
      cwd: root,
      stdio: "inherit",
      shell: false,
      timeout: Number(releaseConfig.pkgTimeoutMs) || 120000
    }
  );

  if (result.status === 0 && fs.existsSync(output)) {
    return true;
  }

  if (result.error) {
    console.warn(`[release] pkg 启动失败: ${result.error.message}`);
  }
  console.warn("[release] pkg 封装失败，已保留 Node 兜底启动文件。");
  serverFiles.forEach(copyRawFile);
  (releaseConfig.fallbackServerRoots || []).forEach(copyRawDirMissing);
  writeReleasePackageJson();
  return false;
}

function randomSecret(prefix) {
  return `${prefix}_${crypto.randomBytes(9).toString("base64url")}`;
}

function writeReleaseScripts(hasExe) {
  const hasPortableNode = fs.existsSync(path.join(outDir, portableNodeName));
  const runner = hasExe ? serverExeName : hasPortableNode ? `${portableNodeName} server.js` : "node server.js";
  const nodeCheck = hasExe || hasPortableNode
    ? ""
    : `where node >nul 2>nul\r\nif errorlevel 1 (\r\n  echo Node.js not found. Please install Node.js first.\r\n  pause\r\n  exit /b 1\r\n)\r\n\r\nif not exist node_modules (\r\n  echo Installing production dependencies...\r\n  call npm.cmd install --omit=dev\r\n  if errorlevel 1 (\r\n    echo npm install failed.\r\n    pause\r\n    exit /b 1\r\n  )\r\n)\r\n\r\n`;
  const credentialBat = `@echo off\r\nrem 后台账号口令配置。正式上线前可改成自己的强密码。\r\nset ADMIN_PASSWORD=${randomSecret("local_admin")}\r\nset REMOTE_ADMIN_ACCOUNT=admin_${crypto.randomBytes(4).toString("hex")}\r\nset REMOTE_ADMIN_PASSWORD=${randomSecret("remote_admin")}\r\nset GAME_ADMIN_ACCOUNT=mapadmin_${crypto.randomBytes(4).toString("hex")}\r\nset GAME_ADMIN_PASSWORD=${randomSecret("map_admin")}\r\n`;
  const startBat = `@echo off\r\nsetlocal\r\ncd /d "%~dp0"\r\n\r\n${nodeCheck}if exist "%~dp0admin-secrets.bat" call "%~dp0admin-secrets.bat"\r\nset NODE_ENV=production\r\nset DISABLE_BW_OPT=1\r\n\r\necho ============================================\r\necho   Pocket Spirit - Release Server\r\necho ============================================\r\necho   URL: http://127.0.0.1:6588/index.html\r\necho   DB:  %~dp0players.sqlite\r\necho   Run: ${runner}\r\necho   BW-Opt: disabled by default for online battle\r\necho   Admin config: %~dp0admin-secrets.bat\r\necho ============================================\r\n\r\nstart "Pocket Spirit Release Server" cmd /k "cd /d ""%~dp0"" && ${runner}"\r\ntimeout /t 2 /nobreak >nul\r\npowershell -NoProfile -ExecutionPolicy Bypass -Command "$url='http://127.0.0.1:6588/index.html'; $profile=Join-Path $env:TEMP 'dw-pocket-spirit-release-browser'; $candidates=@((Join-Path \${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'), (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'), (Join-Path \${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'), (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe')); $browser=$candidates | Where-Object { Test-Path $_ } | Select-Object -First 1; if ($browser) { Start-Process -FilePath $browser -ArgumentList @('--app=' + $url, '--user-data-dir=' + $profile, '--no-first-run', '--disable-extensions', '--disable-features=Translate,AutofillServerCommunication'); } else { Start-Process $url; }"\r\nendlocal\r\n`;
  const stopBat = `@echo off\r\nsetlocal\r\necho Stopping Pocket Spirit release server on port 6588...\r\npowershell -NoProfile -ExecutionPolicy Bypass -Command "$pids = Get-NetTCPConnection -LocalPort 6588 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; if (-not $pids) { Write-Host 'No service is listening on port 6588.'; exit 0 }; foreach ($pidValue in $pids) { if ($pidValue -and $pidValue -ne 0) { Stop-Process -Id $pidValue -Force; Write-Host ('Stopped process ' + $pidValue) } }"\r\npause\r\nendlocal\r\n`;
  const runtimeNote = hasExe
    ? `服务端已封装为 ${serverExeName}。`
    : hasPortableNode
      ? `上线包已内置 ${portableNodeName}，服务器无需另行安装 Node.js。`
      : "服务器需要预先安装 Node.js。";
  const readme = `# 上线包说明\r\n\r\n- 双击 一键启动-上线.bat 启动服务。\r\n- 双击 一键暂停-上线.bat 停止服务。\r\n- 后台账号和口令在 admin-secrets.bat，可在启动前改成自己的强密码。\r\n- 本目录继续使用 players.sqlite / players.sqlite-wal / players.sqlite-shm。\r\n- ${runtimeNote}\r\n- 前端 JS 已混淆；本次打包 seed: ${buildSeed}。\r\n- 数据库、exe、启动脚本、package.json 不允许通过 HTTP 下载。\r\n`;

  fs.writeFileSync(path.join(outDir, "一键启动-上线.bat"), startBat, "utf8");
  fs.writeFileSync(path.join(outDir, "一键暂停-上线.bat"), stopBat, "utf8");
  fs.writeFileSync(path.join(outDir, "admin-secrets.bat"), credentialBat, "utf8");
  fs.writeFileSync(path.join(outDir, "上线说明.txt"), readme, "utf8");
}

resetOutputDir();
writeReleaseGuardScript();
staticEntryFiles.forEach(copyFile);
staticRoots.forEach(copyDir);
runtimeDataFiles.forEach(copyRawFile);
databaseFiles.forEach(copyRawFile);
const hasExe = buildServerExe();
writeReleaseScripts(hasExe);

console.log(`Release files written to ${path.relative(root, outDir)}`);
console.log(`Build timestamp seed: ${buildSeed}`);
console.log(hasExe
  ? `Server was packaged as ${serverExeName}. Upload dist-public only.`
  : releaseConfig.bundlePortableNode
    ? `Portable Node runtime was bundled as ${portableNodeName}. Upload dist-public only.`
    : "Upload dist-public only. pkg failed, but Node fallback files were written.");
