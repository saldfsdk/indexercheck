import { readFile } from "node:fs/promises";
import { buildPresetConfig } from "../core/init.js";
import { DEFAULT_POLYGON_RPC_URLS } from "../live/polymarket-data-api.js";

const expected = [
  "https://polygon.drpc.org",
  "https://tenderly.rpc.polygon.community",
  "https://polygon.publicnode.com",
];
if (JSON.stringify(DEFAULT_POLYGON_RPC_URLS) !== JSON.stringify(expected)) {
  throw new Error(`M1.4.2 provider rotation mismatch: ${JSON.stringify(DEFAULT_POLYGON_RPC_URLS)}`);
}
const config = buildPresetConfig("polymarket-pilot");
if (config.watch?.confirmConsecutiveFailures?.SOURCE_FRESHNESS !== 3) {
  throw new Error("M1.4.2 production preset does not confirm SOURCE_FRESHNESS across three ticks");
}
if (config.canonical.type !== "json-rpc" || JSON.stringify([config.canonical.url, ...(config.canonical.fallbackUrls ?? [])]) !== JSON.stringify(expected)) {
  throw new Error("M1.4.2 canonical provider set is not the rotated 2-of-3 pool");
}
if (config.indexed.type !== "polymarket-data-api" || JSON.stringify(config.indexed.rpcUrls) !== JSON.stringify(expected)) {
  throw new Error("M1.4.2 Polymarket verifier provider set is not the rotated 2-of-3 pool");
}
const pkg = JSON.parse(await readFile("package.json", "utf8")) as { scripts?: Record<string, string> };
if (!pkg.scripts?.["pilot:watch:soak"]?.includes("--max-iterations 12")) {
  throw new Error("M1.4.2 soak does not run long enough to observe freshness confirmation/recovery");
}
console.log("M1.4.2 freshness confirmation: SOURCE_FRESHNESS requires three consecutive failing watch ticks PASS");
console.log("M1.4.2 provider rotation: Lava is removed from the production pilot RPC pool PASS");
console.log("M1.4.2 provider pool: dRPC + Tenderly + Allnodes/PublicNode share the same 2-of-3 quorum on both RPC paths PASS");
console.log("M1.4.2 soak horizon: production soak runs 12 ticks to observe stale confirmation or recovery PASS");
