import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { checkStateParity } from "../core/primitives.js";
import { validateProjectConfig } from "../core/load-config.js";
import { verify } from "../core/verifier.js";
import { JsonRpcSource } from "../sources/json-rpc.js";
import { GraphQlSource } from "../sources/graphql.js";
import { HttpJsonSource } from "../sources/http-json.js";
import type { IndexerCheckConfig, StateParityCheckConfig } from "../core/types.js";

const TOKEN = "0x1111111111111111111111111111111111111111";
const ACCOUNT = "0x2222222222222222222222222222222222222222";
const SELECTOR = "0x70a08231";
const BLOCK = 100;
const CANONICAL_BALANCE = 123n;

function uintWord(value: bigint): string { return `0x${value.toString(16).padStart(64, "0")}`; }
function addressWord(address: string): string { return `${"0".repeat(24)}${address.slice(2).toLowerCase()}`; }

async function withServer(fn: (base: string) => Promise<void>): Promise<void> {
  const server = createServer(async (req: any, res: any) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    res.setHeader("content-type", "application/json");
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname === "/rest-state") {
      res.end(JSON.stringify({ row: { account: ACCOUNT, balance: CANONICAL_BALANCE.toString(), blockNumber: BLOCK } }));
      return;
    }
    if (url.pathname === "/rest-state-mismatch") {
      res.end(JSON.stringify({ row: { account: ACCOUNT, balance: "999", blockNumber: BLOCK } }));
      return;
    }
    if (url.pathname === "/graphql") {
      res.end(JSON.stringify({ data: { balance: { account: ACCOUNT, value: CANONICAL_BALANCE.toString(), blockNumber: BLOCK } } }));
      return;
    }

    const body = JSON.parse(raw || "{}");
    if (body.method === "eth_getBlockByNumber") {
      const tag = String(body.params?.[0] ?? "latest");
      const number = tag === "latest" ? 110 : Number(BigInt(tag));
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { number: `0x${number.toString(16)}`, hash: `0x${number.toString(16).padStart(64, "0")}`, parentHash: `0x${(number - 1).toString(16).padStart(64, "0")}` } }));
      return;
    }
    if (body.method === "eth_call") {
      const blockTag = String(body.params?.[1]);
      const data = String(body.params?.[0]?.data ?? "").toLowerCase();
      if (blockTag !== `0x${BLOCK.toString(16)}`) {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: `wrong historical block ${blockTag}` } }));
        return;
      }
      if (data !== `${SELECTOR}${addressWord(ACCOUNT)}`) {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: `unexpected calldata ${data}` } }));
        return;
      }
      if (url.pathname.includes("archivefail")) {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "missing trie node; historical state unavailable" } }));
        return;
      }
      if (url.pathname === "/rpc-c") {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: "down" }));
        return;
      }
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: uintWord(CANONICAL_BALANCE) }));
      return;
    }
    res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: null }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address: any = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  try { await fn(base); } finally { await new Promise<void>((resolve, reject) => server.close((error: any) => error ? reject(error) : resolve())); }
}

function canonical(base: string, archiveFailure = false): JsonRpcSource {
  return new JsonRpcSource({
    type: "json-rpc",
    url: `${base}/rpc-a`,
    fallbackUrls: archiveFailure ? [`${base}/rpc-b-archivefail`, `${base}/rpc-c-archivefail`] : [`${base}/rpc-b`, `${base}/rpc-c`],
    rpcQuorum: { minAgreement: 2, maxHeadSkewBlocks: 8 },
    headTag: "latest",
  });
}

const check: StateParityCheckConfig = {
  name: "generic-balance-parity",
  key: "Balance",
  proof: {
    type: "evm-call",
    to: TOKEN,
    selector: SELECTOR,
    args: [{ type: "address", indexedPath: "balance.account" }],
    returnType: "uint256",
  },
};

test("M2.2 GraphQL indexed state proves historical balanceOf with 2-of-3 RPC quorum", async () => withServer(async (base) => {
  const indexed = new GraphQlSource({
    type: "graphql",
    url: `${base}/graphql`,
    state: {
      Balance: {
        query: "query Balance { balance { account value blockNumber } }",
        valuePath: "balance.value",
        blockPath: "balance.blockNumber",
      },
    },
  });
  const result = await checkStateParity(canonical(base), indexed, check);
  assert.equal(result.status, "PASS");
  assert.equal(result.evidence?.classification, "MATCH");
  assert.equal(result.evidence?.blockNumber, BLOCK);
  assert.equal(result.evidence?.canonicalValue, CANONICAL_BALANCE.toString());
  assert.equal(result.evidence?.indexedValue, CANONICAL_BALANCE.toString());
  assert.equal((result.evidence?.canonicalMetadata as any).rpcQuorum.agreeingProviders.length, 2);
  assert.equal((result.evidence?.canonicalMetadata as any).rpcQuorum.failedProviders.length, 1);
}));

test("M2.2 REST indexed state mismatch becomes STATE_PARITY FAIL and DRIFT", async () => withServer(async (base) => {
  const indexed = new HttpJsonSource({
    type: "http-json",
    url: `${base}/rest-state-mismatch`,
    state: { Balance: { valuePath: "row.balance", blockPath: "row.blockNumber" } },
  });
  const restCheck: StateParityCheckConfig = { ...check, proof: { ...check.proof!, args: [{ type: "address", indexedPath: "row.account" }] } };
  const result = await checkStateParity(canonical(base), indexed, restCheck);
  assert.equal(result.status, "FAIL");
  assert.equal(result.evidence?.classification, "VALUE_MISMATCH");
  assert.equal(result.evidence?.indexedValue, "999");
  assert.equal(result.evidence?.canonicalValue, CANONICAL_BALANCE.toString());

  const config: IndexerCheckConfig = {
    name: "state-drift",
    canonical: { type: "json-rpc", url: `${base}/rpc-a`, fallbackUrls: [`${base}/rpc-b`, `${base}/rpc-c`], rpcQuorum: { minAgreement: 2 }, headTag: "latest" },
    indexed: { type: "http-json", url: `${base}/rest-state-mismatch`, state: { Balance: { valuePath: "row.balance", blockPath: "row.blockNumber" } } },
    checks: { stateParity: [restCheck] },
  };
  const report = await verify(config, canonical(base), indexed);
  assert.equal(report.verdict, "DRIFT");
}));

test("M2.2 insufficient historical RPC quorum becomes UNKNOWN instead of false DRIFT", async () => withServer(async (base) => {
  const indexed = new HttpJsonSource({
    type: "http-json",
    url: `${base}/rest-state`,
    state: { Balance: { valuePath: "row.balance", blockPath: "row.blockNumber" } },
  });
  const restCheck: StateParityCheckConfig = { ...check, proof: { ...check.proof!, args: [{ type: "address", indexedPath: "row.account" }] } };
  const result = await checkStateParity(canonical(base, true), indexed, restCheck);
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.evidence?.classification, "CANONICAL_PROOF_UNAVAILABLE");
  assert.equal(String(result.evidence?.reason).includes("quorum"), true);
}));

test("M2.2 config validation rejects dynamic ABI state proof types and missing historical block mapping", () => {
  const base: IndexerCheckConfig = {
    name: "generic-state",
    canonical: { type: "json-rpc", url: "https://rpc-a.example", fallbackUrls: ["https://rpc-b.example", "https://rpc-c.example"], rpcQuorum: { minAgreement: 2 } },
    indexed: { type: "http-json", url: "https://indexer.example/state", state: { Balance: { valuePath: "row.balance", blockPath: "row.blockNumber" } } },
    checks: { stateParity: [check] },
  };
  validateProjectConfig(base);

  let dynamicError: unknown;
  try {
    validateProjectConfig({
      ...base,
      checks: { stateParity: [{ ...check, proof: { ...check.proof!, returnType: "string" as any } }] },
    });
  } catch (error) { dynamicError = error; }
  assert.equal(dynamicError instanceof Error, true);
  assert.equal(String((dynamicError as Error).message).includes("Unsupported static ABI type"), true);

  let blockError: unknown;
  try {
    validateProjectConfig({
      ...base,
      indexed: { type: "http-json", url: "https://indexer.example/state", state: { Balance: { valuePath: "row.balance" } } },
    });
  } catch (error) { blockError = error; }
  assert.equal(blockError instanceof Error, true);
  assert.equal(String((blockError as Error).message).includes("blockPath"), true);
});
