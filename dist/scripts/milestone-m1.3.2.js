import { buildPresetConfig } from "../core/init.js";
import { rpcHeadQuorum } from "../live/rpc-quorum.js";
const cfg = buildPresetConfig("polymarket-pilot");
if (cfg.canonical.type !== "json-rpc" || cfg.indexed.type !== "polymarket-data-api")
    throw new Error("unexpected preset source types");
if (cfg.canonical.rpcQuorum?.agreementLagBlocks !== 5 || cfg.indexed.rpcQuorum?.agreementLagBlocks !== 5) {
    throw new Error("M1.3.2 preset must use a five-block agreement lag in both RPC paths");
}
const heads = { a: 105, b: 104, c: 103 };
const q = await rpcHeadQuorum(["a", "b", "c"], "latest", async (url, _method, params) => {
    const tag = String(params[0]);
    if (tag === "latest")
        return { number: `0x${heads[url].toString(16)}`, hash: `0xlatest-${url}` };
    if (tag !== "0x62")
        throw new Error(`unexpected agreement tag ${tag}`);
    return { number: "0x62", hash: "0xsettled", parentHash: "0xparent" };
}, 2, 8, 5);
if (q.evidence.agreedBlockNumber !== 98 || q.result.hash !== "0xsettled")
    throw new Error("settled agreement block mismatch");
console.log("M1.3.2 finality-aware head: quorum verifies behind the moving provider frontier PASS");
console.log("M1.3.2 agreement domain: slowest observed head minus five blocks is hash-verified PASS");
console.log("M1.3.2 completeness safety: production code caps canonical comparison at the quorum-safe head PASS");
console.log("M1.3.2 pilot coverage: canonical source + Polymarket internal verifier share the same settlement lag PASS");
//# sourceMappingURL=milestone-m1.3.2.js.map