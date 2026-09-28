# Changelog

## 0.2.1 — 2026-09-28

### External onboarding and diagnostics

- Added an Envio HyperIndex onboarding example derived from a real Robinhood Chain external pilot.
- Documented proof-ready Envio raw-event identity requirements, including `raw_events` and transaction hash field selection.
- Fixed the generic GraphQL reverse-completeness example so historical range variables are actually consumed by the query.
- Clarified that `historicalRangeComplete: true` is an explicit full-range coverage contract and must not be used with unresolved truncation/pagination.
- Preserved structured RPC quorum evidence when canonical reverse-completeness proof becomes `UNKNOWN`.
- Added human CLI diagnostics for failed RPC providers and provider errors.
- Preserved nested quorum evidence through `SourceUnavailableError`.
- Added two deterministic quorum-diagnostic regression tests, bringing the suite to 130 tests.
- Added External Pilot #1 documentation covering positive provenance/completeness controls and deliberate `DRIFT`/`INCOMPLETE` negative controls.
- No new proof primitive and no weakening of canonical-truth or fail-closed safety semantics.

## 0.2.0 — 2026-09-28

### Public release baseline

- Promoted the M2 Bring Your Own Indexer surface to the first public-release baseline.
- Finalized generic event provenance, reverse completeness, historical state parity, and the indexed-only Adapter SDK.
- Preserved safety semantics: unavailable canonical proof becomes `UNKNOWN`, never false `DRIFT`/`INCOMPLETE`.
- Added MIT licensing and public npm metadata (`publishConfig.access=public`).
- Added a first-publish npm-name gate and `npm publish --dry-run` release gate.
- Added `prepack` build protection so publish artifacts cannot silently ship stale `dist/`.
- Pinned TypeScript 5.8.3 as a repository-only dev dependency while keeping runtime npm dependencies at zero.
- Added GitHub-ready CI, security, and contributing files.

## 0.2.0-rc.2 — 2026-09-28

M2 feature-freeze release candidate: Bring Your Own Indexer.

### Product surface

- Generic REST/GraphQL indexed sources for EVM event provenance.
- Generic reverse event completeness with settlement-watermark and coverage-proof safety.
- Generic historical state parity through quorum-backed `eth_call`.
- Indexed-side Adapter / Data Contract SDK exposed as `indexercheck/sdk`.
- Existing Polymarket/Polygon and Goldsky/Euler/Ethereum production-pilot paths retained from M1.

### Release hardening

- Unified package/tool version as `0.2.0-rc.2`.
- `check:rc` now covers M0/M1 regressions plus M2.0, M2.1, M2.2, and M2.3 milestones before package validation.
- README reorganized around generic-indexer onboarding and config-vs-adapter choice.
- Package smoke validates a clean tarball install, CLI metadata, SDK import, and an external consumer adapter.
- `.mjs`/`.js` adapters are documented as the stable path; direct `.ts` loading remains runtime-dependent/experimental.

### Safety boundaries retained

- Canonical truth remains quorum-backed and cannot be replaced by a custom adapter.
- Unproven indexed range coverage becomes `UNKNOWN`, not false `INCOMPLETE`.
- Unavailable archive/history quorum becomes `UNKNOWN`, not false `DRIFT`.
- Static ABI-only generic decoding/calls remain explicit.

### Regression baseline

- 124 deterministic tests at M2 feature freeze.
- Full M0/M1/M2 milestone chain plus npm distribution smoke.

## 0.2.3-m2.3-adapter-sdk — 2026-09-28

Fourth M2 Bring Your Own Indexer milestone.

### Added

- Public `indexercheck/sdk` export with `defineIndexerAdapter` and normalized head/state/event/range contracts.
- `indexed.type=adapter` with config-relative local JavaScript module loading.
- Optional local TypeScript adapter loading through `module.stripTypeScriptTypes` when supported by the running Node version.
- Adapter normalization into the existing M2.0 provenance, M2.1 reverse completeness, and M2.2 historical state proof kernels.
- Checked-in JavaScript/TypeScript sample adapters plus `generic-adapter.example.json`.
- Package smoke now verifies the installed SDK export as well as the CLI.

### Safety boundaries

- Custom adapters are indexed-only and cannot replace the canonical source.
- Adapter runtime failures during proof inputs become `UNKNOWN`, never false `DRIFT`/`INCOMPLETE`.
- Range completeness still requires an explicit `coverageProven: true` contract from the adapter.
- Adapter module-load/create failures remain startup errors because the configured source could not be initialized.

### Regression

- 124 deterministic tests across M0/M1/M2 paths.
- M2.3 covers JavaScript loading, TypeScript loading, proof-kernel reuse, runtime-failure UNKNOWN semantics, and the canonical trust boundary.

## 0.2.2-m2.2-generic-state-proof — 2026-09-28

Third M2 Bring Your Own Indexer milestone.

### Added

- Generic `evm-call` mode for `STATE_PARITY`.
- REST JSON state mappings with `valuePath` + `blockPath` and preserved row context for call arguments.
- GraphQL state mappings now preserve response context for generic call argument paths.
- Static ABI calldata encoding for `address`, `bool`, `uintN`, `intN`, and `bytesN`.
- Quorum-backed historical `eth_call` at the exact indexed state block.
- Static single-value return decoding and normalized indexed/canonical comparisons.
- Generic preset now demonstrates state parity beside event provenance and reverse completeness.

### Safety boundaries

- Indexed state without a valid block number returns `UNKNOWN`.
- Historical/archive RPC quorum failure returns `UNKNOWN`, never false `DRIFT`.
- Dynamic ABI arguments/returns are rejected during config validation.
- Generic state proof currently supports one static return value; dynamic and tuple/multi-return layouts are deferred.

### Regression

- 120 deterministic tests across M0/M1/M2 paths.
- M2.2 covers GraphQL PASS, REST value mismatch/DRIFT, insufficient archive quorum UNKNOWN, and config validation.

## 0.2.1-m2.1-generic-reverse-completeness — 2026-09-28

Second M2 Bring Your Own Indexer milestone.

### Added

- Generic `evm-log-reverse` mode for `EVENT_COMPLETENESS`.
- Settled completeness windows derived from canonical head minus `settlementLagBlocks`.
- Canonical `eth_getLogs` quorum evidence for the whole verified window.
- Generic `(transactionHash, logIndex)` reverse coverage matching that preserves multiple logs in one transaction.
- GraphQL historical range variables with an explicit `historicalRangeComplete` contract.
- REST historical requests with recursive `{{fromBlock}}` / `{{toBlock}}` substitution in URL/body strings.
- Missing-event block/depth diagnostics and `verifiedThroughBlock` evidence.

### Safety boundaries

- Unproven indexed range coverage returns `UNKNOWN`, never a false `INCOMPLETE`.
- Events inside the settlement frontier are excluded from completeness verdicts.
- Strong event identity is required; missing transaction hash or log index returns `UNKNOWN`.
- Extra indexed rows are diagnostic only for reverse completeness; M2.0 provenance remains the canonicality check for indexed rows.

### Regression

- 116 deterministic tests across M0/M1/M2 paths.
- M2.1 covers GraphQL PASS, REST missing-event detection, unproven-range UNKNOWN, and settlement-frontier isolation.

## 0.2.0-m2.0-generic-event-provenance — 2026-09-28

First M2 Bring Your Own Indexer milestone.

### Added

- Generic `evm-log` provenance proof in the core primitive path instead of provider-specific source code.
- REST JSON (`http-json`) indexed source with dot-path row mapping.
- GraphQL provenance-only configs can derive a diagnostic head from mapped event rows when no explicit head query is configured.
- Config-driven event identity using `blockNumber + transactionHash + logIndex`.
- Optional static ABI event input comparison for `address`, `bool`, `uintN`, `intN`, and `bytesN`.
- Canonical per-row RPC quorum evidence for generic EVM log reads.
- `generic-evm-log` init preset and checked-in example.

### Safety boundaries

- Dynamic ABI values are rejected rather than heuristically decoded.
- Generic provenance fails when canonical historical event reads or strong indexed event identity are unavailable.
- M2.0 does not claim generic reverse completeness or authoritative generic freshness.

### Regression

- M1 production adapters and milestones remain in the regression chain.
- M2.0 adds REST, GraphQL, decoded-field mismatch, quorum-degradation, and config-validation coverage.

## 0.1.0-rc.2 — 2026-09-28

Release-packaging hardening for the M1 feature-freeze baseline.

### Changed

- Added successful CLI `--help` / `-h` handling.
- Added `--version` / `-v`, reporting `0.1.0-rc.2`.
- Added an npm `files` whitelist so published tarballs exclude source tests, compiled tests, milestone scripts, and internal development notes.
- Added `npm run check:package`, which packs, inspects, installs into a fresh temporary project, and exercises the installed CLI through `npx`.
- Integrated the package smoke gate into `npm run check:rc`.

### Verification semantics

- No M1 verification semantics changed from rc.1.
- The deterministic M1 baseline remains 108 tests plus the complete M0.1–M1.5.2 milestone suite.

## 0.1.0-rc.1 — 2026-09-27

First release candidate for the completed M1 production-pilot core.

### Added / stabilized

- Canonical-chain verification primitives for head, freshness, state parity, event/transaction completeness, and provenance.
- First-divergence search, guarded root-cause evidence, and incident reports.
- Stable machine JSON plus v1 report/watch/webhook schemas.
- Live webhook retry/HMAC delivery and GitHub Actions integration.
- Continuous watch with persistent lifecycle state, deduplication, recovery, pending replay, confirmation candidates, lag trends, quorum health, and soak summaries.
- Multi-provider canonical truth quorum with finality-aware settled head agreement.
- Polymarket Data API v2 / Polygon production pilot:
  - official `/v2/status` freshness authority;
  - cursor-based reverse transaction completeness;
  - sampled canonical provenance;
  - 2-of-3 Polygon RPC quorum;
  - watch confirmation and production soak behavior.
- Goldsky / Euler / Ethereum production pilot:
  - Goldsky `_meta` freshness;
  - `TrackingVaultBalance` receipt + historical `balanceOf`/`debtOf` provenance;
  - Euler `try_debtOf()` revert semantics;
  - archive-state 2-of-3 Ethereum RPC quorum;
  - endpoint/schema/archive preflight.

### RC packaging

- Version normalized to SemVer `0.1.0-rc.1` across package and machine artifacts.
- README rewritten for first-time users.
- Detailed M1 engineering notes retained under `docs/M1-DEVELOPMENT-NOTES.md`.
- Added release notes and `npm run check:rc` validation.
- Added `npm run goldsky:pilot:watch:soak` convenience command.

### Validation baseline

- 108 deterministic tests passing at the M1.5.2 feature-freeze point.
- Polymarket live soak: 12 successful ticks, 0 runtime errors.
- Goldsky/Euler live soak: 8 successful ticks, 0 runtime errors; canonical quorum remained valid while Merkle returned HTTP 429.
