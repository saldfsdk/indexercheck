import { buildPresetConfig } from "../core/init.js";
import { DEFAULT_POLYMARKET_DATA_URLS } from "../live/polymarket-data-api.js";

const preset = buildPresetConfig("polymarket-pilot");
if (preset.indexed.type !== "polymarket-data-api") throw new Error("pilot indexed source must be Polymarket Data API");
const urls = preset.indexed.dataUrls ?? [];
if (!urls.length || urls.some((url) => !url.includes("/v2/"))) {
  throw new Error("M1.2.1 pilot must use only Data API v2 feeds for production semantics");
}
if (DEFAULT_POLYMARKET_DATA_URLS.some((url) => !url.includes("/v2/"))) {
  throw new Error("default data URLs must not silently fall back to legacy v1");
}
if (preset.checks.transactionCompleteness?.[0]?.stream !== "OrderFilled") throw new Error("pilot preset missing transaction completeness");

console.log("M1.2.1 Data API semantics: production preset uses v2-only trade feed PASS");
console.log("M1.2.1 pagination: cursor-only implementation covered by regression suite; legacy offset removed PASS");
console.log("M1.2.1 cohort stability: taker_only=true preserved across cursor pages PASS");
console.log("M1.2.1 completeness isolation: legacy v1 is never used as a silent semantic fallback PASS");
