// Starts `next dev` over HTTPS bound to this machine's real LAN IP, so a phone
// on the same Wi-Fi can reach it (camera / getUserMedia require a secure origin).
//
// Why a script instead of a hardcoded -H: DHCP hands out different IPs, and the
// machine has several virtual adapters (VirtualBox host-only 192.168.56.x,
// WSL/Hyper-V vEthernet) whose IPs a phone can't reach. We pick the physical
// Wi-Fi/Ethernet address at runtime.
//
// TRUST_STORES=system makes mkcert skip the Java keystore. Without it, if a JDK
// is installed, `mkcert -install` fails writing cacerts (access denied), returns
// exit 1, and Next silently falls back to plain HTTP — which blocks the camera.
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";

const PORT = process.env.PORT ?? "3000";
const CERT_DIR = path.resolve("certificates");
const IP_MARKER = path.join(CERT_DIR, ".dev-ip");

// Names of known virtual/non-physical adapters a phone can't route to.
const VIRTUAL = /vethernet|virtualbox|vmware|hyper-v|wsl|loopback|docker|tailscale/i;
// Private IPv4 ranges. 192.168.56.x is VirtualBox's default host-only net → exclude.
const PRIVATE = /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.(?!56\.)\d+\.)/;

function detectLanIp() {
  const ifaces = os.networkInterfaces();
  const found = [];
  for (const [name, nets] of Object.entries(ifaces)) {
    if (VIRTUAL.test(name)) continue;
    for (const net of nets ?? []) {
      if (net.family !== "IPv4" || net.internal) continue;
      if (!PRIVATE.test(net.address)) continue;
      found.push({ name, address: net.address });
    }
  }
  // Prefer a Wi-Fi / wireless adapter, else the first physical one.
  const wifi = found.find((c) => /wi-?fi|wlan|wireless/i.test(c.name));
  return (wifi ?? found[0])?.address;
}

const ip = detectLanIp();
if (!ip) {
  console.error(
    "dev-https: no physical LAN IPv4 found. Connect to Wi-Fi/Ethernet, or run `pnpm dev` for localhost-only.",
  );
  process.exit(1);
}

// If the IP changed since last run, the cached cert's SANs no longer include it
// → wipe so Next regenerates a cert valid for the new IP.
if (existsSync(IP_MARKER) && readFileSync(IP_MARKER, "utf8").trim() !== ip) {
  rmSync(CERT_DIR, { recursive: true, force: true });
}
mkdirSync(CERT_DIR, { recursive: true });
writeFileSync(IP_MARKER, ip);

console.log(`dev-https: serving on https://${ip}:${PORT}  (open this on your phone)`);

const child = spawn(
  "npx",
  ["next", "dev", "--experimental-https", "-H", ip, "-p", PORT],
  { stdio: "inherit", shell: true, env: { ...process.env, TRUST_STORES: "system" } },
);
child.on("exit", (code) => process.exit(code ?? 0));
