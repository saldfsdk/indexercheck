import assert from "node:assert/strict";
import { createServer } from "node:http";
import { JsonRpcSource } from "../sources/json-rpc.js";
import { GraphQlSource } from "../sources/graphql.js";
import { checkCanonicalHead, checkEventCompleteness, checkStateParity } from "../core/primitives.js";

const server=createServer(async(req:any,res:any)=>{let body="";for await(const c of req)body+=c;const j=JSON.parse(body||"{}");res.setHeader("content-type","application/json");if(j.jsonrpc){let result:any;if(j.method==="eth_getBlockByNumber")result={number:"0x64",hash:"0xcafe"};else if(j.method==="eth_call")result="0x2a";else if(j.method==="eth_getLogs")result=[{transactionHash:"0x111",logIndex:"0x0",blockNumber:"0x64",address:"0x0000000000000000000000000000000000000001",topics:[],data:"0x"}];res.end(JSON.stringify({jsonrpc:"2.0",id:1,result}));return;}if(String(j.query).includes("Head"))res.end(JSON.stringify({data:{meta:{block:{number:100},healthy:true,synced:true}}}));else if(String(j.query).includes("State"))res.end(JSON.stringify({data:{token:{value:"42",block:100}}}));else res.end(JSON.stringify({data:{events:[]}}));});
await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));const a=server.address();const url=`http://127.0.0.1:${a.port}`;
try{
 const rpc=new JsonRpcSource({type:"json-rpc",url,state:{x:{to:"0x0000000000000000000000000000000000000001",data:"0x00",decode:"uint256"}},events:{e:{fromBlock:100,toBlock:100}}});
 const gql=new GraphQlSource({type:"graphql",url,head:{query:"query Head { meta { block { number } healthy synced } }",blockPath:"meta.block.number",healthyPath:"meta.healthy",syncedPath:"meta.synced"},state:{x:{query:"query State { token { value block } }",valuePath:"token.value",blockPath:"token.block"}},events:{e:{query:"query Events { events { txHash logIndex blockNumber } }",arrayPath:"events",txHashPath:"txHash",logIndexPath:"logIndex",blockPath:"blockNumber"}}});
 assert.equal((await checkCanonicalHead(rpc,gql,{maxLagBlocks:0})).status,"PASS");
 assert.equal((await checkStateParity(rpc,gql,{name:"x",key:"x"})).status,"PASS");
 assert.equal((await checkEventCompleteness(rpc,gql,{name:"e",stream:"e"})).status,"FAIL");
 console.log("M0.2 live adapters: JSON-RPC + GraphQL HTTP PASS");
 console.log("M0.2 primitives over live adapters: HEAD + STATE + EVENTS PASS");
} finally { await new Promise<void>((r,j)=>server.close((e:any)=>e?j(e):r())); }
