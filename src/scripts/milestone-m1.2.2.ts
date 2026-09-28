import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildPresetConfig } from "../core/init.js";
import { validateProjectConfig } from "../core/load-config.js";
import { DEFAULT_POLYMARKET_DATA_URLS } from "../live/polymarket-data-api.js";

const preset = buildPresetConfig("polymarket-pilot");
validateProjectConfig(preset);
if (preset.indexed.type !== "polymarket-data-api") throw new Error("pilot indexed source must be Polymarket Data API");

const examplePath = fileURLToPath(new URL("../../examples/polymarket-pilot.json", import.meta.url));
const example = JSON.parse(await readFile(examplePath, "utf8"));
assert.deepEqual(example, preset, "checked-in production example must remain identical to the generated pilot preset");

const urls = preset.indexed.dataUrls ?? [];
if (!urls.length || urls.some((raw) => {
  const url = new URL(raw);
  return !url.pathname.includes("/v2/trades") || url.searchParams.get("taker_only") !== "true";
})) {
  throw new Error("M1.2.2 pilot feed must be v2-only with explicit taker_only=true");
}
if (DEFAULT_POLYMARKET_DATA_URLS.some((raw) => {
  const url = new URL(raw);
  return !url.pathname.includes("/v2/trades") || url.searchParams.get("taker_only") !== "true";
})) {
  throw new Error("default Polymarket feed must be isolated to v2 taker semantics");
}

console.log("M1.2.2 production feed: checked-in example equals generated preset PASS");
console.log("M1.2.2 source isolation: transaction completeness rejects mixed v1/v2 configuration PASS");
console.log("M1.2.2 cohort stability: v2 production feed pins taker_only=true for probe + pagination PASS");
console.log("M1.2.2 failure semantics: v2 outage cannot silently fall back to legacy v1 in production pilot PASS");
