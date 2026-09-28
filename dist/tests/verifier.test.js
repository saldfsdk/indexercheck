import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { loadProject } from "../core/load-config.js";
import { verify } from "../core/verifier.js";
import { SourceUnavailableError } from "../core/source.js";
const examples = fileURLToPath(new URL("../../examples/", import.meta.url));
test("clean fixture has zero false positives", async () => {
    const p = await loadProject(`${examples}/clean-erc20.json`);
    const report = await verify(p.config, p.canonical, p.indexed);
    assert.equal(report.verdict, "PASS");
    assert.equal(report.results.every((r) => r.status === "PASS"), true);
});
test("Goldsky WETH golden bug resolves to DRIFT", async () => {
    const p = await loadProject(`${examples}/goldsky-weth.json`);
    const report = await verify(p.config, p.canonical, p.indexed);
    assert.equal(report.verdict, "DRIFT");
});
test("Graph CCTP golden bug resolves to INCOMPLETE while heads are healthy", async () => {
    const p = await loadProject(`${examples}/graph-cctp.json`);
    const report = await verify(p.config, p.canonical, p.indexed);
    assert.equal(report.verdict, "INCOMPLETE");
    assert.equal(report.indexedHead?.reportedHealthy, true);
    assert.equal(report.indexedHead?.reportedSynced, true);
    const head = report.results.find((r) => r.primitive === "CANONICAL_HEAD");
    assert.equal(head?.status, "PASS");
});
test("diagnostic report heads never turn an otherwise UNKNOWN proof into a process failure", async () => {
    const config = { name: "head-unavailable", canonical: { type: "fixture", file: "unused" }, indexed: { type: "fixture", file: "unused" }, checks: { stateParity: [{ name: "state", key: "Balance", proof: { type: "evm-call", to: "0x0000000000000000000000000000000000000001", selector: "0x70a08231", returnType: "uint256" } }] } };
    const canonical = {
        getHead: async () => { throw new SourceUnavailableError("json-rpc", "getHead", new Error("head unavailable")); },
        getState: async () => undefined,
        getEvents: async () => [],
        getEvmCallProof: async () => { throw new Error("proof unavailable"); },
    };
    const indexed = {
        getHead: async () => { throw new SourceUnavailableError("http-json", "getHead", new Error("indexed head unavailable")); },
        getState: async () => ({ key: "Balance", value: "1", blockNumber: 10, payload: {} }),
        getEvents: async () => [],
    };
    const report = await verify(config, canonical, indexed);
    assert.equal(report.verdict, "UNKNOWN");
    assert.equal(report.canonicalHead, undefined);
    assert.equal(report.indexedHead, undefined);
});
//# sourceMappingURL=verifier.test.js.map