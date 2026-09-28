# IndexerCheck v0.2.0-rc.2 — Release Notes

Date: 2026-09-28

## Scope

`v0.2.0-rc.2` freezes the M2 **Bring Your Own Indexer** feature set. The release candidate packages the generic verification kernel, indexed-side Adapter SDK, M1 production-pilot integrations, machine output/watch lifecycle, and npm distribution checks into one release baseline.

No new proof primitive is introduced by the RC itself; this candidate consolidates and hardens M2.0 through M2.3.

## RC.2 readiness hardening

- Canonical event proof outages/quorum failures now produce `UNKNOWN` rather than false provenance `DRIFT`.
- Generic reverse completeness converts unavailable canonical head/range evidence to `UNKNOWN` rather than process failure.
- Generic indexed state read failures produce `UNKNOWN` consistently.
- Generic EVM-log provenance now validates that canonical truth comes from the built-in JSON-RPC source.
- Consumer Quick Start now uses installed-package `npx indexercheck ...` commands instead of repository-only npm scripts.
- Package metadata now exposes explicit TypeScript declarations for `indexercheck` and `indexercheck/sdk` and adds discovery keywords.


## Generic verification surface

### Event provenance

Indexed REST/GraphQL/adapter events are verified against quorum-backed canonical EVM logs using block number, transaction hash, and log index. Static ABI event fields may also be compared.

### Reverse completeness

Canonical settled EVM logs are checked for corresponding indexed rows. Missing-event verdicts require explicit indexed range-coverage proof; otherwise the result is `UNKNOWN`.

### Historical state parity

Indexed state is compared with quorum-backed historical `eth_call` at the exact indexed block. Missing archive quorum becomes `UNKNOWN`, not `DRIFT`.

### Adapter / Data Contract SDK

`indexercheck/sdk` exposes `defineIndexerAdapter` and normalized head/state/event/range contracts. Custom adapters are indexed-side only and cannot redefine canonical truth.

JavaScript `.mjs`/`.js` adapters are the recommended stable deployment path. Direct local `.ts` loading depends on Node's experimental `module.stripTypeScriptTypes` support and should be compiled to JavaScript for stable production usage.

## Release gate

`npm run check:rc` now validates:

1. build;
2. the full M0/M1 deterministic regression/milestone baseline;
3. M2.0 generic provenance;
4. M2.1 generic reverse completeness;
5. M2.2 generic historical state proof;
6. M2.3 Adapter SDK/trust boundary;
7. RC packaging metadata/files; and
8. clean npm tarball install + CLI + external SDK consumer smoke.

The M2 feature-freeze deterministic baseline is **124 tests**.

## Existing production pilots

The M1 integrations remain available and unchanged in purpose:

- Polymarket Data API / Polygon canonical verification.
- Goldsky Euler subgraph / Ethereum historical state verification.

## Distribution status

The package remains `private: true`. `v0.2.0-rc.2` is therefore a validated RC artifact rather than an npm registry publication. Registry naming/publication should be a separate deliberate release step.

## Deferred beyond v0.2 RC

- Dynamic ABI values/tuples/arrays and multi-return generic calls.
- A first-class plugin registry or remote adapter execution.
- Generic authoritative freshness watermarks for every possible indexer.
- Broader non-EVM canonical sources.
