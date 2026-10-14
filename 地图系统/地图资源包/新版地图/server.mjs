import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const port = Number(process.env.PORT || 8088);
const mime = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".png", "image/png"], [".ico", "image/x-icon"]
]);
http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let file = path.normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, "");
  if (!file) file = "index.html";
  const full = path.join(root, file);
  if (!full.startsWith(root) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404); res.end("not found"); return;
  }
  res.writeHead(200, { "Content-Type": mime.get(path.extname(full)) || "application/octet-stream" });
  fs.createReadStream(full).pipe(res);
}).listen(port, () => console.log(`KDJL map viewer: http://127.0.0.1:${port}/`));
