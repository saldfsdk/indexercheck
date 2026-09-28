import test from "node:test";
import assert from "node:assert/strict";
import { buildPresetConfig } from "../core/init.js";
import { validateProjectConfig } from "../core/load-config.js";
import { RpcQuorumError, rpcExactQuorum, rpcHeadQuorum } from "../live/rpc-quorum.js";
test("M1.3 quorum accepts a 2-of-3 canonical majority", async () => {
    const result = await rpcExactQuorum(["rpc-a", "rpc-b", "rpc-c"], "eth_getLogs", [], async (url) => url === "rpc-c" ? [{ transactionHash: "0xbad" }] : [{ transactionHash: "0xgood" }], 2);
    assert.equal(result.evidence.agreeingProviders.length, 2);
    assert.equal(result.result[0].transactionHash, "0xgood");
});
test("M1.3 quorum refuses to invent canonical truth when providers disagree", async () => {
    let caught;
    try {
        await rpcExactQuorum(["rpc-a", "rpc-b"], "eth_getLogs", [], async (url) => [{ transactionHash: url === "rpc-a" ? "0xa" : "0xb" }], 2);
    }
    catch (error) {
        caught = error;
    }
    assert.equal(caught instanceof RpcQuorumError, true);
});
test("M1.3 head quorum verifies a common block instead of comparing moving latest heads", async () => {
    const heads = { "rpc-a": 102, "rpc-b": 100 };
    const result = await rpcHeadQuorum(["rpc-a", "rpc-b"], "latest", async (url, _method, params) => {
        const tag = params[0];
        if (tag === "latest")
            return { number: `0x${heads[url].toString(16)}`, hash: `0xlatest${url}` };
        return { number: "0x64", hash: "0xagreed", parentHash: "0xparent" };
    }, 2, 8);
    assert.equal(result.evidence.agreedBlockNumber, 100);
    assert.equal(result.evidence.headSkewBlocks, 2);
    assert.equal(result.result.hash, "0xagreed");
});
test("M1.3 production preset requires two-provider canonical agreement in both RPC paths", () => {
    const config = buildPresetConfig("polymarket-pilot");
    assert.equal(config.canonical.type, "json-rpc");
    assert.equal(config.indexed.type, "polymarket-data-api");
    if (config.canonical.type !== "json-rpc" || config.indexed.type !== "polymarket-data-api")
        throw new Error("unexpected preset source types");
    assert.equal(config.canonical.rpcQuorum?.minAgreement, 2);
    assert.equal(config.indexed.rpcQuorum?.minAgreement, 2);
    assert.equal(config.canonical.rpcQuorum?.maxHeadSkewBlocks, 8);
    assert.equal(config.indexed.rpcQuorum?.maxHeadSkewBlocks, 8);
});
test("M1.3 config validation rejects an impossible quorum", () => {
    const config = buildPresetConfig("polymarket-pilot");
    if (config.canonical.type !== "json-rpc")
        throw new Error("unexpected canonical source");
    config.canonical.rpcQuorum = { minAgreement: 4, maxHeadSkewBlocks: 8 };
    let caught;
    try {
        validateProjectConfig(config);
    }
    catch (error) {
        caught = error;
    }
    assert.equal(caught instanceof Error, true);
});
test("M1.3.1 exact quorum tolerates one unavailable provider in a 2-of-3 set", async () => {
    const result = await rpcExactQuorum(["rpc-a", "rpc-b", "rpc-c"], "eth_getLogs", [], async (url) => {
        if (url === "rpc-c")
            throw new Error("provider unavailable");
        return [{ transactionHash: "0xagreed" }];
    }, 2);
    assert.equal(result.evidence.successfulProviders.length, 2);
    assert.equal(result.evidence.agreeingProviders.length, 2);
    assert.equal(result.evidence.failedProviders.length, 1);
    assert.equal(result.evidence.failedProviders[0].url, "rpc-c");
});
test("M1.3.1 head quorum tolerates one unavailable provider in a 2-of-3 set", async () => {
    const heads = { "rpc-a": 102, "rpc-b": 100 };
    const result = await rpcHeadQuorum(["rpc-a", "rpc-b", "rpc-c"], "latest", async (url, _method, params) => {
        if (url === "rpc-c")
            throw new Error("provider unavailable");
        const tag = params[0];
        if (tag === "latest")
            return { number: `0x${heads[url].toString(16)}`, hash: `0xlatest${url}` };
        return { number: "0x64", hash: "0xagreed", parentHash: "0xparent" };
    }, 2, 8);
    assert.equal(result.evidence.agreedBlockNumber, 100);
    assert.equal(result.evidence.failedProviders.length, 1);
    assert.equal(result.evidence.failedProviders[0].url, "rpc-c");
});
test("M1.3.1 production preset has three independent RPC endpoints for 2-of-3 quorum", () => {
    const config = buildPresetConfig("polymarket-pilot");
    if (config.canonical.type !== "json-rpc" || config.indexed.type !== "polymarket-data-api")
        throw new Error("unexpected preset source types");
    const canonicalUrls = [config.canonical.url, ...(config.canonical.fallbackUrls ?? [])];
    const indexedUrls = config.indexed.rpcUrls ?? [];
    assert.equal(new Set(canonicalUrls).size, 3);
    assert.equal(new Set(indexedUrls).size, 3);
    assert.equal(config.canonical.rpcQuorum?.minAgreement, 2);
    assert.equal(config.indexed.rpcQuorum?.minAgreement, 2);
    assert.deepEqual(indexedUrls, canonicalUrls);
});
test("M1.3.2 head quorum verifies a settled agreement block behind the live frontier", async () => {
    const heads = { "rpc-a": 105, "rpc-b": 104, "rpc-c": 103 };
    const requested = [];
    const result = await rpcHeadQuorum(["rpc-a", "rpc-b", "rpc-c"], "latest", async (url, _method, params) => {
        const tag = String(params[0]);
        requested.push(`${url}:${tag}`);
        if (tag === "latest")
            return { number: `0x${heads[url].toString(16)}`, hash: `0xlatest-${url}` };
        // The newest common frontier could still be fork-skewed, but five blocks
        // behind it all providers agree on the same canonical block.
        if (tag === "0x62")
            return { number: "0x62", hash: "0xsettled", parentHash: "0xparent" };
        return { number: tag, hash: `0xfork-${url}`, parentHash: "0xparent" };
    }, 2, 8, 5);
    assert.equal(result.evidence.observedMinHead, 103);
    assert.equal(result.evidence.agreedBlockNumber, 98);
    assert.equal(result.evidence.agreementLagBlocks, 5);
    assert.equal(result.result.hash, "0xsettled");
    assert.equal(requested.some((value) => value.endsWith(":0x67")), false);
});
test("M1.3.2 production preset uses the same finality-aware agreement lag on both RPC paths", () => {
    const config = buildPresetConfig("polymarket-pilot");
    if (config.canonical.type !== "json-rpc" || config.indexed.type !== "polymarket-data-api")
        throw new Error("unexpected preset source types");
    assert.equal(config.canonical.rpcQuorum?.agreementLagBlocks, 5);
    assert.equal(config.indexed.rpcQuorum?.agreementLagBlocks, 5);
});
//# sourceMappingURL=m1.3-rpc-quorum.test.js.map