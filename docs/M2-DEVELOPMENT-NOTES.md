# M2 Development Notes

M2 turns the M1 production-pilot kernel into Bring Your Own Indexer.

## M2.0 — Generic Event Provenance

- REST JSON + GraphQL indexed rows.
- Config-driven block/tx/log identity mapping.
- Quorum-backed canonical EVM log proof.
- Static ABI event-field comparison.

## M2.1 — Generic Reverse Completeness

- Canonical event window → indexed range coverage.
- Settlement-lag watermark.
- `(transactionHash, logIndex)` identity.
- Unproven indexed range coverage → `UNKNOWN`.

## M2.2 — Generic State Proof

- Indexed state → historical quorum-backed `eth_call`.
- Static ABI calldata and single-value return decoding.
- Archive quorum unavailable → `UNKNOWN`.

## M2.3 — Adapter / Data Contract SDK

- `indexercheck/sdk` / `defineIndexerAdapter`.
- JavaScript local adapters, optional runtime-dependent TypeScript loading.
- Custom indexed normalization feeds existing provenance/completeness/state kernels.
- Canonical sources remain built-in/quorum-backed.

## v0.2.0-rc.1

M2 feature freeze and release hardening: productized README, full M2 RC gate, current release notes, and clean-installed external SDK consumer smoke.
