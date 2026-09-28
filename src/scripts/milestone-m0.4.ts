import assert from "node:assert/strict";
import { createServer } from "node:http";
import { JsonRpcSource } from "../sources/json-rpc.js";
import { GraphQlSource } from "../sources/graphql.js";
import { checkFirstDivergence } from "../core/primitives.js";

function hex(n:number):string{return `0x${n.toString(16)}`;}
const server=createServer(async(req:any,res:any)=>{
  let body=""; for await(const c of req) body+=c;
  const j=JSON.parse(body||"{}"); res.setHeader("content-type","application/json");
  if(j.jsonrpc){
    let result:any;
    if(j.method==="eth_getBlockByNumber"){
      const tag=j.params?.[0]; const n=tag==="finalized"?106:Number(BigInt(tag)); result={number:hex(n),hash:`0xblock${n}`};
    }else if(j.method==="eth_call"){
      const n=Number(BigInt(j.params?.[1])); result=n>=104?"0x0a":"0x00";
    }else if(j.method==="eth_getLogs"){
      const filter=j.params?.[0]??{}; const from=Number(BigInt(filter.fromBlock)); const to=Number(BigInt(filter.toBlock));
      const rows:any[]=[];
      if(from<=102&&to>=102)rows.push({transactionHash:"0xaaa",logIndex:"0x0",blockNumber:hex(102),address:"0x0000000000000000000000000000000000000001",topics:[],data:"0x"});
      if(from<=105&&to>=105)rows.push({transactionHash:"0xbbb",logIndex:"0x1",blockNumber:hex(105),address:"0x0000000000000000000000000000000000000001",topics:[],data:"0x"});
      result=rows;
    }
    res.end(JSON.stringify({jsonrpc:"2.0",id:1,result})); return;
  }
  const q=String(j.query||""); const vars=j.variables??{};
  if(q.includes("Head")){
    res.end(JSON.stringify({data:{meta:{block:{number:106},healthy:true,synced:true}}})); return;
  }
  if(q.includes("State")){
    const block=Number(vars.block??106); res.end(JSON.stringify({data:{token:{balance:"0",block}}})); return;
  }
  const from=Number(vars.fromBlock??100); const to=Number(vars.toBlock??106); const events:any[]=[];
  if(from<=102&&to>=102)events.push({txHash:"0xaaa",logIndex:0,blockNumber:102});
  res.end(JSON.stringify({data:{events}}));
});

await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
const a=server.address(); const url=`http://127.0.0.1:${a.port}`;
try{
  const canonical=new JsonRpcSource({
    type:"json-rpc",url,headTag:"finalized",
    state:{balance:{to:"0x0000000000000000000000000000000000000001",data:"0x70a08231",decode:"uint256"}},
    events:{transfers:{address:"0x0000000000000000000000000000000000000001",fromBlock:100,toBlock:106}},
  });
  const indexed=new GraphQlSource({
    type:"graphql",url,
    head:{query:"query Head { meta { block { number } healthy synced } }",blockPath:"meta.block.number",healthyPath:"meta.healthy",syncedPath:"meta.synced"},
    state:{balance:{query:"query State($block:Int!){ token(block:{number:$block}) { balance block } }",valuePath:"token.balance",blockPath:"token.block",historicalBlockVariable:"block"}},
    events:{transfers:{query:"query Events($fromBlock:Int!,$toBlock:Int!){ events(where:{block_gte:$fromBlock,block_lte:$toBlock}) { txHash logIndex blockNumber } }",arrayPath:"events",txHashPath:"txHash",logIndexPath:"logIndex",blockPath:"blockNumber",historicalFromBlockVariable:"fromBlock",historicalToBlockVariable:"toBlock"}},
  });

  const state=await checkFirstDivergence(canonical,indexed,{
    name:"state-live-history",target:{primitive:"STATE_PARITY",key:"balance"},fromBlock:100,toBlock:106,strategy:"binary-monotonic",maxChecks:16,
  });
  assert.equal(state.firstBadBlock,104); assert.equal(state.lastGoodBlock,103);

  const events=await checkFirstDivergence(canonical,indexed,{
    name:"events-live-history",target:{primitive:"EVENT_COMPLETENESS",stream:"transfers",startBlock:100},fromBlock:100,toBlock:106,strategy:"binary-monotonic",maxChecks:16,
  });
  assert.equal(events.firstBadBlock,105); assert.equal(events.lastGoodBlock,104);

  console.log("M0.4 FIRST_DIVERGENCE: historical JSON-RPC + GraphQL block reads PASS");
  console.log(`M0.4 state divergence: lastGood=${state.lastGoodBlock} firstBad=${state.firstBadBlock} PASS`);
  console.log(`M0.4 event divergence: lastGood=${events.lastGoodBlock} firstBad=${events.firstBadBlock} PASS`);
}finally{
  await new Promise<void>((r,j)=>server.close((e:any)=>e?j(e):r()));
}
