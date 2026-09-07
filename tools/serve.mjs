// Zero-dependency static server for src/. Binds 0.0.0.0 so a phone on the
// same Wi-Fi can open http://<laptop-ip>:4321. NOTE: camera + sensors need a
// secure context; on a phone use HTTPS (see docs/PLAN.md → "Phone testing").
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname, normalize } from "node:path";
import { networkInterfaces } from "node:os";

const ROOT = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const PORT = Number(process.env.PORT || 4321);
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2",
};

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path.endsWith("/")) path += "index.html";
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(normalize(ROOT))) { res.writeHead(403); return res.end(); }
  try {
    if ((await stat(file)).isDirectory()) throw new Error("dir");
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store" });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("404 " + path);
  }
}).listen(PORT, "0.0.0.0", () => {
  const lan = Object.values(networkInterfaces()).flat().filter(i => i?.family === "IPv4" && !i.internal).map(i => i.address);
  console.log(`nightsky dev server: http://localhost:${PORT}` + (lan.length ? `  (LAN: ${lan.map(a => `http://${a}:${PORT}`).join(", ")})` : ""));
});
