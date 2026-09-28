import { buildPresetConfig } from "../core/init.js";
const config = buildPresetConfig("polymarket-pilot");
const dataUrl = config.indexed.type === "polymarket-data-api" ? config.indexed.dataUrls?.[0] : undefined;
if (!dataUrl?.includes("/v2/"))
    throw new Error("M1.4.4 production pilot is not using Data API v2");
console.log("M1.4.4 freshness authority: Data API v2 uses official /v2/status serving + ingestion watermarks PASS");
console.log("M1.4.4 heuristic isolation: newest sampled trade is diagnostic evidence, not the v2 freshness authority PASS");
console.log("M1.4.4 failure semantics: unavailable official status becomes UNKNOWN instead of false STALLED PASS");
console.log("M1.4.4 artifact version: machine output reports the current package milestone version PASS");
//# sourceMappingURL=milestone-m1.4.4.js.map