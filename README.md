# IndexerCheck

**Continuously prove that indexed/off-chain blockchain data still matches canonical chain evidence.**

`v0.2.0` is the first public-release baseline for **Bring Your Own Indexer**: point IndexerCheck at your REST API, GraphQL endpoint, or indexed-side adapter, then verify the result independently against quorum-backed EVM evidence.

The v0.2 proof surface is intentionally small and composable:

```text
indexed event  ──→ canonical EVM log      PROVENANCE
canonical log  ──→ indexed event          EVENT_COMPLETENESS
indexed state  ──→ historical eth_call    STATE_PARITY
```

Custom adapters may normalize proprietary indexed data, but they **cannot redefine canonical truth**. Canonical event/state evidence remains inside built-in quorum-backed sources.

## Quick start

### Requirements

- Node.js 20+
- Network access for live verification
- No runtime npm dependencies

### Install

After the first npm registry publication:

```powershell
npm install --save-dev indexercheck
```

Before the first registry publication, the release artifact can be tested directly:

```powershell
npm install --save-dev ./indexercheck-0.2.0.tgz
```

### Create a generic config

```powershell
npx indexercheck init --preset generic-evm-log --output indexercheck.json
```

Replace the placeholder RPCs, contract/topic, indexed API mappings, and state/event paths in `indexercheck.json`, then run:

```powershell
npx indexercheck verify --config indexercheck.json
npx indexercheck verify --config indexercheck.json --json
npx indexercheck watch --config indexercheck.json --interval 60s
```

The checked-in config-only template is `examples/generic-evm-log.example.json`. Repository maintainers can run the full release gate with `npm run check:release`; first-time publishers should use `npm run check:first-publish`. Consumers do not need repository-only milestone scripts.

## What v0.2 proves

### 1. Event provenance — indexed → canonical

For every sampled indexed event, IndexerCheck uses `blockNumber + transactionHash + logIndex` to resolve the corresponding quorum-backed canonical EVM log. Optional static ABI field mappings can also prove decoded event values.

```text
indexed row
    ↓
exact block + tx + log identity
    ↓
quorum-backed eth_getLogs
    ↓
PROVENANCE PASS / FAIL / UNKNOWN
```

### 2. Reverse completeness — canonical → indexed

IndexerCheck scans a settled canonical event window and compares `(transactionHash, logIndex)` identities against the indexed source. A missing canonical event becomes `INCOMPLETE` only when indexed range coverage is explicitly proven. Otherwise the result is `UNKNOWN`, avoiding false missing-event claims.

### 3. Historical state parity

Indexed state is compared with quorum-backed `eth_call` at the **same indexed block**, not accidental `latest`. If archive-capable quorum is unavailable, the result is `UNKNOWN`, never a false `DRIFT`.

## Config-only or Adapter SDK?

Use **config-only** when the source already exposes clean REST/GraphQL rows and historical ranges. This is the preferred path: less code, smaller trust surface, easier review.

Use the **Adapter SDK** when the indexed side needs custom pagination, multiple API calls, proprietary IDs, normalization, or aggregation before it can be expressed as IndexerCheck events/state.

```js
import { defineIndexerAdapter } from "indexercheck/sdk";

export default defineIndexerAdapter({
  name: "my-indexer",
  async create({ options }) {
    return {
      async getHead() {
        return { blockNumber: 123 };
      },
      async getEvents(stream) {
        return [{
          blockNumber: 120,
          transactionHash: "0x...",
          logIndex: 0,
          payload: { amount: "7" }
        }];
      },
      async getEventsAt(stream, { fromBlock, toBlock }) {
        return { events: [], coverageProven: true, metadata: { fromBlock, toBlock } };
      },
      async getState(key) {
        return { value: "7", blockNumber: 120, payload: { account: "0x..." } };
      }
    };
  }
});
```

JavaScript `.mjs`/`.js` adapters are the recommended production path. Direct local `.ts` loading is supported only when the running Node runtime exposes `module.stripTypeScriptTypes`; that API is still experimental, so compile TypeScript adapters to JavaScript for stable deployments.

Adapters are executable local code and run with the same OS permissions as IndexerCheck. Only load adapter files you trust. Adapters are indexed-side only; `canonical.type = "adapter"` is rejected.

Checked-in adapter examples:

- `examples/generic-adapter.example.json`
- `examples/adapters/custom-indexer.mjs`
- `examples/adapters/custom-indexer.ts`

## Generic REST example

The generated generic preset uses an HTTP JSON source shaped roughly like this:

```json
{
  "indexed": {
    "type": "http-json",
    "url": "https://indexer.example/api/transfers?limit=3",
    "events": {
      "Transfer": {
        "arrayPath": "rows",
        "blockPath": "blockNumber",
        "txHashPath": "transactionHash",
        "logIndexPath": "logIndex",
        "historicalRequest": {
          "url": "https://indexer.example/api/transfers?fromBlock={{fromBlock}}&toBlock={{toBlock}}"
        },
        "historicalRangeComplete": true
      }
    }
  }
}
```

`arrayPath` selects the returned row array. `blockPath`, `txHashPath`, and `logIndexPath` establish the canonical event identity. Paths are dot-separated.

M2.2 also allows REST state mappings:

```json
{
  "state": {
    "Balance": {
      "url": "https://indexer.example/api/balance?account=0x2222...",
      "valuePath": "row.balance",
      "blockPath": "row.blockNumber"
    }
  }
}
```

The entire JSON response is retained as row context, so EVM-call arguments can reference paths such as `row.account`. `blockPath` is required for generic historical state proof.

For M2.1, `historicalRequest` is the block-range request used by reverse completeness. `{{fromBlock}}` and `{{toBlock}}` are substituted recursively in request URL/body strings. `historicalRangeComplete: true` is an explicit contract that the request returns the full event set for that requested range; do not set it for a truncated or paginated response.

An optional `head` mapping may be supplied. If omitted, the REST/GraphQL generic sources derive a **diagnostic indexed head** from the highest sampled event row; this is not an authoritative freshness watermark.

## Generic GraphQL example

GraphQL uses the existing generic event mapping, now without requiring a separate head query for provenance-only configurations:

```json
{
  "indexed": {
    "type": "graphql",
    "url": "https://indexer.example/graphql",
    "events": {
      "Transfer": {
        "query": "query { transfers(first: 3) { transactionHash logIndex blockNumber from to value } }",
        "arrayPath": "transfers",
        "blockPath": "blockNumber",
        "txHashPath": "transactionHash",
        "logIndexPath": "logIndex",
        "historicalFromBlockVariable": "fromBlock",
        "historicalToBlockVariable": "toBlock",
        "historicalRangeComplete": true
      }
    }
  }
}
```

The generic proof kernel does not care whether the row came from REST or GraphQL after it has been mapped into an event record.

## Canonical EVM-log proof

The canonical JSON-RPC source defines the event filter:

```json
{
  "canonical": {
    "type": "json-rpc",
    "url": "https://rpc-1.example",
    "fallbackUrls": [
      "https://rpc-2.example",
      "https://rpc-3.example"
    ],
    "rpcQuorum": {
      "minAgreement": 2,
      "maxHeadSkewBlocks": 8,
      "agreementLagBlocks": 2
    },
    "headTag": "latest",
    "events": {
      "Transfer": {
        "address": "0x1111111111111111111111111111111111111111",
        "topics": [
          "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
        ],
        "fromBlock": "latest",
        "toBlock": "latest",
        "eventName": "Transfer"
      }
    }
  }
}
```

For provenance, IndexerCheck performs historical `eth_getLogs` reads at the exact indexed block and requires the configured RPC agreement. Provider-level quorum evidence is retained in the per-row proof metadata.


## Generic reverse completeness

M2.1 adds a config-driven `evm-log-reverse` mode to `EVENT_COMPLETENESS`:

```json
{
  "checks": {
    "eventCompleteness": [
      {
        "name": "transfer-completeness",
        "stream": "Transfer",
        "proof": {
          "type": "evm-log-reverse",
          "canonicalStream": "Transfer",
          "windowBlocks": 50,
          "settlementLagBlocks": 5
        }
      }
    ]
  }
}
```

The verifier resolves a quorum-safe canonical head, subtracts `settlementLagBlocks`, scans canonical `eth_getLogs` across the resulting settled window, asks the indexed REST/GraphQL source for the **same block range**, and compares `(transactionHash, logIndex)` identities.

```text
canonical head
    ↓ minus settlement lag
verified-through block
    ↓ bounded window
canonical eth_getLogs quorum
    ↓
indexed historical range request
    ↓
(txHash, logIndex) set comparison
    ↓
COMPLETE / INCOMPLETE / UNKNOWN
```

Safety is intentionally conservative:

- missing canonical keys produce `EVENT_COMPLETENESS FAIL` → report verdict `INCOMPLETE`;
- a frontier event inside the settlement lag is excluded from the verdict;
- missing historical range support or a missing completeness contract produces `UNKNOWN`, not a false missing-event alert;
- extra indexed rows are retained as diagnostics, while reverse completeness itself only asks whether every canonical event is present; provenance remains responsible for proving indexed rows are canonical.

## Decoded event-field checks

Identity-only proof is possible, but M2.0 can also compare decoded static event inputs:

```json
{
  "checks": {
    "provenance": [
      {
        "name": "transfer-provenance",
        "stream": "Transfer",
        "minSamples": 3,
        "proof": {
          "type": "evm-log",
          "canonicalStream": "Transfer",
          "sampleSize": 3,
          "inputs": [
            { "name": "from", "type": "address", "indexed": true, "indexedPath": "from" },
            { "name": "to", "type": "address", "indexed": true, "indexedPath": "to" },
            { "name": "value", "type": "uint256", "indexed": false, "indexedPath": "value" }
          ]
        }
      }
    ]
  }
}
```

M2.0 deliberately supports only **static ABI inputs**:

- `address`
- `bool`
- `uint8` … `uint256` in 8-bit increments
- `int8` … `int256` in 8-bit increments
- `bytes1` … `bytes32`

Dynamic `string`, `bytes`, arrays, tuples, and other dynamic layouts are rejected during config validation rather than heuristically decoded.

## Generic historical state proof

M2.2 adds an `evm-call` mode to `STATE_PARITY`. The indexed source supplies a value plus the block where that value was observed; IndexerCheck builds calldata from static ABI arguments and performs `eth_call` at **that exact block**.

```json
{
  "checks": {
    "stateParity": [
      {
        "name": "balance-parity",
        "key": "Balance",
        "proof": {
          "type": "evm-call",
          "to": "0x1111111111111111111111111111111111111111",
          "selector": "0x70a08231",
          "args": [
            { "type": "address", "indexedPath": "row.account" }
          ],
          "returnType": "uint256"
        }
      }
    ]
  }
}
```

The proof path is:

```text
indexed value + indexed block + row context
                  ↓
static ABI calldata encoding
                  ↓
eth_call at the indexed block
                  ↓
configured RPC quorum
                  ↓
single static return decode
                  ↓
MATCH / VALUE_MISMATCH / UNKNOWN
```

A canonical value mismatch is `STATE_PARITY FAIL` and therefore `DRIFT`. If historical state cannot be proven because archive-capable RPC agreement is unavailable, the result is `UNKNOWN` rather than false drift. REST and GraphQL state mappings both use the same proof kernel.

M2.2 supports static ABI call arguments and one static ABI return value: `address`, `bool`, `uintN`, `intN`, and `bytesN`. Dynamic values remain intentionally unsupported.

## Existing production pilots

M1's two production integrations remain intact and continue to run through the regression suite.

### Polymarket Data API / Polygon

Config: `examples/polymarket-pilot.json`

It verifies official-source freshness, bounded reverse transaction completeness, sampled provenance, finality-aware Polygon RPC quorum, continuous watch lifecycle semantics, and machine output.

```powershell
npm run pilot:verify
npm run pilot:verify:json
npm run pilot:watch:smoke
```

### Goldsky / Euler / Ethereum

Config: `examples/goldsky-euler-mainnet-pilot.json`

It verifies Goldsky `_meta` freshness plus historical `TrackingVaultBalance` state provenance using receipt/state evidence and archive-capable Ethereum quorum semantics.

```powershell
npm run goldsky:pilot:preflight
npm run goldsky:pilot:verify
npm run goldsky:pilot:verify:json
npm run goldsky:pilot:watch:smoke
```

## Primitives

IndexerCheck currently contains:

- **CANONICAL_HEAD**
- **SOURCE_FRESHNESS**
- **STATE_PARITY** — M2.2 adds config-driven generic historical `evm-call` proof
- **EVENT_COMPLETENESS** — M2.1 adds config-driven generic `evm-log-reverse` coverage
- **TRANSACTION_COMPLETENESS**
- **PROVENANCE** — M2.0 adds a config-driven generic `evm-log` proof mode
- **FIRST_DIVERGENCE**
- **ROOT_CAUSE_EVIDENCE**
- **INCIDENT_REPORT**

A check is only as strong as the identities and canonical evidence exposed by the configured surfaces.

## Continuous watch and machine output

Existing M1 watch, webhook, GitHub Actions, incident lifecycle, and v1 machine schemas are retained.

```powershell
node dist/cli.js watch `
  --config indexercheck.generic.json `
  --interval 60s `
  --state .indexercheck/watch-state.json
```

Machine JSON:

```powershell
node dist/cli.js verify --config indexercheck.generic.json --json
```

Schemas remain under `schemas/`.

## Package validation

The v0.2 release gate includes both full feature regression and distribution validation:

```powershell
npm run check:release
```

For packaging alone:

```powershell
npm run check:package
```

The package smoke gate creates a real npm tarball, verifies the whitelist, installs it into a fresh temporary project, exercises the installed CLI, imports `indexercheck/sdk`, and executes an external consumer adapter built against the installed package.

CLI metadata:

```powershell
npx indexercheck --help
npx indexercheck --version
npx indexercheck -v
```

Expected version:

```text
0.2.0
```

## Known limitations

- **Generic completeness requires a real range-coverage contract.** If the indexed REST/GraphQL query may paginate, truncate, or omit rows, do not claim complete coverage; IndexerCheck returns `UNKNOWN` instead of a false `INCOMPLETE`.
- **Static ABI only.** Generic event decoding and state calls support static `address`, `bool`, `uintN`, `intN`, and `bytesN` values. Dynamic strings/bytes, arrays, tuples, and multi-return layouts are intentionally deferred.
- **Generic state proof requires block alignment.** Indexed state must expose the block where the value was observed.
- **Historical state depends on archive-capable RPC evidence.** If enough providers cannot serve the historical block, parity becomes `UNKNOWN`, not `DRIFT`.
- **Strong event identity is required.** `blockNumber`, `transactionHash`, and `logIndex` are required for deterministic generic event proof.
- **A derived indexed head is diagnostic only.** The highest sampled row is not an authoritative freshness watermark.
- **Canonical filters are part of the proof contract.** Wrong contract/topic configuration defines the wrong canonical domain.
- **Public RPCs remain operational dependencies.** Losing quorum makes canonical truth unprovable rather than silently lowering the threshold.
- **M1 source-specific integrations remain available.** Polymarket/Euler adapters retain stronger source-specific semantics where useful.
- **Adapters cannot be canonical sources.** Custom code is deliberately indexed-only.
- **TypeScript adapter execution is runtime-dependent and experimental.** Prefer compiled `.mjs`/`.js` for production.

## First publication checklist

The `0.2.0` artifact is public-package metadata ready. Before the first registry publish:

```powershell
npm install
npm run check:first-publish
```

`check:first-publish` runs the full release gate, a real `npm publish --dry-run`, and a live registry lookup for the unscoped name `indexercheck`. A 404 from the registry is treated as available; an existing package is a hard failure.

The canonical GitHub repository metadata points to `saldfsdk/indexercheck`. The connected GitHub account does not currently contain that repository, and this environment cannot create repositories, so the first-publish gate also checks that the repository exists and is public before publication. See `REPOSITORY_SETUP.md` for the exact setup commands.

The project is licensed under MIT. See `LICENSE`.

## Release status

```text
M1               production-pilot kernel + two live integrations       COMPLETE / FROZEN
M2.0             generic indexed row → canonical EVM log provenance    COMPLETE
M2.1             generic reverse event completeness                    COMPLETE
M2.2             generic historical state proof                         COMPLETE
M2.3             adapter/data-contract SDK                              COMPLETE
v0.2.0           Bring Your Own Indexer public-release baseline              CURRENT
```

Detailed M1 engineering history remains in `docs/M1-DEVELOPMENT-NOTES.md`. M2 development history is summarized in `docs/M2-DEVELOPMENT-NOTES.md`.
