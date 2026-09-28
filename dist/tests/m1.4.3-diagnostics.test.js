import test from "node:test";
import assert from "node:assert/strict";
import { polymarketStatusUrl } from "../live/polymarket-data-api.js";
test("M1.4.3 derives the official v2 status endpoint from a trades URL", () => {
    assert.equal(polymarketStatusUrl("https://data-api.polymarket.com/v2/trades?limit=500&taker_only=true"), "https://data-api.polymarket.com/v2/status");
});
//# sourceMappingURL=m1.4.3-diagnostics.test.js.map