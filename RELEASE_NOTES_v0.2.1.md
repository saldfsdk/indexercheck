# IndexerCheck v0.2.1

IndexerCheck v0.2.1 is an external-onboarding and diagnostics release based on the first real post-release third-party pilot.

No new proof primitive is introduced in this release.

## External validation

The first external onboarding pilot used Envio HyperIndex on Robinhood Chain mainnet.

The pilot demonstrated:

```text
valid indexed events
  -> PROVENANCE PASS

one deliberately corrupted event value
  -> DRIFT

complete active canonical event range
  -> EVENT_COMPLETENESS PASS (9/9)

one deliberately omitted indexed event
  -> INCOMPLETE (1/9 missing)
```

## Added

- Envio HyperIndex onboarding example.
- External Envio / Robinhood Chain pilot report.
- Guidance for proof-ready Envio raw event identity.
- Guidance for safe GraphQL historical range queries.

## Fixed

- Generic GraphQL reverse-completeness documentation now actually uses the configured historical range variables.
- `historicalRangeComplete: true` is documented explicitly as a full-range coverage contract.
- Canonical RPC quorum failures during reverse completeness preserve structured provider evidence.
- Human CLI output now identifies failed RPC providers and their errors.
- `SourceUnavailableError` retains its underlying cause so quorum evidence is not lost.

## Safety semantics retained

- Unavailable canonical proof remains `UNKNOWN`.
- RPC quorum thresholds are never silently reduced.
- Missing indexed events become `INCOMPLETE` only when indexed range coverage is explicitly proven.
- Provenance mismatch remains `DRIFT`.
- Custom adapters remain indexed-side only.
- Canonical truth remains quorum-backed.

## Regression baseline

- 130 deterministic tests.
- Added regression coverage for historical `eth_getLogs` quorum failure diagnostics.
- Added regression coverage for wrapped canonical-head quorum failure diagnostics.
- Real Envio/Robinhood validation confirmed both human CLI and machine JSON diagnostics.

## Distribution

- CLI: `indexercheck`
- SDK: `indexercheck/sdk`
- Node.js: 20+
- Runtime npm dependencies: none
- License: MIT
