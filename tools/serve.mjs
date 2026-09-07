// Zero-dependency static server for src/. Binds 0.0.0.0 so a phone on the same Wi-Fi can open it.
//   HTTP  : http://<laptop-ip>:4321   (map works; camera + motion sensors do NOT — insecure context)
//   HTTPS : https://<laptop-ip>:4322  (if certs/cert.pem + certs/key.pem exist — run `npm run cert`)
import { createServer as httpServer } from "node:http";
import { createServer as httpsServer } from "node:https";
import { readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../src/", import.meta.url));
const CERT_DIR = fileURLToPath(new URL("../certs/", import.meta.url));
const PORT = Number(process.env.PORT || 4321), SPORT = PORT + 1;
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".woff2": "font/woff2", ".txt": "text/plain", ".md": "text/markdown",
};
async function handler(req, res) {
  let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  // dev-only helper: POST /__save?name=<file> writes a base64 body into src/assets (used to bake textures in the browser)
  if (req.method === "POST" && path === "/__save" && (req.socket.remoteAddress || "").match(/127[.]0[.]0[.]1|::1|::ffff:127/)) {
    const name = new URL(req.url, "http://x").searchParams.get("name") || "";
    if (!/^[A-Za-z0-9_.-]+[.](jpg|png|webp)$/.test(name)) { res.writeHead(400); return res.end("bad name"); }
    let body = ""; req.setEncoding("utf8"); for await (const c of req) body += c;
    const { writeFile } = await import("node:fs/promises");
    await writeFile(join(ROOT, "assets", name), Buffer.from(body.replace(/^data:[^,]*,/, ""), "base64"));
    res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("saved " + name);
  }
  if (path.endsWith("/")) path += "index.html";
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(normalize(ROOT))) { res.writeHead(403); return res.end(); }
  try {
    if ((await stat(file)).isDirectory()) throw new Error("dir");
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-store", "Service-Worker-Allowed": "/" });
    res.end(body);
  } catch { res.writeHead(404, { "Content-Type": "text/plain" }); res.end("404 " + path); }
}
const lan = Object.values(networkInterfaces()).flat().filter(i => i?.family === "IPv4" && !i.internal).map(i => i.address);
httpServer(handler).listen(PORT, "0.0.0.0", () => console.log(`skyfathom http : http://localhost:${PORT}` + lan.map(a => `  http://${a}:${PORT}`).join("")));
const cert = join(CERT_DIR, "cert.pem"), key = join(CERT_DIR, "key.pem");
if (existsSync(cert) && existsSync(key)) {
  httpsServer({ cert: readFileSync(cert), key: readFileSync(key) }, handler).listen(SPORT, "0.0.0.0", () =>
    console.log(`skyfathom https: https://localhost:${SPORT}` + lan.map(a => `  https://${a}:${SPORT}`).join("") + "\n  (self-signed: accept the warning once on the phone; needed for camera + motion sensors)"));
} else console.log("no certs/ — HTTPS disabled. Run `npm run cert` to enable camera + sensors on the phone.");
