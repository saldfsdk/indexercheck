import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { buildPresetConfig } from "../core/init.js";
import { checkProvenance, checkSourceFreshness } from "../core/primitives.js";
import { GoldskyEulerSubgraphSource } from "../sources/goldsky-euler-subgraph.js";
import { DEFAULT_ETHEREUM_RPC_URLS, GOLDSKY_EULER_MAINNET_GRAPHQL } from "../live/goldsky-euler.js";
const TXS = ["a", "b", "c"].map((c) => `0x${c.repeat(64)}`);
const ACCOUNTS = ["1", "2", "3"].map((c) => `0x${c.repeat(40)}`);
const VAULTS = ["4", "5", "6"].map((c) => `0x${c.repeat(40)}`);
const BALANCES = [101n, 202n, 303n];
const DEBTS = [11n, 22n, 33n];
const BLOCKS = [90, 91, 92];
function serverScript(tamper = false) {
    return `
    const http=require("node:http");
    const txs=${JSON.stringify(TXS)};
    const accounts=${JSON.stringify(ACCOUNTS)};
    const vaults=${JSON.stringify(VAULTS)};
    const balances=[101n,202n,303n];
    const debts=[11n,22n,33n];
    const blocks=[90,91,92];
    const tamper=${JSON.stringify(tamper)};
    const q=n=>"0x"+BigInt(n).toString(16);
    const server=http.createServer((req,res)=>{
      const chunks=[];req.on("data",c=>chunks.push(c));req.on("end",()=>{
        const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString("utf8")):{};
        res.setHeader("content-type","application/json");
        if(req.url==="/graphql"){
          if(String(body.query).includes("_meta")){res.end(JSON.stringify({data:{_meta:{block:{number:102,hash:"0xmeta"},hasIndexingErrors:false}}}));return;}
          const rows=txs.map((tx,i)=>({id:accounts[i]+vaults[i].slice(2),account:accounts[i],vault:vaults[i],balance:String((tamper&&i===1)?999n:balances[i]),debt:String(debts[i]),blockNumber:String(blocks[i]),blockTimestamp:String(1000+i),transactionHash:tx}));
          res.end(JSON.stringify({data:{trackingVaultBalances:rows}}));return;
        }
        if(String(req.url).startsWith("/rpc")){
          if(body.method==="eth_getBlockByNumber"){
            const tag=body.params[0];
            if(tag==="latest"){res.end(JSON.stringify({jsonrpc:"2.0",id:1,result:{number:"0x69",hash:"0xlatest",parentHash:"0xp"}}));return;}
            res.end(JSON.stringify({jsonrpc:"2.0",id:1,result:{number:tag,hash:"0xsafe",parentHash:"0xp"}}));return;
          }
          if(body.method==="eth_getTransactionReceipt"){
            const i=txs.indexOf(String(body.params[0]).toLowerCase());
            const result=i<0?null:{transactionHash:txs[i],blockHash:"0xb",blockNumber:q(blocks[i]),status:"0x1",logs:[]};
            res.end(JSON.stringify({jsonrpc:"2.0",id:1,result}));return;
          }
          if(body.method==="eth_call"){
            const call=body.params[0]||{};
            const data=String(call.data||"").toLowerCase();
            const account="0x"+data.slice(-40);
            const i=accounts.indexOf(account);
            let result="0x0";
            if(i>=0 && data.startsWith("0x70a08231")) result=q(balances[i]);
            if(i>=0 && data.startsWith("0xd283e75f")) result=q(debts[i]);
            res.end(JSON.stringify({jsonrpc:"2.0",id:1,result}));return;
          }
        }
        res.statusCode=404;res.end(JSON.stringify({error:"not found"}));
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
    return new GoldskyEulerSubgraphSource({
        type: "goldsky-euler-subgraph",
        graphqlUrl: `http://127.0.0.1:${port}/graphql`,
        rpcUrls: [`http://127.0.0.1:${port}/rpc-a`, `http://127.0.0.1:${port}/rpc-b`, `http://127.0.0.1:${port}/rpc-c`],
        rpcQuorum: { minAgreement: 2, maxHeadSkewBlocks: 3, agreementLagBlocks: 2 },
        sampleSize: 3,
    });
}
test("M1.5.1 Goldsky Euler _meta freshness uses Ethereum 2-of-3 canonical quorum", async () => {
    const { child, port } = await startServer();
    try {
        const result = await checkSourceFreshness(source(port), { name: "fresh", stream: "TrackingVaultBalance", maxLagBlocks: 12, maxAgeSeconds: 300 });
        assert.equal(result.status, "PASS");
        assert.equal(result.evidence?.freshnessBasis, "goldsky-subgraph-meta");
        assert.equal(result.evidence?.lagBlocks, 1); // safe canonical 103 vs indexed 102
    }
    finally {
        try {
            child.kill();
        }
        catch { }
    }
});
test("M1.5.1 Euler TrackingVaultBalance proves canonical receipt + historical balance/debt state", async () => {
    const { child, port } = await startServer();
    try {
        const result = await checkProvenance(source(port), { name: "prov", stream: "TrackingVaultBalance", minSamples: 3 });
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
test("M1.5.1 Euler state provenance catches a tampered indexed balance", async () => {
    const { child, port } = await startServer(true);
    try {
        const result = await checkProvenance(source(port), { name: "prov", stream: "TrackingVaultBalance", minSamples: 3 });
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
test("M1.5.1 production Goldsky pilot no longer depends on the retired Kaia tutorial demo", () => {
    const cfg = buildPresetConfig("goldsky-euler-mainnet-pilot");
    assert.equal(cfg.canonical.type, "json-rpc");
    assert.equal(cfg.indexed.type, "goldsky-euler-subgraph");
    if (cfg.canonical.type !== "json-rpc" || cfg.indexed.type !== "goldsky-euler-subgraph")
        throw new Error("unexpected source types");
    assert.deepEqual([cfg.canonical.url, ...(cfg.canonical.fallbackUrls ?? [])], DEFAULT_ETHEREUM_RPC_URLS);
    assert.equal(cfg.indexed.graphqlUrl, GOLDSKY_EULER_MAINNET_GRAPHQL);
    assert.equal(cfg.indexed.rpcQuorum?.minAgreement, 2);
    assert.equal(cfg.checks.provenance?.[0]?.stream, "TrackingVaultBalance");
    assert.equal(!cfg.indexed.graphqlUrl.includes("usdt-demo-kaia"), true);
});
function archiveServerScript(debtRevert = false) {
    return `
    const http=require("node:http");
    const txs=${JSON.stringify(TXS)};
    const accounts=${JSON.stringify(ACCOUNTS)};
    const vaults=${JSON.stringify(VAULTS)};
    const balances=[101n,202n,303n];
    const debts=${JSON.stringify(debtRevert)}?[0n,0n,0n]:[11n,22n,33n];
    const blocks=[90,91,92];
    const q=n=>"0x"+BigInt(n).toString(16);
    const server=http.createServer((req,res)=>{
      const chunks=[];req.on("data",c=>chunks.push(c));req.on("end",()=>{
        const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString("utf8")):{};
        res.setHeader("content-type","application/json");
        if(req.url==="/graphql"){
          if(String(body.query).includes("_meta")){res.end(JSON.stringify({data:{_meta:{block:{number:102,hash:"0xmeta"},hasIndexingErrors:false}}}));return;}
          const rows=txs.map((tx,i)=>({id:accounts[i]+vaults[i].slice(2),account:accounts[i],vault:vaults[i],balance:String(balances[i]),debt:String(debts[i]),blockNumber:String(blocks[i]),blockTimestamp:String(1000+i),transactionHash:tx}));
          res.end(JSON.stringify({data:{trackingVaultBalances:rows}}));return;
        }
        if(String(req.url).startsWith("/rpc")){
          if(body.method==="eth_getBlockByNumber"){
            const tag=body.params[0];
            if(tag==="latest"){res.end(JSON.stringify({jsonrpc:"2.0",id:1,result:{number:"0x69",hash:"0xlatest",parentHash:"0xp"}}));return;}
            res.end(JSON.stringify({jsonrpc:"2.0",id:1,result:{number:tag,hash:"0xsafe",parentHash:"0xp"}}));return;
          }
          if(body.method==="eth_getTransactionReceipt"){
            const i=txs.indexOf(String(body.params[0]).toLowerCase());
            const result=i<0?null:{transactionHash:txs[i],blockHash:"0xb",blockNumber:q(blocks[i]),status:"0x1",logs:[]};
            res.end(JSON.stringify({jsonrpc:"2.0",id:1,result}));return;
          }
          if(body.method==="eth_call"){
            if(req.url==="/rpc-c"){
              res.end(JSON.stringify({jsonrpc:"2.0",id:1,error:{code:-32000,message:"historical state is not available"}}));return;
            }
            const call=body.params[0]||{};
            const data=String(call.data||"").toLowerCase();
            const account="0x"+data.slice(-40);
            const i=accounts.indexOf(account);
            if(${JSON.stringify(debtRevert)} && data.startsWith("0xd283e75f")){
              res.end(JSON.stringify({jsonrpc:"2.0",id:1,error:{code:3,message:"execution reverted"}}));return;
            }
            let result="0x0";
            if(i>=0 && data.startsWith("0x70a08231")) result=q(balances[i]);
            if(i>=0 && data.startsWith("0xd283e75f")) result=q(debts[i]);
            res.end(JSON.stringify({jsonrpc:"2.0",id:1,result}));return;
          }
        }
        res.statusCode=404;res.end(JSON.stringify({error:"not found"}));
      });
    });
    server.listen(0,"127.0.0.1",()=>process.stdout.write(String(server.address().port)+"\\n"));
  `;
}
async function startArchiveServer(debtRevert = false) {
    const child = spawn(process.execPath, ["-e", archiveServerScript(debtRevert)], { stdio: ["ignore", "pipe", "pipe"] });
    const port = await new Promise((resolve, reject) => { let b = ""; child.stdout.on("data", (c) => { b += String(c); const i = b.indexOf("\n"); if (i >= 0)
        resolve(Number(b.slice(0, i))); }); child.on("error", reject); });
    return { child, port };
}
test("M1.5.2 historical state quorum survives one non-archive RPC provider", async () => {
    const { child, port } = await startArchiveServer(false);
    try {
        const result = await checkProvenance(source(port), { name: "prov", stream: "TrackingVaultBalance", minSamples: 3 });
        assert.equal(result.status, "PASS");
        assert.equal(result.evidence?.verified, 3);
        const rows = result.evidence?.metadata?.rows ?? [];
        assert.equal(rows[0]?.balanceQuorum?.failedProviders?.length, 1);
    }
    finally {
        try {
            child.kill();
        }
        catch { }
    }
});
test("M1.5.2 Euler try_debtOf revert is canonically interpreted as debt zero", async () => {
    const { child, port } = await startArchiveServer(true);
    try {
        const result = await checkProvenance(source(port), { name: "prov", stream: "TrackingVaultBalance", minSamples: 3 });
        assert.equal(result.status, "PASS");
        assert.equal(result.evidence?.verified, 3);
        const rows = result.evidence?.metadata?.rows ?? [];
        assert.equal(rows[0]?.debtQuorum?.semanticRevertProviders?.length, 2);
    }
    finally {
        try {
            child.kill();
        }
        catch { }
    }
});
//# sourceMappingURL=m1.5.1-goldsky-euler-pilot.test.js.map