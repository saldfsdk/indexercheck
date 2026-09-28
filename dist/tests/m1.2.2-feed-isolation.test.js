import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildPresetConfig } from "../core/init.js";
import { validateProjectConfig } from "../core/load-config.js";
import { DEFAULT_POLYMARKET_DATA_URLS } from "../live/polymarket-data-api.js";
function v2Only(urls) {
    return urls.length > 0 && urls.every((raw) => {
        const url = new URL(raw);
        return url.pathname.includes("/v2/trades") && url.searchParams.get("taker_only") === "true";
    });
}
test("M1.2.2 checked-in production example matches generated preset exactly", async () => {
    const example = JSON.parse(await readFile(resolve("examples/polymarket-pilot.json"), "utf8"));
    const preset = buildPresetConfig("polymarket-pilot");
    assert.deepEqual(example, preset);
});
test("M1.2.2 production preset and defaults are v2-only with explicit taker cohort", () => {
    const preset = buildPresetConfig("polymarket-pilot");
    assert.equal(preset.indexed.type, "polymarket-data-api");
    if (preset.indexed.type !== "polymarket-data-api")
        return;
    assert.equal(v2Only(preset.indexed.dataUrls ?? []), true);
    assert.equal(v2Only(DEFAULT_POLYMARKET_DATA_URLS), true);
});
test("M1.2.2 rejects mixed-generation Polymarket feeds when completeness is enabled", () => {
    const config = buildPresetConfig("polymarket-pilot");
    if (config.indexed.type !== "polymarket-data-api")
        throw new Error("unexpected source");
    config.indexed.dataUrls = [
        "https://data-api.polymarket.com/v2/trades?limit=8&taker_only=true",
        "https://data-api.polymarket.com/trades?limit=8",
    ];
    let message = "";
    try {
        validateProjectConfig(config);
    }
    catch (error) {
        message = error instanceof Error ? error.message : String(error);
    }
    assert.equal(message.includes("requires v2-only dataUrls"), true);
});
test("M1.2.2 still permits legacy-only Polymarket source when reverse completeness is not requested", () => {
    const config = buildPresetConfig("polymarket-pilot");
    if (config.indexed.type !== "polymarket-data-api")
        throw new Error("unexpected source");
    config.indexed.dataUrls = ["https://data-api.polymarket.com/trades?limit=8"];
    config.checks.transactionCompleteness = [];
    let threw = false;
    try {
        validateProjectConfig(config);
    }
    catch {
        threw = true;
    }
    assert.equal(threw, false);
});
//# sourceMappingURL=m1.2.2-feed-isolation.test.js.map