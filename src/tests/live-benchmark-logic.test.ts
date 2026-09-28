import test from "node:test";
import assert from "node:assert/strict";
import { findMissingKeys, orderFilledKey } from "../live/polymarket-public.js";

test("M0.3 event provenance key is case-insensitive",()=>{
  assert.equal(orderFilledKey("0xABC","0xDEF"),"0xabc:0xdef");
});

test("M0.3 completeness helper finds only canonical keys missing from indexed data",()=>{
  const missing=findMissingKeys(["0x1:0xa","0x2:0xb"],["0X1:0XA","0x9:0x9"]);
  assert.deepEqual(missing,["0x2:0xb"]);
});

import { createServer } from "node:http";
import { ORDER_FILLED_TOPIC0, POLYMARKET_EXCHANGE, runPolymarketPublicBenchmark } from "../live/polymarket-public.js";

async function listen(server:any):Promise<string>{
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const a=server.address();
  return `http://127.0.0.1:${a.port}`;
}
async function close(server:any):Promise<void>{
  await new Promise<void>((resolve,reject)=>server.close((e:any)=>e?reject(e):resolve()));
}

test("M0.3.1 live benchmark retries GraphQL 429 and falls back across RPC endpoints",async()=>{
  const anchorTx="0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const orderHash="0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  let gqlRequests=0;

  const server=createServer(async(req:any,res:any)=>{
    let raw=""; for await(const c of req) raw+=c;
    res.setHeader("content-type","application/json");

    if(req.url==="/gql"){
      gqlRequests++;
      if(gqlRequests===1){ res.statusCode=429; res.setHeader("retry-after","0"); res.end(JSON.stringify({error:"rate limited"})); return; }
      const j=JSON.parse(raw||"{}"); const q=String(j.query||"");
      if(q.includes("LiveAnchor")){
        res.end(JSON.stringify({data:{_meta:{block:{number:100,hash:"0xabc"},hasIndexingErrors:false},orderFilledEvents:[{transactionHash:anchorTx,orderHash,timestamp:"1000"}]}})); return;
      }
      res.end(JSON.stringify({data:{orderFilledEvents:[{transactionHash:anchorTx,orderHash,timestamp:"1000"}]}})); return;
    }

    if(req.url==="/rpc-bad"){
      res.statusCode=400; res.end(JSON.stringify({error:"bad endpoint"})); return;
    }

    if(req.url==="/rpc-good"){
      const j=JSON.parse(raw||"{}"); const method=j.method; const params=j.params??[]; let result:any=null;
      if(method==="eth_getBlockByNumber"){
        result=params[0]==="latest"?{number:"0x64",hash:"0xabc",timestamp:"0x3e8"}:{number:"0x64",hash:"0xabc",timestamp:"0x3e8"};
      } else if(method==="eth_getTransactionReceipt"){
        result={blockNumber:"0x64"};
      } else if(method==="eth_getLogs"){
        const filter=params[0]??{};
        result=String(filter.address).toLowerCase()===POLYMARKET_EXCHANGE.toLowerCase()
          ? [{transactionHash:anchorTx,blockNumber:"0x64",topics:[ORDER_FILLED_TOPIC0,orderHash],data:"0x"}]
          : [];
      }
      res.end(JSON.stringify({jsonrpc:"2.0",id:1,result})); return;
    }

    res.statusCode=404; res.end(JSON.stringify({error:"not found"}));
  });

  const base=await listen(server);
  try{
    const result=await runPolymarketPublicBenchmark({
      graphqlUrls:[`${base}/gql`],
      rpcUrls:[`${base}/rpc-bad`,`${base}/rpc-good`],
      maxLagBlocks:0
    });
    assert.equal(result.missingKeys.length,0);
    assert.equal(result.graphqlUrl,`${base}/gql`);
    assert.equal(result.rpcUrl,`${base}/rpc-good`);
    assert.equal(gqlRequests>=3,true);
  } finally { await close(server); }
});
