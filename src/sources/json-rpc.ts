import type { EventRangeSnapshot, EvmCallProofRequest, EvmCallProofSnapshot, SnapshotSource } from "../core/source.js";
import { SourceUnavailableError } from "../core/source.js";
import type { EventRecord, HeadSnapshot, JsonRpcSourceConfig, RpcDecode, StateValue } from "../core/types.js";
import {
  normalizeBlockForQuorum,
  normalizeLogsForQuorum,
  rpcExactQuorum,
  rpcHeadQuorum,
} from "../live/rpc-quorum.js";

function asHexBlock(v:number|string): string { return typeof v === "number" ? `0x${v.toString(16)}` : v; }
function decodeValue(value:string, decode:RpcDecode="hex"): string {
  if (decode === "hex") return value.toLowerCase();
  if (decode === "uint256") return BigInt(value).toString(10);
  if (decode === "bool") return BigInt(value) === 0n ? "false" : "true";
  if (decode === "address") return `0x${value.slice(-40)}`.toLowerCase();
  return value;
}

export class JsonRpcSource implements SnapshotSource {
  constructor(private readonly cfg: JsonRpcSourceConfig) {}

  private urls(): string[] {
    return [this.cfg.url, ...(this.cfg.fallbackUrls ?? []).filter((url) => url !== this.cfg.url)];
  }

  private async rpcSingle(url:string, method:string, params:unknown[]):Promise<any> {
    const res = await fetch(url,{method:"POST",headers:{"content-type":"application/json",...(this.cfg.headers??{})},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body:any = await res.json();
    if (body.error) throw new Error(`${body.error.code}: ${body.error.message}`);
    return body.result;
  }

  private async rpcFallback(method:string, params:unknown[]):Promise<any> {
    const errors:string[]=[];
    for(const url of this.urls()){
      try{ return await this.rpcSingle(url, method, params); }
      catch(error){ errors.push(`${url}: ${error instanceof Error?error.message:String(error)}`); }
    }
    throw new Error(`JSON-RPC ${method} failed: ${errors.join(" | ")}`);
  }

  private quorumMin(): number | undefined {
    if (!this.cfg.rpcQuorum) return undefined;
    return Math.max(1, this.cfg.rpcQuorum.minAgreement ?? 2);
  }

  private async rpcExact(method:string, params:unknown[], normalize:(value:any)=>unknown=(value)=>value):Promise<any> {
    const minAgreement = this.quorumMin();
    if (!minAgreement) return this.rpcFallback(method, params);
    const result = await rpcExactQuorum(this.urls(), method, params, (url, m, p) => this.rpcSingle(url, m, p), minAgreement, normalize);
    return result.result;
  }

  async getHead():Promise<HeadSnapshot> {
    try {
      const minAgreement = this.quorumMin();
      let block:any;
      if (minAgreement) {
        const result = await rpcHeadQuorum(
          this.urls(),
          this.cfg.headTag??"finalized",
          (url, method, params) => this.rpcSingle(url, method, params),
          minAgreement,
          Math.max(0, this.cfg.rpcQuorum?.maxHeadSkewBlocks ?? 8),
          Math.max(0, this.cfg.rpcQuorum?.agreementLagBlocks ?? 0),
        );
        block = result.result;
      } else {
        block = await this.rpcFallback("eth_getBlockByNumber",[this.cfg.headTag??"finalized",false]);
      }
      if (!block?.number) throw new Error("JSON-RPC head missing block number");
      return {blockNumber:Number(BigInt(block.number)),blockHash:block.hash,observedAt:new Date().toISOString()};
    } catch (error) {
      throw new SourceUnavailableError("json-rpc", "getHead", error);
    }
  }

  async getBlockAt(blockNumber:number):Promise<HeadSnapshot|undefined> {
    const block=await this.rpcExact("eth_getBlockByNumber",[asHexBlock(blockNumber),false], normalizeBlockForQuorum);
    if(!block?.number)return undefined;
    return {blockNumber:Number(BigInt(block.number)),blockHash:block.hash};
  }

  async getState(key:string):Promise<StateValue|undefined> {
    const m=this.cfg.state?.[key]; if(!m) return undefined;
    if (this.quorumMin()) {
      // Quorum state reads use an explicit agreed block so providers cannot be
      // compared at slightly different "latest" heights.
      const head = await this.getHead();
      const blockTag = asHexBlock(head.blockNumber);
      const value = await this.rpcExact("eth_call",[{to:m.to,data:m.data},blockTag]);
      return {key,value:decodeValue(value,m.decode),blockNumber:head.blockNumber};
    }
    const blockTag=m.blockTag??this.cfg.headTag??"finalized";
    const [value, block] = await Promise.all([this.rpcFallback("eth_call",[{to:m.to,data:m.data},blockTag]),this.rpcFallback("eth_getBlockByNumber",[blockTag,false])]);
    return {key,value:decodeValue(value,m.decode),blockNumber:block?.number?Number(BigInt(block.number)):undefined};
  }

  async getStateAt(key:string,blockNumber:number):Promise<StateValue|undefined> {
    const m=this.cfg.state?.[key]; if(!m) return undefined;
    const blockTag=asHexBlock(blockNumber);
    const value=await this.rpcExact("eth_call",[{to:m.to,data:m.data},blockTag]);
    return {key,value:decodeValue(value,m.decode),blockNumber};
  }

  async getEvmCallProof(request:EvmCallProofRequest):Promise<EvmCallProofSnapshot> {
    const blockTag=asHexBlock(request.blockNumber);
    const params=[{to:request.to,data:request.data},blockTag];
    const minAgreement=this.quorumMin();
    if(minAgreement){
      const result=await rpcExactQuorum(
        this.urls(),
        "eth_call",
        params,
        (url,method,rpcParams)=>this.rpcSingle(url,method,rpcParams),
        minAgreement,
        (value)=>String(value).toLowerCase(),
      );
      return {value:String(result.result).toLowerCase(),blockNumber:request.blockNumber,metadata:{rpcQuorum:result.evidence}};
    }
    const value=await this.rpcFallback("eth_call",params);
    return {value:String(value).toLowerCase(),blockNumber:request.blockNumber,metadata:{rpcProviderMode:"fallback"}};
  }

  private logsToEvents(stream:string, logs:any[]): EventRecord[] {
    const m=this.cfg.events?.[stream];
    return logs.map(log=>({id:`${String(log.transactionHash).toLowerCase()}:${Number(BigInt(log.logIndex))}`,blockNumber:Number(BigInt(log.blockNumber)),txHash:String(log.transactionHash).toLowerCase(),logIndex:Number(BigInt(log.logIndex)),address:String(log.address).toLowerCase(),eventName:m?.eventName,payload:{topics:log.topics,data:log.data}}));
  }
  private async eventsInRange(stream:string,fromBlock:number|string,toBlock:number|string):Promise<EventRangeSnapshot> {
    const m=this.cfg.events?.[stream]; if(!m) return {events:[]};
    const params=[{address:m.address,topics:m.topics,fromBlock:asHexBlock(fromBlock),toBlock:asHexBlock(toBlock)}];
    const minAgreement=this.quorumMin();
    if(minAgreement){
      const result=await rpcExactQuorum(this.urls(),"eth_getLogs",params,(url,method,rpcParams)=>this.rpcSingle(url,method,rpcParams),minAgreement,normalizeLogsForQuorum);
      return {events:this.logsToEvents(stream,result.result),metadata:{rpcQuorum:result.evidence}};
    }
    const logs:any[]=await this.rpcFallback("eth_getLogs",params);
    return {events:this.logsToEvents(stream,logs)};
  }
  async getEvents(stream:string):Promise<EventRecord[]> {
    const m=this.cfg.events?.[stream]; if(!m) return [];
    return (await this.eventsInRange(stream,m.fromBlock,m.toBlock)).events;
  }
  async getEventsAt(stream:string,fromBlock:number,toBlock:number):Promise<EventRecord[]> {
    return (await this.eventsInRange(stream,fromBlock,toBlock)).events;
  }
  async getEventsAtWithEvidence(stream:string,fromBlock:number,toBlock:number):Promise<EventRangeSnapshot> {
    return this.eventsInRange(stream,fromBlock,toBlock);
  }
}
