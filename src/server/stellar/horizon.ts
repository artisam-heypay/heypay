import "server-only";
import { Horizon, Networks } from "@stellar/stellar-sdk";

let server: Horizon.Server | null = null;

export function getHorizon(): Horizon.Server {
  if (!server) {
    const url = process.env.STELLAR_HORIZON_URL;
    if (!url) throw new Error("STELLAR_HORIZON_URL is not set");
    server = new Horizon.Server(url, { allowHttp: url.startsWith("http://") });
  }
  return server;
}

export function getNetworkPassphrase(): string {
  const explicit = process.env.STELLAR_NETWORK_PASSPHRASE;
  if (explicit) return explicit;
  return process.env.STELLAR_NETWORK === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
}

export function __resetHorizonForTests(): void {
  server = null;
}
