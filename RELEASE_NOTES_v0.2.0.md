# IndexerCheck v0.2.0

IndexerCheck v0.2.0 is the first public-release baseline for **Bring Your Own Indexer** verification.

## What it proves

- **PROVENANCE** — sampled indexed events are checked against quorum-backed canonical EVM logs.
- **EVENT_COMPLETENESS** — settled canonical event windows are checked for missing indexed rows when indexed range coverage is explicitly proven.
- **STATE_PARITY** — indexed state is checked against quorum-backed historical `eth_call` at the same indexed block.
- **Adapter SDK** — proprietary indexed APIs can normalize into IndexerCheck's event/state contracts without redefining canonical truth.

## Safety semantics

- Canonical truth that cannot be proven becomes **UNKNOWN**, not false `DRIFT`/`INCOMPLETE`.
- Reverse completeness requires an explicit range-coverage contract; unproven coverage becomes **UNKNOWN**.
- Historical state requires enough archive-capable RPC agreement; insufficient quorum becomes **UNKNOWN**.
- Custom adapters are indexed-side only. Canonical truth remains in built-in quorum-backed sources.

## Distribution

- CLI: `indexercheck`
- SDK: `indexercheck/sdk`
- Node.js: 20+
- Runtime npm dependencies: none
- License: MIT
- Repository build dependency: TypeScript 5.8.3

Before the first registry publish, run `npm run check:first-publish` to execute the full release gate and verify the npm name is still unregistered.
