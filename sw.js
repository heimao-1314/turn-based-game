/**
 * @file sw.js
 * @description Service Worker - 离线缓存与资源预取策略
 *
 * 本模块实现 PWA 的 Service Worker，提供：
 * - Shell 缓存: 核心页面文件的安装时预缓存
 * - Asset 缓存: 游戏资源的运行时缓存
 * - 缓存策略:
 *   - 资源类请求 (图片/精灵图/地图): Cache-First（优先读缓存，后台更新）
 *   - 其他静态请求: Network-First（优先网络，失败回退缓存）
 * - 资源预取: 通过 /api/asset-manifest 获取资源清单，8 路并发预缓存
 * - 缓存版本管理: 自动清理旧版本缓存
 *
 * 缓存名称:
 * - dw-shell-v27: 核心 Shell 文件
 * - dw-assets-v16: 游戏资源文件
 *
 * @requires Cache API, Fetch API, Clients API
 */
const SHELL_CACHE = "dw-shell-v27";
const ASSET_CACHE = "dw-assets-v16";
const ENABLE_ASSET_PREFETCH = false;
const SHELL_FILES = [
  "/",
  "/index.html",
  "/font-theme.css",
  "/styles.css?v=20260713-camera-select-1",
  "/菜单UI/菜单界面.css?v=20260712-10",
  "/飞图小地图/区域飞图.css",
  "/app.js?v=20260713-camera-select-1",
  "/菜单UI/菜单界面.js?v=20260712-7",
  "/飞图小地图/区域飞图.js",
  "/联网战斗/client.js",
  "/生活技能/贴纸生产.js",
  "/职业模块/职业树.js",
  "/manifest.webmanifest",
  "/资源/图片/mm1.png",
  "/资源/图片/mm2.png",
  "/资源/图片/登录封面.png"
];

const STATIC_PATHS = [
  "/assets/",
  "/精灵图/",
  "/地图/",
  "/菜单UI/",
  "/飞图小地图/"
];

const STATIC_EXTENSIONS = [
  ".chj",
  ".css",
  ".html",
  ".js",
  ".json",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".mp4",
  ".webmanifest"
];

const ASSET_FIRST_EXTENSIONS = [
  ".chj",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".mp4"
];

function isSameOrigin(request) {
  return new URL(request.url).origin === self.location.origin;
}

function isStaticRequest(request) {
  if (request.method !== "GET" || !isSameOrigin(request)) return false;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return false;
  return STATIC_PATHS.some((prefix) => url.pathname.startsWith(prefix)) ||
    STATIC_EXTENSIONS.some((extension) => url.pathname.endsWith(extension)) ||
    url.pathname === "/";
}

function isAssetFirstRequest(request) {
  const url = new URL(request.url);
  return ASSET_FIRST_EXTENSIONS.some((extension) => url.pathname.endsWith(extension));
}

async function putFreshResponse(cache, request) {
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) {
    putFreshResponse(cache, request).catch(() => {});
    return cached;
  }
  return putFreshResponse(cache, request);
}

async function networkFirst(request) {
  const cache = await caches.open(ASSET_CACHE);
  try {
    return await putFreshResponse(cache, request);
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function prefetchAssets() {
  if (!ENABLE_ASSET_PREFETCH) return;
  const manifestResponse = await fetch("/api/asset-manifest", { cache: "no-store" });
  if (!manifestResponse.ok) throw new Error("asset manifest unavailable");
  const manifest = await manifestResponse.json();
  const urls = Array.isArray(manifest.assets) ? manifest.assets : [];
  const cache = await caches.open(ASSET_CACHE);
  let completed = 0;
  const total = urls.length;

  async function worker(queue) {
    while (queue.length) {
      const url = queue.shift();
      try {
        const response = await fetch(url, { cache: "no-store" });
        if (response.ok) await cache.put(url, response);
      } catch {
        // Network loss should not cancel the rest of the cache warmup.
      }
      completed += 1;
      if (completed % 50 === 0 || completed === total) {
        const clients = await self.clients.matchAll({ includeUncontrolled: true });
        for (const client of clients) {
          client.postMessage({ type: "asset-cache-progress", completed, total });
        }
      }
    }
  }

  const queue = [...urls];
  await Promise.all(Array.from({ length: 1 }, () => worker(queue)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => ![SHELL_CACHE, ASSET_CACHE].includes(key))
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (!isStaticRequest(request)) return;
  event.respondWith(isAssetFirstRequest(request) ? cacheFirst(request) : networkFirst(request));
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "prefetch-assets") {
    event.waitUntil(prefetchAssets());
  }
});
