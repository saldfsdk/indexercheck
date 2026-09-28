export const DEFAULT_POLYGON_RPC_URLS = [
  "https://polygon.drpc.org",
  "https://tenderly.rpc.polygon.community",
  "https://polygon.publicnode.com"
];

export const DEFAULT_POLYMARKET_DATA_URLS = [
  "https://data-api.polymarket.com/v2/trades?limit=8&taker_only=true"
];


export function polymarketStatusUrl(dataUrl: string = DEFAULT_POLYMARKET_DATA_URLS[0]): string {
  const url = new URL(dataUrl);
  url.pathname = "/v2/status";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export const POLYMARKET_V2_EXCHANGES = [
  "0xe111180000d2663c0091e4f400237545b87b996b",
  "0xe2222d279d744050d28e00520010520000310f59"
];

export const POLYMARKET_V1_EXCHANGES = [
  "0x4bfb41d5b3570defd03c39a9a4d8de6bd8b8982e",
  "0xc5d563a36ae78145c45a50134d48a1215220f80a"
];

export const ORDER_FILLED_TOPIC_V2 = "0xd543adfd945773f1a62f74f0ee55a5e3b9b1a28262980ba90b1a89f2ea84d8ee";
export const ORDER_FILLED_TOPIC_V1 = "0xd0a08e8c493f9c94f29311604c9de1b4e8c8d4c06bd0c789af57f2d65bfec0f6";

export interface IndexedTrade {
  transactionHash: string;
  timestamp?: number;
  source: "v2" | "v1";
}

export interface TradeProof {
  transactionHash: string;
  blockNumber: number;
  exchange: string;
  topic0: string;
}

export interface LiveDataApiBenchmarkResult {
  chainHead: number;
  sampledTrades: number;
  uniqueTransactions: number;
  verifiedTransactions: number;
  latestVerifiedBlock: number;
  latestVerifiedLagBlocks: number;
  rpcUrl: string;
  dataUrl: string;
  proofs: TradeProof[];
}

class HttpStatusError extends Error {
  constructor(
    readonly status:number,
    message:string,
    readonly retryAfterMs?:number
  ){ super(message); this.name="HttpStatusError"; }
}

function sleep(ms:number):Promise<void>{ return new Promise(resolve=>setTimeout(resolve,ms)); }

function parseRetryAfter(value:string|null):number|undefined {
  if(!value) return undefined;
  const seconds=Number(value);
  if(Number.isFinite(seconds) && seconds>=0) return Math.ceil(seconds*1000);
  const dateMs=Date.parse(value);
  if(Number.isFinite(dateMs)) return Math.max(0,dateMs-Date.now());
  return undefined;
}

function retryableStatus(status:number):boolean {
  return status===408 || status===425 || status===429 || status===500 || status===502 || status===503 || status===504;
}

async function requestJson(url:string, init:RequestInit, label:string):Promise<any> {
  let last:unknown;
  const delays=[1500,3000,6000];
  for(let attempt=0;attempt<4;attempt++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),20_000);
    try{
      const res=await fetch(url,{...init,headers:{"user-agent":"indexercheck-m0.3.2",...(init.headers??{})},signal:controller.signal});
      if(!res.ok){
        const error=new HttpStatusError(res.status,`${label} HTTP ${res.status}`,parseRetryAfter(res.headers.get("retry-after")));
        throw error;
      }
      return await res.json();
    }catch(error){
      last=error;
      const isStatus=error instanceof HttpStatusError;
      const canRetry=!isStatus || retryableStatus(error.status);
      if(attempt>=3 || !canRetry) break;
      const retryAfter=isStatus?error.retryAfterMs:undefined;
      await sleep(Math.max(delays[attempt]??6000,retryAfter??0));
    }finally{ clearTimeout(timer); }
  }
  throw last instanceof Error?last:new Error(`${label} request failed`);
}

async function getJson(url:string,label:string):Promise<any>{
  return requestJson(url,{method:"GET",headers:{accept:"application/json"}},label);
}

async function rpcSingle(url:string,method:string,params:unknown[]):Promise<any>{
  const body=await requestJson(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})},`RPC ${method}`);
  if(body.error) throw new Error(`RPC ${method} ${body.error.code}: ${body.error.message}`);
  return body.result;
}

async function rpcWithFallback(urls:string[],method:string,params:unknown[]):Promise<{result:any,url:string}>{
  const errors:string[]=[];
  for(const url of urls){
    try{return {result:await rpcSingle(url,method,params),url};}
    catch(error){errors.push(`${url}: ${error instanceof Error?error.message:String(error)}`);}
  }
  throw new Error(`All Polygon RPC endpoints failed for ${method}: ${errors.join(" | ")}`);
}

function parseTradeRows(body:any, source:"v2"|"v1"):IndexedTrade[]{
  const rows=Array.isArray(body)?body:(Array.isArray(body?.data)?body.data:[]);
  return rows.map((row:any)=>({
    transactionHash:String(row?.transaction_hash??row?.transactionHash??"").toLowerCase(),
    timestamp: row?.timestamp===undefined?undefined:Number(row.timestamp),
    source
  })).filter((row:IndexedTrade)=>/^0x[0-9a-f]{64}$/.test(row.transactionHash));
}

async function dataWithFallback(urls:string[]):Promise<{trades:IndexedTrade[];url:string}>{
  const errors:string[]=[];
  for(const url of urls){
    const source:"v2"|"v1"=url.includes("/v2/")?"v2":"v1";
    try{
      const body=await getJson(url,"Polymarket Data API");
      const trades=parseTradeRows(body,source);
      if(!trades.length) throw new Error("no trade transaction hashes in response");
      return {trades,url};
    }catch(error){errors.push(`${url}: ${error instanceof Error?error.message:String(error)}`);}
  }
  throw new Error(`All Polymarket Data API endpoints failed: ${errors.join(" | ")}`);
}

function num(v:string|number):number{return typeof v==="number"?v:Number(BigInt(v));}

function isRecognizedOrderFilled(log:any):boolean{
  const address=String(log?.address??"").toLowerCase();
  const topic0=String(log?.topics?.[0]??"").toLowerCase();
  const v2=POLYMARKET_V2_EXCHANGES.includes(address)&&topic0===ORDER_FILLED_TOPIC_V2;
  const v1=POLYMARKET_V1_EXCHANGES.includes(address)&&topic0===ORDER_FILLED_TOPIC_V1;
  return v2||v1;
}

export function findOrderFilledProof(receipt:any):TradeProof|undefined{
  if(!receipt?.transactionHash||!receipt?.blockNumber||!Array.isArray(receipt?.logs)) return undefined;
  const log=receipt.logs.find(isRecognizedOrderFilled);
  if(!log) return undefined;
  return {
    transactionHash:String(receipt.transactionHash).toLowerCase(),
    blockNumber:num(receipt.blockNumber),
    exchange:String(log.address).toLowerCase(),
    topic0:String(log.topics[0]).toLowerCase()
  };
}

export async function runPolymarketDataApiBenchmark(opts?:{
  rpcUrl?:string;
  rpcUrls?:string[];
  dataUrl?:string;
  dataUrls?:string[];
  sampleSize?:number;
  maxAnchorLagBlocks?:number;
}):Promise<LiveDataApiBenchmarkResult>{
  const rpcUrls=opts?.rpcUrl?[opts.rpcUrl]:(opts?.rpcUrls?.length?opts.rpcUrls:DEFAULT_POLYGON_RPC_URLS);
  const dataUrls=opts?.dataUrl?[opts.dataUrl]:(opts?.dataUrls?.length?opts.dataUrls:DEFAULT_POLYMARKET_DATA_URLS);
  const sampleSize=Math.max(1,Math.min(opts?.sampleSize??3,8));
  const maxAnchorLagBlocks=opts?.maxAnchorLagBlocks??100_000;

  const indexed=await dataWithFallback(dataUrls);
  const unique:string[]=[];
  const seen=new Set<string>();
  for(const trade of indexed.trades){
    if(seen.has(trade.transactionHash)) continue;
    seen.add(trade.transactionHash);
    unique.push(trade.transactionHash);
    if(unique.length>=sampleSize) break;
  }
  if(unique.length<sampleSize) throw new Error(`Data API returned only ${unique.length} unique trade transaction(s); need ${sampleSize}`);

  const latest=await rpcWithFallback(rpcUrls,"eth_getBlockByNumber",["latest",false]);
  let rpcUrl=latest.url;
  const chainHead=num(latest.result.number);

  const proofs:TradeProof[]=[];
  for(const txHash of unique){
    const ordered=[rpcUrl,...rpcUrls.filter(x=>x!==rpcUrl)];
    const receiptResult=await rpcWithFallback(ordered,"eth_getTransactionReceipt",[txHash]);
    rpcUrl=receiptResult.url;
    const receipt=receiptResult.result;
    if(!receipt) throw new Error(`Canonical chain has no receipt for indexed trade ${txHash}`);
    if(receipt.status!==undefined && String(receipt.status).toLowerCase()!=="0x1") throw new Error(`Indexed trade ${txHash} maps to reverted transaction`);
    const proof=findOrderFilledProof(receipt);
    if(!proof) throw new Error(`Indexed trade ${txHash} has no recognized Polymarket OrderFilled event in canonical receipt`);
    proofs.push(proof);
  }

  const latestVerifiedBlock=Math.max(...proofs.map(x=>x.blockNumber));
  const latestVerifiedLagBlocks=chainHead-latestVerifiedBlock;
  if(latestVerifiedLagBlocks<0) throw new Error(`Verified trade block ${latestVerifiedBlock} is ahead of chain head ${chainHead}`);
  if(latestVerifiedLagBlocks>maxAnchorLagBlocks) throw new Error(`Latest indexed trade is ${latestVerifiedLagBlocks} block(s) behind chain head; max ${maxAnchorLagBlocks}`);

  return {
    chainHead,
    sampledTrades:indexed.trades.length,
    uniqueTransactions:unique.length,
    verifiedTransactions:proofs.length,
    latestVerifiedBlock,
    latestVerifiedLagBlocks,
    rpcUrl,
    dataUrl:indexed.url,
    proofs
  };
}
