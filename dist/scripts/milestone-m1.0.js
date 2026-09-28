import { createServer } from "node:http";
import { writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { buildPresetConfig } from "../core/init.js";
import { loadProject } from "../core/load-config.js";
import { verify } from "../core/verifier.js";
import { buildMachineReport } from "../core/delivery.js";
import { advanceWatchState } from "../core/watch.js";
import { ORDER_FILLED_TOPIC_V2, POLYMARKET_V2_EXCHANGES } from "../live/polymarket-data-api.js";
const txs = ["a", "b", "c"].map((x) => `0x${x.repeat(64)}`);
const server = createServer((req, res) => {
    if (req.method === "GET" && String(req.url).startsWith("/trades")) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(txs.map((transaction_hash) => ({ transaction_hash }))));
        return;
    }
    if (req.method === "POST" && req.url === "/rpc") {
        let bodyText = "";
        req.on("data", (chunk) => { bodyText += String(chunk); });
        req.on("end", () => {
            const body = JSON.parse(bodyText);
            let result = null;
            if (body.method === "eth_getBlockByNumber")
                result = { number: "0x67", hash: "0xhead" };
            if (body.method === "eth_getTransactionReceipt") {
                const index = txs.indexOf(String(body.params[0]).toLowerCase());
                if (index >= 0)
                    result = {
                        transactionHash: txs[index],
                        blockNumber: `0x${(100 + index).toString(16)}`,
                        status: "0x1",
                        logs: [{ address: POLYMARKET_V2_EXCHANGES[0], topics: [ORDER_FILLED_TOPIC_V2], logIndex: "0x0" }],
                    };
            }
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
        });
        return;
    }
    res.statusCode = 404;
    res.end("not found");
});
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
const port = typeof address === "object" && address ? address.port : 0;
const configPath = resolve(`./.m1.0-milestone-${process.pid}.json`);
try {
    const preset = buildPresetConfig("polymarket-pilot");
    if (preset.canonical.type !== "json-rpc" || preset.indexed.type !== "polymarket-data-api")
        throw new Error("M1.0 preset source types are wrong");
    if (!preset.checks.provenance?.length)
        throw new Error("M1.0 preset missing provenance check");
    const config = {
        ...preset,
        name: "m1.0-production-pilot-milestone",
        canonical: { type: "json-rpc", url: `http://127.0.0.1:${port}/rpc`, headTag: "latest" },
        indexed: {
            type: "polymarket-data-api",
            dataUrls: [`http://127.0.0.1:${port}/trades`],
            rpcUrls: [`http://127.0.0.1:${port}/rpc`],
            sampleSize: 3,
            maxAnchorLagBlocks: 10,
            cacheTtlMs: 1_000,
        },
        checks: {
            head: { name: "indexed-freshness", maxLagBlocks: 10 },
            provenance: [{ name: "orderfilled-provenance", stream: "OrderFilled", minSamples: 3 }],
        },
    };
    await writeFile(configPath, JSON.stringify(config), "utf8");
    const project = await loadProject(configPath);
    const report = await verify(project.config, project.canonical, project.indexed);
    if (report.verdict !== "PASS")
        throw new Error(`M1.0 verify expected PASS, got ${report.verdict}`);
    const provenance = report.results.find((item) => item.primitive === "PROVENANCE");
    if (provenance?.status !== "PASS" || provenance.evidence?.verified !== 3)
        throw new Error("M1.0 provenance did not verify 3/3 rows");
    if (report.canonicalHead?.blockNumber !== 103 || report.indexedHead?.blockNumber !== 102)
        throw new Error("M1.0 pilot heads are incorrect");
    const artifact = buildMachineReport(report);
    const first = advanceWatchState(undefined, artifact, "2026-01-01T00:00:00.000Z");
    const second = advanceWatchState(first.state, artifact, "2026-01-01T00:01:00.000Z");
    if (first.detected !== 0 || second.detected !== 0 || Object.keys(second.state.active).length !== 0)
        throw new Error("M1.0 PASS watch lifecycle should remain incident-free");
    console.log("M1.0 init preset: json-rpc + polymarket-data-api + PROVENANCE PASS");
    console.log("M1.0 production pilot: 3 indexed trades -> 3 canonical OrderFilled proofs PASS");
    console.log("M1.0 live-style verify: canonicalHead=103 indexedHead=102 freshness+provenance PASS");
    console.log("M1.0 continuous watch integration: repeated PASS ticks remain incident-free PASS");
}
finally {
    await new Promise((resolveClose) => server.close(() => resolveClose()));
    try {
        await unlink(configPath);
    }
    catch { }
}
//# sourceMappingURL=milestone-m1.0.js.map