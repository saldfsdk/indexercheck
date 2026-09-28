import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { IndexerCheckConfig } from "./types.js";
import { DEFAULT_POLYGON_RPC_URLS, DEFAULT_POLYMARKET_DATA_URLS } from "../live/polymarket-data-api.js";
import { DEFAULT_KAIA_RPC_URLS, GOLDSKY_KAIA_USDT_GRAPHQL, KAIA_USDT_ADDRESS } from "../live/goldsky-kaia.js";
import { DEFAULT_ETHEREUM_RPC_URLS, GOLDSKY_EULER_MAINNET_GRAPHQL } from "../live/goldsky-euler.js";

export type InitPreset = "generic-evm-log" | "polymarket-pilot" | "goldsky-kaia-usdt-pilot" | "goldsky-euler-mainnet-pilot";

export function buildPresetConfig(preset: InitPreset): IndexerCheckConfig {
  if (preset === "generic-evm-log") {
    return {
      name: "my-indexer-integrity",
      canonical: {
        type: "json-rpc",
        url: "https://rpc-1.example",
        fallbackUrls: ["https://rpc-2.example", "https://rpc-3.example"],
        rpcQuorum: { minAgreement: 2, maxHeadSkewBlocks: 8, agreementLagBlocks: 2 },
        headTag: "latest",
        events: {
          Transfer: {
            address: "0x1111111111111111111111111111111111111111",
            topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"],
            fromBlock: "latest",
            toBlock: "latest",
            eventName: "Transfer"
          }
        }
      },
      indexed: {
        type: "http-json",
        url: "https://indexer.example/api/transfers?limit=3",
        state: {
          Balance: {
            url: "https://indexer.example/api/balance?account=0x2222222222222222222222222222222222222222",
            valuePath: "row.balance",
            blockPath: "row.blockNumber"
          }
        },
        events: {
          Transfer: {
            arrayPath: "rows",
            blockPath: "blockNumber",
            txHashPath: "transactionHash",
            logIndexPath: "logIndex",
            eventName: "Transfer",
            historicalRequest: {
              url: "https://indexer.example/api/transfers?fromBlock={{fromBlock}}&toBlock={{toBlock}}"
            },
            historicalRangeComplete: true
          }
        }
      },
      checks: {
        stateParity: [{
          name: "balance-parity",
          key: "Balance",
          proof: {
            type: "evm-call",
            to: "0x1111111111111111111111111111111111111111",
            selector: "0x70a08231",
            args: [
              { type: "address", indexedPath: "row.account" }
            ],
            returnType: "uint256"
          }
        }],
        eventCompleteness: [{
          name: "transfer-completeness",
          stream: "Transfer",
          proof: {
            type: "evm-log-reverse",
            canonicalStream: "Transfer",
            windowBlocks: 50,
            settlementLagBlocks: 5
          }
        }],
        provenance: [{
          name: "transfer-provenance",
          stream: "Transfer",
          minSamples: 3,
          proof: {
            type: "evm-log",
            canonicalStream: "Transfer",
            sampleSize: 3,
            inputs: [
              { name: "from", type: "address", indexed: true, indexedPath: "from" },
              { name: "to", type: "address", indexed: true, indexedPath: "to" },
              { name: "value", type: "uint256", indexed: false, indexedPath: "value" }
            ]
          }
        }]
      }
    };
  }
  if (preset === "goldsky-euler-mainnet-pilot") {
    return {
      name: "goldsky-euler-mainnet-production-pilot",
      canonical: {
        type: "json-rpc",
        url: DEFAULT_ETHEREUM_RPC_URLS[0],
        fallbackUrls: DEFAULT_ETHEREUM_RPC_URLS.slice(1),
        rpcQuorum: { minAgreement: 2, maxHeadSkewBlocks: 3, agreementLagBlocks: 2 },
        headTag: "latest",
      },
      indexed: {
        type: "goldsky-euler-subgraph",
        graphqlUrl: GOLDSKY_EULER_MAINNET_GRAPHQL,
        rpcUrls: DEFAULT_ETHEREUM_RPC_URLS,
        rpcQuorum: { minAgreement: 2, maxHeadSkewBlocks: 3, agreementLagBlocks: 2 },
        sampleSize: 3,
      },
      checks: {
        sourceFreshness: [
          { name: "goldsky-euler-freshness", stream: "TrackingVaultBalance", maxLagBlocks: 12, maxAgeSeconds: 300 },
        ],
        provenance: [
          { name: "goldsky-euler-state-provenance", stream: "TrackingVaultBalance", minSamples: 3 },
        ],
      },
    };
  }
  if (preset === "goldsky-kaia-usdt-pilot") {
    return {
      name: "goldsky-kaia-usdt-production-pilot",
      canonical: {
        type: "json-rpc",
        url: DEFAULT_KAIA_RPC_URLS[0],
        fallbackUrls: DEFAULT_KAIA_RPC_URLS.slice(1),
        rpcQuorum: { minAgreement: 2, maxHeadSkewBlocks: 8, agreementLagBlocks: 3 },
        headTag: "latest",
      },
      indexed: {
        type: "goldsky-erc20-subgraph",
        graphqlUrl: GOLDSKY_KAIA_USDT_GRAPHQL,
        rpcUrls: DEFAULT_KAIA_RPC_URLS,
        rpcQuorum: { minAgreement: 2, maxHeadSkewBlocks: 8, agreementLagBlocks: 3 },
        tokenAddress: KAIA_USDT_ADDRESS,
        sampleSize: 3,
      },
      checks: {
        sourceFreshness: [
          { name: "goldsky-usdt-freshness", stream: "Transfer", maxLagBlocks: 30, maxAgeSeconds: 300 },
        ],
        provenance: [
          { name: "goldsky-usdt-provenance", stream: "Transfer", minSamples: 3 },
        ],
      },
    };
  }
  if (preset !== "polymarket-pilot") throw new Error(`Unsupported preset '${preset}'`);
  return {
    name: "polymarket-production-pilot",
    canonical: {
      type: "json-rpc",
      url: DEFAULT_POLYGON_RPC_URLS[0],
      fallbackUrls: DEFAULT_POLYGON_RPC_URLS.slice(1),
      rpcQuorum: { minAgreement: 2, maxHeadSkewBlocks: 8, agreementLagBlocks: 5 },
      headTag: "latest",
    },
    indexed: {
      type: "polymarket-data-api",
      dataUrls: DEFAULT_POLYMARKET_DATA_URLS,
      rpcUrls: DEFAULT_POLYGON_RPC_URLS,
      rpcQuorum: { minAgreement: 2, maxHeadSkewBlocks: 8, agreementLagBlocks: 5 },
      sampleSize: 3,
      maxAnchorLagBlocks: 2_000,
      freshnessScanMaxBlocks: 5_000,
      cacheTtlMs: 5_000,
    },
    watch: {
      confirmConsecutiveFailures: {
        TRANSACTION_COMPLETENESS: 3,
        SOURCE_FRESHNESS: 3,
      },
    },
    checks: {
      sourceFreshness: [
        { name: "orderfilled-freshness", stream: "OrderFilled", maxAgeSeconds: 300, maxLagBlocks: 120, activityGraceBlocks: 20 },
      ],
      transactionCompleteness: [
        { name: "orderfilled-transaction-completeness", stream: "OrderFilled", windowBlocks: 20, indexedPageSize: 500, maxPages: 4, settlementLagBlocks: 5 },
      ],
      provenance: [
        { name: "orderfilled-provenance", stream: "OrderFilled", minSamples: 3 },
      ],
    },
  };
}

async function exists(path: string): Promise<boolean> {
  try { await readFile(path, "utf8"); return true; } catch { return false; }
}

export async function writePresetConfig(path: string, preset: InitPreset, force = false): Promise<IndexerCheckConfig> {
  if (!force && await exists(path)) throw new Error(`Refusing to overwrite existing file '${path}'. Use --force to replace it.`);
  const config = buildPresetConfig(preset);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return config;
}
