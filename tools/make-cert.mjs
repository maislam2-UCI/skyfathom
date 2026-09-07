// Creates a self-signed certificate in certs/ (git-ignored) so the phone can open the app over HTTPS
// on the local network — required for camera and motion sensors. Uses the openssl shipped with Git.
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../certs/", import.meta.url));
mkdirSync(dir, { recursive: true });
const ips = Object.values(networkInterfaces()).flat().filter(i => i?.family === "IPv4" && !i.internal).map(i => i.address);
const san = ["DNS:localhost", "IP:127.0.0.1", ...ips.map(ip => "IP:" + ip)].join(",");
const candidates = ["openssl", "C:\\Program Files\\Git\\usr\\bin\\openssl.exe", "C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe"];
let ok = false;
for (const bin of candidates) {
  try {
    execFileSync(bin, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256", "-days", "825", "-subj", "/CN=NightSky dev", "-addext", "subjectAltName=" + san,
      "-keyout", dir + "key.pem", "-out", dir + "cert.pem"], { stdio: "pipe" });
    ok = true; console.log(`certs/cert.pem + key.pem created for ${san}\nNext: npm run dev → open https://<laptop-ip>:4322 on the phone, accept the warning once.`); break;
  } catch (e) { if (existsSync(dir + "cert.pem")) { ok = true; break; } }
}
if (!ok) console.error("openssl not found. Install Git for Windows (ships openssl) or create certs/cert.pem + key.pem another way.");
