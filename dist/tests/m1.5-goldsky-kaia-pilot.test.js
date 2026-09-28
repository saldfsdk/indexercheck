import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { buildPresetConfig } from "../core/init.js";
import { checkProvenance, checkSourceFreshness } from "../core/primitives.js";
import { GoldskyErc20SubgraphSource } from "../sources/goldsky-erc20-subgraph.js";
import { DEFAULT_KAIA_RPC_URLS, GOLDSKY_KAIA_USDT_GRAPHQL, KAIA_USDT_ADDRESS } from "../live/goldsky-kaia.js";
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const FROM = "0x1111111111111111111111111111111111111111";
const TO = "0x2222222222222222222222222222222222222222";
const TXS = ["a", "b", "c"].map((c) => `0x${c.repeat(64)}`);
const padAddress = (address) => `0x${address.slice(2).padStart(64, "0")}`;
const padUint = (value) => `0x${BigInt(value).toString(16).padStart(64, "0")}`;
function serverScript(tamper = false) {
    return `
    const http = require("node:http");
    const txs = ${JSON.stringify(TXS)};
    const token = ${JSON.stringify(KAIA_USDT_ADDRESS)};
    const transferTopic = ${JSON.stringify(TRANSFER_TOPIC)};
    const from = ${JSON.stringify(FROM)};
    const to = ${JSON.stringify(TO)};
    const padAddress = a => "0x" + a.slice(2).padStart(64,"0");
    const padUint = n => "0x" + BigInt(n).toString(16).padStart(64,"0");
    const tamper = ${JSON.stringify(tamper)};
    const server = http.createServer((req,res) => {
      const chunks=[]; req.on("data",c=>chunks.push(c)); req.on("end",()=>{
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
        res.setHeader("content-type","application/json");
        if (req.url === "/graphql") {
          if (String(body.query).includes("_meta")) {
            res.end(JSON.stringify({data:{_meta:{block:{number:100,hash:"0xmeta"},hasIndexingErrors:false}}})); return;
          }
          const rows = txs.map((tx,i)=>({id:tx+"-0",from,to,value:String((tamper && i===1) ? 999 : 100+i)}));
          res.end(JSON.stringify({data:{transfers:rows}})); return;
        }
        if (String(req.url).startsWith("/rpc")) {
          if (body.method === "eth_getBlockByNumber") {
            const tag = body.params[0];
            if (tag === "latest") { res.end(JSON.stringify({jsonrpc:"2.0",id:1,result:{number:"0x69",hash:"0xlatest",parentHash:"0xp"}})); return; }
            res.end(JSON.stringify({jsonrpc:"2.0",id:1,result:{number:tag,hash:"0xsafe",parentHash:"0xp"}})); return;
          }
          if (body.method === "eth_getTransactionReceipt") {
            const i = txs.indexOf(String(body.params[0]).toLowerCase());
            const result = i < 0 ? null : {
              transactionHash: txs[i], blockHash:"0xb", blockNumber:"0x"+(90+i).toString(16), status:"0x1",
              logs:[{address:token, transactionHash:txs[i], blockHash:"0xb", blockNumber:"0x"+(90+i).toString(16), logIndex:"0x0", topics:[transferTopic,padAddress(from),padAddress(to)], data:padUint(100+i)}]
            };
            res.end(JSON.stringify({jsonrpc:"2.0",id:1,result})); return;
          }
        }
        res.statusCode=404; res.end(JSON.stringify({error:"not found"}));
      });
    });
    server.listen(0,"127.0.0.1",()=>process.stdout.write(String(server.address().port)+"\\n"));
  `;
}
async function startServer(tamper = false) {
    const child = spawn(process.execPath, ["-e", serverScript(tamper)], { stdio: ["ignore", "pipe", "pipe"] });
    const port = await new Promise((resolve, reject) => { let b = ""; child.stdout.on("data", (c) => { b += String(c); const i = b.indexOf("\n"); if (i >= 0)
        resolve(Number(b.slice(0, i))); }); child.on("error", reject); });
    return { child, port };
}
function source(port) {
    return new GoldskyErc20SubgraphSource({
        type: "goldsky-erc20-subgraph",
        graphqlUrl: `http://127.0.0.1:${port}/graphql`,
        rpcUrls: [`http://127.0.0.1:${port}/rpc-a`, `http://127.0.0.1:${port}/rpc-b`, `http://127.0.0.1:${port}/rpc-c`],
        rpcQuorum: { minAgreement: 2, maxHeadSkewBlocks: 8, agreementLagBlocks: 3 },
        tokenAddress: KAIA_USDT_ADDRESS,
        sampleSize: 3,
    });
}
test("M1.5 Goldsky _meta freshness is checked against Kaia canonical quorum", async () => {
    const { child, port } = await startServer();
    try {
        const result = await checkSourceFreshness(source(port), { name: "fresh", stream: "Transfer", maxLagBlocks: 30, maxAgeSeconds: 300 });
        assert.equal(result.status, "PASS");
        assert.equal(result.evidence?.freshnessBasis, "goldsky-subgraph-meta");
        assert.equal(result.evidence?.lagBlocks, 2); // safe canonical 102 vs indexed meta 100
    }
    finally {
        try {
            child.kill();
        }
        catch { }
    }
});
test("M1.5 Goldsky USDT rows prove canonical Transfer provenance without optional schema fields", async () => {
    const { child, port } = await startServer();
    try {
        const result = await checkProvenance(source(port), { name: "prov", stream: "Transfer", minSamples: 3 });
        assert.equal(result.status, "PASS");
        assert.equal(result.evidence?.verified, 3);
        assert.equal(result.evidence?.failureCount, 0);
    }
    finally {
        try {
            child.kill();
        }
        catch { }
    }
});
test("M1.5 provenance catches an indexed Transfer payload that differs from the canonical log", async () => {
    const { child, port } = await startServer(true);
    try {
        const result = await checkProvenance(source(port), { name: "prov", stream: "Transfer", minSamples: 3 });
        assert.equal(result.status, "FAIL");
        assert.equal(result.evidence?.failureCount, 1);
    }
    finally {
        try {
            child.kill();
        }
        catch { }
    }
});
test("M1.5 second production preset is provider-neutral and uses official Kaia/Goldsky public surfaces", () => {
    const cfg = buildPresetConfig("goldsky-kaia-usdt-pilot");
    assert.equal(cfg.canonical.type, "json-rpc");
    assert.equal(cfg.indexed.type, "goldsky-erc20-subgraph");
    if (cfg.canonical.type !== "json-rpc" || cfg.indexed.type !== "goldsky-erc20-subgraph")
        throw new Error("unexpected source types");
    assert.deepEqual([cfg.canonical.url, ...(cfg.canonical.fallbackUrls ?? [])], DEFAULT_KAIA_RPC_URLS);
    assert.equal(cfg.indexed.graphqlUrl, GOLDSKY_KAIA_USDT_GRAPHQL);
    assert.equal(cfg.indexed.tokenAddress, KAIA_USDT_ADDRESS);
    assert.equal(cfg.indexed.rpcQuorum?.minAgreement, 2);
    assert.equal(cfg.checks.provenance?.[0]?.stream, "Transfer");
});
//# sourceMappingURL=m1.5-goldsky-kaia-pilot.test.js.map