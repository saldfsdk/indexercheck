# IndexerCheck M1.4.5 — Freshness Telemetry Alignment

M1.4.5 aligns continuous-watch telemetry with the same freshness authority used by verification. For Data API v2, `lag`, lag trend, and soak `maxLag` now come from authoritative `SOURCE_FRESHNESS.evidence.lagBlocks` (`polymarket-v2-status`). Raw canonical-vs-indexed head distance is retained separately as `headLag` / `maxHeadLag` for diagnostics.

# IndexerCheck M1.4.4 — Official Serving Watermark Freshness

M1.4.4 fixes a production-semantic issue exposed by the long Polymarket soak: the newest sampled trade is not a reliable watermark for the whole Data API. A quiet or uneven trade sample can look many blocks old even while the managed serving pipeline is healthy.

For Polymarket Data API v2, `SOURCE_FRESHNESS` now uses the official `/v2/status` serving + ingestion watermark as its primary freshness authority:

- `serving.lag_seconds` and the status snapshot age drive time freshness;
- `ingestion.min_synced_block` (falling back to max when needed) is compared with the canonical quorum-safe chain head;
- the newest sampled trade block/timestamp is retained only as diagnostic evidence;
- if `/v2/status` is unavailable, freshness becomes `UNKNOWN` rather than producing a false `STALLED`;
- legacy/non-v2 sources retain the M1.1 activity-aware sampled-anchor behavior;
- machine JSON now reports the correct `1.4.4-m1.4.4-official-serving-watermark` tool version.

Transaction completeness and provenance semantics are unchanged. This milestone deliberately fixes freshness authority without hiding real missing transactions.

Validate:

```powershell
npm run check:m1.4.4
npm run pilot:status
npm run pilot:verify:json
npm run pilot:watch:soak
```

In JSON output, a healthy v2 freshness check should expose `freshnessBasis=polymarket-v2-status`, while `metadata.sampledTradeAnchor` shows the old heuristic only for comparison/debugging.

---

# IndexerCheck M1.4.3 — Official Status + Missing-Age Diagnostics

M1.4.3 is a diagnostic hardening milestone. It does **not** relax verification thresholds.

- `npm run pilot:status` prints Polymarket Data API v2 `/status` so serving watermark / lag / stream cursor semantics can be compared with IndexerCheck's independent chain evidence.
- Transaction completeness evidence now includes the canonical block for each missing transaction plus oldest/newest missing depth relative to the verified-through block.
- `npm run pilot:verify:json` exposes the enriched evidence directly.

---

# IndexerCheck M1.2.2 — Production Feed Isolation

M1.2.2 closes the remaining source-generation mixing path in the Polymarket production pilot. The generated preset was already v2-only in M1.2.1, but the checked-in `examples/polymarket-pilot.json` still contained a legacy `/trades` fallback. That meant provenance/freshness could theoretically fail over to v1 while completeness stayed on v2.

M1.2.2 makes the production semantics explicit and regression-tested:

- checked-in production example is exactly identical to the generated `polymarket-pilot` preset;
- production Data API feed is v2-only;
- `taker_only=true` is explicit for both the normal probe and cursor completeness;
- configs that enable Polymarket `TRANSACTION_COMPLETENESS` reject mixed v1/v2 `dataUrls`;
- a v2 outage therefore surfaces as a source error/unknown monitoring tick instead of silently changing API generation.

Validate:

```powershell
npm run check:m1.2.2
```

Then run the real pilot:

```powershell
npm run pilot:verify
npm run pilot:watch:smoke
```

---

# M1.2.1 reference — Data API v2 Cursor Completeness

M1.2.1 is a corrective production-hardening release for the Polymarket pilot.

The M1.2 live pilot exposed a useful failure: `PROVENANCE` passed 3/3 while `TRANSACTION_COMPLETENESS` reported every canonical transaction missing. The deterministic engine was working as written, but the live adapter was mixing API generations: it sent legacy `offset` pagination to Data API v2, then silently fell back to the legacy `/trades` route. That made the reverse-coverage comparison semantically invalid.

M1.2.1 fixes the adapter rather than weakening the check:

- Data API v2 completeness uses opaque `pagination.next_cursor` / `cursor`;
- no `offset` is sent to v2;
- `taker_only=true` is kept stable across every page;
- production preset uses v2 only;
- completeness never silently falls back to legacy v1 semantics;
- if only a legacy feed is configured, completeness returns `UNKNOWN` instead of a false `INCOMPLETE`.

The rest of M1.2 remains intact: canonical `OrderFilled` transactions are deduplicated by transaction hash, indexed coverage must be proven before missing transactions are reported, and `PROVENANCE` remains the forward-direction check.

## Validate

```powershell
npm run check:m1.2.1
```

Then run the live pilot:

```powershell
npm run pilot:verify
```

A healthy live result should contain all three checks:

```text
PASS    SOURCE_FRESHNESS
PASS    TRANSACTION_COMPLETENESS ... classification=COMPLETE missing=0
PASS    PROVENANCE
```

If cursor depth is insufficient to prove the requested window, the completeness check returns `UNKNOWN / UNPROVEN_COVERAGE`; it does not guess.

---

# M1.2 reference — Production Completeness

IndexerCheck verifies that indexed/off-chain blockchain data still matches canonical chain evidence, detects freshness failures, locates first divergence, assembles incident evidence, and can continuously monitor + deliver lifecycle events.

M1.2 adds the missing reverse-direction production check:

```text
M1.0 PROVENANCE
indexed row -> canonical chain evidence
"Is every sampled indexed row real?"

M1.2 TRANSACTION_COMPLETENESS
canonical OrderFilled transaction -> indexed Data API transaction hash
"Did the indexed source omit any canonical transaction in this proven window?"
```

The production pilot now runs three independent questions:

```text
SOURCE_FRESHNESS
  Is the indexed source keeping up with relevant canonical activity?

TRANSACTION_COMPLETENESS
  In a bounded, proven block window, is every canonical OrderFilled transaction represented by the indexed API?

PROVENANCE
  Do sampled indexed trades actually have canonical OrderFilled evidence?
```

## Why transaction completeness, not event completeness?

Polymarket Data API trade rows expose transaction hashes but not canonical EVM `logIndex` values. One transaction may emit multiple `OrderFilled` logs.

M1.2 therefore deliberately verifies **transaction coverage**, not one-row-per-log identity:

```text
canonical logs:
  tx A / log 0
  tx A / log 1
  tx B / log 0

canonical transactions:
  A
  B

TRANSACTION_COMPLETENESS count = 2
```

This avoids claiming stronger event-level semantics than the indexed API can actually prove.

## Coverage guard

A missing transaction is reported only after IndexerCheck proves that the Data API retrieval spans the requested block window.

For a configured window:

```text
latest verified indexed block = N
windowBlocks = 20

verified window = N-19 ... N
```

IndexerCheck:

1. scans canonical Polygon `OrderFilled` logs in that window;
2. builds a unique canonical transaction-hash set;
3. pages Polymarket Data API v2 using opaque cursors with `taker_only=true`;
4. deduplicates indexed rows by transaction hash;
5. resolves old page-boundary transactions to canonical receipts;
6. proves the indexed retrieval has reached at least the beginning of the requested block window;
7. only then compares canonical transaction hashes against indexed transaction hashes.

If page depth is insufficient, it returns:

```text
UNKNOWN
classification=UNPROVEN_COVERAGE
```

—not a false `INCOMPLETE`.

## M1.2 classifications

`TRANSACTION_COMPLETENESS` uses:

- `COMPLETE` — coverage is proven and every canonical transaction exists in the indexed source.
- `MISSING_TRANSACTIONS` — coverage is proven and at least one canonical transaction is absent.
- `NO_CANONICAL_ACTIVITY` — coverage is proven but no canonical target transactions occurred in the window.
- `UNPROVEN_COVERAGE` — the API pages did not reach far enough to prove the requested window.

A proven missing transaction maps the verification verdict to:

```text
INCOMPLETE
```

and the missing transaction hashes remain in machine-readable evidence / watch lifecycle payloads.

## Requirements

- Node.js 20+
- Network access for the real Polymarket/Polygon pilot

No `npm install` is required for the packaged ZIP because `dist/` is included and there are no runtime dependencies.

## 1. Deterministic M1.2 validation

```powershell
npm run check:m1.2
```

Expected ending:

```text
M1.2 reverse coverage: canonical OrderFilled transactions -> indexed Data API transaction hashes PASS
M1.2 transaction semantics: canonical log multiplicity does not overcount transaction completeness PASS
M1.2 missing transaction evidence: 0xeeeeeeeeee... -> INCOMPLETE-ready FAIL PASS
M1.2 coverage guard: insufficient indexed page depth -> UNKNOWN, not false INCOMPLETE PASS
M1.2 pilot preset: SOURCE_FRESHNESS + TRANSACTION_COMPLETENESS + PROVENANCE PASS
```

This also runs the full M0.1–M1.1 regression suite.

## 2. Pilot configuration

Generate a config:

```powershell
node dist/cli.js init `
  --preset polymarket-pilot `
  --output indexercheck.json
```

The M1.2 pilot includes:

```json
{
  "checks": {
    "sourceFreshness": [
      {
        "name": "orderfilled-freshness",
        "stream": "OrderFilled",
        "maxAgeSeconds": 300,
        "maxLagBlocks": 120,
        "activityGraceBlocks": 20
      }
    ],
    "transactionCompleteness": [
      {
        "name": "orderfilled-transaction-completeness",
        "stream": "OrderFilled",
        "windowBlocks": 20,
        "indexedPageSize": 500,
        "maxPages": 4
      }
    ],
    "provenance": [
      {
        "name": "orderfilled-provenance",
        "stream": "OrderFilled",
        "minSamples": 3
      }
    ]
  }
}
```

### Completeness tuning

- `windowBlocks` — canonical block window ending at the latest verified indexed trade block.
- `indexedPageSize` — Data API rows per page; clamped to 1–10,000.
- `maxPages` — maximum pages before coverage becomes `UNPROVEN_COVERAGE`.

M1.2.1 removes offset pagination entirely for Data API v2 and follows `pagination.next_cursor`.

## 3. Real external verify

```powershell
npm run pilot:verify
```

Healthy output should contain all three checks:

```text
Verdict            PASS

PASS    SOURCE_FRESHNESS         orderfilled-freshness ...
PASS    TRANSACTION_COMPLETENESS orderfilled-transaction-completeness ... classification=COMPLETE canonical=... missing=0
PASS    PROVENANCE               orderfilled-provenance ...
```

If canonical Polygon contains a transaction absent from the Data API within a proven window:

```text
Verdict            INCOMPLETE
FAIL    TRANSACTION_COMPLETENESS ... classification=MISSING_TRANSACTIONS canonical=... missing=1
```

Machine JSON includes:

```json
{
  "missingTransactions": ["0x..."]
}
```

Watch mode carries these hashes into the fallback incident lifecycle payload so alerts retain the concrete missing transaction evidence.

## 4. Live watch

Smoke test:

```powershell
npm run pilot:watch:smoke
```

Continuous:

```powershell
npm run pilot:watch
```

The watch stack still includes:

- persistent state
- deduplication
- detected / updated / recovered lifecycle
- pending webhook replay
- freshness lag trend
- source runtime resilience

A proven completeness failure becomes an `INCOMPLETE` incident. Repeated unchanged failures are deduplicated as before.

## M1.1 freshness retained

M1.2 keeps the activity-aware classifications:

- `FRESH`
- `CATCHING_UP`
- `INACTIVE`
- `STALE`
- `UNPROVEN_STALE`

This means completeness and freshness answer different questions:

```text
STALE
  new canonical activity exists beyond the indexed anchor

MISSING_TRANSACTIONS
  inside an already-covered historical window, canonical transactions are absent from the indexed API
```

## Existing stack retained

M1.2 keeps the full prior stack:

- `CANONICAL_HEAD`
- `SOURCE_FRESHNESS`
- `STATE_PARITY`
- `EVENT_COMPLETENESS`
- `TRANSACTION_COMPLETENESS`
- `PROVENANCE`
- `FIRST_DIVERGENCE`
- `ROOT_CAUSE_EVIDENCE`
- `INCIDENT_REPORT`
- stable machine JSON
- webhook delivery + HMAC
- GitHub Actions integration
- continuous watch
- lifecycle deduplication / recovery
- pending delivery replay
- source runtime resilience
- freshness trend history

## Main commands

```powershell
npm run check:m1.2.2
npm run pilot:verify
npm run pilot:watch:smoke
npm run pilot:watch
```

## M1.2.3 — Stable Completeness Watermark

Production transaction completeness deliberately verifies behind the newest observed indexed trade block. Seeing one trade from block N proves the Data API has reached N, but does not prove every trade from N has already landed. The Polymarket production preset therefore uses `settlementLagBlocks: 5`: freshness still tracks the newest indexed anchor, while completeness verifies an older stable window. Missing transactions behind that watermark remain failures; only the trailing ingestion frontier is deferred.


## M1.3 — Canonical Truth Quorum

The Polymarket production pilot no longer treats the first successful RPC provider as canonical truth.
Both the top-level JSON-RPC canonical source and the Polymarket-specific freshness/completeness/provenance verifier can require multi-provider agreement.

- moving `latest` heads are reconciled at the lowest observed common height, then block hash is cross-checked;
- receipts and logs are accepted only when the configured RPC quorum agrees;
- 2-of-N majority semantics are supported;
- impossible quorum configuration is rejected at load time;
- provider disagreement is a source-confidence failure, never evidence that the indexed API is wrong.

The production preset uses `minAgreement: 2` and `maxHeadSkewBlocks: 8` for both canonical RPC paths.


## M1.3.1 — Quorum Provider Redundancy

The production Polymarket pilot now uses three independent Polygon RPC endpoints (dRPC, Lava, PublicNode) with `minAgreement: 2`. One provider may be unavailable without disabling verification, while canonical truth still requires agreement from at least two providers.

Run:

```bash
npm run check:m1.3.1
npm run pilot:verify
npm run pilot:watch:smoke
```


## M1.3.2 — Finality-aware canonical quorum

M1.3.2 separates the **moving RPC frontier** from the block that IndexerCheck is willing to call canonical. With `agreementLagBlocks: 5`, IndexerCheck first observes provider heads, enforces the configured skew bound, then hash-verifies a block five blocks behind the slowest responding provider.

This prevents short-lived latest-block/fork/provider skew from becoming a false quorum failure. Polymarket transaction completeness is also capped at this quorum-safe head, so indexed data is never compared against a canonical range that the RPC quorum has not yet proven.

## M1.4 — Production Soak + Quorum Health

M1.4 turns live watch from a binary PASS/FAIL smoke test into a small production reliability probe.
Successful watch ticks now retain RPC quorum health beside lag and freshness:

- `quorum=HEALTHY`: quorum is proven with no failed providers and no response split;
- `quorum=DEGRADED`: canonical quorum still holds, but at least one provider failed or providers returned distinct responses;
- `quorum=UNKNOWN`: no usable quorum evidence is available for that tick.

The watch state records agreement count, required agreement, successful/failed providers, distinct responses, and maximum observed head skew. The new soak command runs multiple live ticks and prints an end-of-run summary without weakening canonical safety semantics.

```powershell
npm run check:m1.4
npm run pilot:verify
npm run pilot:watch:soak
```

## M1.4.1 — Watch confirmation + provider diagnostics

Production soak exposed two useful live behaviors: short-lived transaction-completeness gaps can recover within a few ticks, and a 2-of-3 quorum can remain valid while the same RPC provider is degraded. M1.4.1 keeps single-run verification strict while making watch alerting less noisy:

- `TRANSACTION_COMPLETENESS` remains an immediate `INCOMPLETE` result in `verify`.
- The Polymarket watch preset requires **3 consecutive failing ticks** before emitting `indexercheck.incident.detected` for transaction completeness.
- Unconfirmed candidates are persisted in watch state and disappear silently if the next checks recover.
- Quorum health now preserves failed RPC URLs and watch output reports `rpcFailedBy=...`.
- Soak summary aggregates failure ticks by RPC host, making persistent provider degradation visible without weakening the 2-of-3 safety rule.

Run:

```bash
npm run check:m1.4.1
npm run pilot:verify
npm run pilot:watch:soak
```

## M1.4.2 — Freshness confirmation + provider rotation

Production-soak hardening based on the M1.4.1 live pilot:

- `SOURCE_FRESHNESS` watch alerts now require three consecutive failing ticks, while one-shot `verify` remains strict.
- A stale candidate that recovers before confirmation produces no detected/recovered lifecycle noise.
- The production Polygon quorum rotates away from the persistently failing Lava public endpoint to the current Polygon-listed public set: dRPC, Tenderly, and Allnodes/PublicNode.
- `pilot:watch:soak` now runs 12 ticks so the smoke/soak cycle can observe freshness confirmation or recovery instead of stopping on the first stale tick.

Safety is unchanged: canonical evidence still requires 2-of-3 RPC agreement; a single surviving RPC is never accepted as truth.

## M1.5 — Second production integration: Goldsky / Kaia USDT

M1.5 validates that IndexerCheck's production model is not specific to Polymarket. The second pilot uses the public Goldsky Kaia USDT subgraph documented by Kaia and verifies it against a separate 2-of-3 Kaia JSON-RPC quorum.

The first M1.5 slice deliberately uses only public-schema fields documented by Kaia (`id`, `from`, `to`, `value`) plus the standard subgraph `_meta` head. `PROVENANCE` parses the Goldsky event id as `transactionHash-logIndex` and verifies contract address, Transfer topic, indexed addresses, and value against canonical receipt/log evidence. `SOURCE_FRESHNESS` compares the subgraph `_meta` block to a settled Kaia quorum head.

Commands:

```powershell
npm run check:m1.5
npm run goldsky:pilot:verify
npm run goldsky:pilot:verify:json
npm run goldsky:pilot:watch:smoke
```

Reverse completeness is intentionally deferred until the live public schema is observed, so M1.5 does not assume undocumented block-number or pagination fields.

## M1.5.1 — Live Endpoint Hardening: Goldsky / Euler Ethereum

The first M1.5 production pilot deliberately used the Goldsky Kaia USDT demo endpoint published in Kaia documentation. The local contract tests passed, but the live endpoint returned HTTP 404. M1.5.1 treats endpoint lifecycle as a production concern instead of silently replacing the URL and keeping the same assumptions.

The active Goldsky pilot now targets Euler's current Ethereum mainnet production subgraph:

`https://api.goldsky.com/api/public/project_cm4iagnemt1wp01xn4gh1agft/subgraphs/euler-simple-mainnet/latest/gn`

Before verification, run `goldsky:pilot:preflight`. It checks that the GraphQL endpoint is reachable, `_meta` is available, and the `TrackingVaultBalance` fields used by the pilot are present. Production verification then checks:

- Goldsky `_meta` freshness against a settled Ethereum 2-of-3 RPC quorum;
- each sampled `TrackingVaultBalance.transactionHash` against a canonical receipt;
- indexed `balance` against `balanceOf(account)` at the indexed block;
- indexed `debt` against `debtOf(account)` at the indexed block;
- canonical agreement across dRPC, PublicNode, and 1RPC.

`TrackingVaultBalance` is intentionally used only as a historical verification surface: its values represent the last event-time capture and are compared at that exact indexed block. IndexerCheck does not treat those values as current Euler position state.

Recommended live sequence:

```powershell
npm run check:m1.5.1
npm run goldsky:pilot:preflight
npm run goldsky:pilot:verify
npm run goldsky:pilot:verify:json
npm run goldsky:pilot:watch:smoke
```

If preflight fails, stop before verification and inspect endpoint/schema diagnostics rather than guessing a replacement surface.

## M1.5.2 — Archive-state quorum + Euler debt semantics

The M1.5.1 live pilot proved the Goldsky Euler endpoint and `_meta` freshness path, but historical provenance failed before any indexed-vs-canonical state comparison could be made. The failure was RPC capability: historical `eth_call` only had one successful provider, while the previous pool included providers that were suitable for heads/receipts but not reliable archive-state reads.

M1.5.2 hardens that boundary:

- Ethereum production RPC pool is now `eth.drpc.org`, `gateway.tenderly.co/public/mainnet`, and `eth.merkle.io` with 2-of-3 agreement.
- `goldsky:pilot:preflight` now probes a real `TrackingVaultBalance` row against each RPC for head, receipt, historical `balanceOf`, and historical `debtOf` capability before verification.
- `balanceOf(account)` still requires ordinary 2-of-3 successful historical-state agreement.
- Euler's own mapping uses `try_debtOf()`. A contract-level EVM revert is therefore normalized to semantic debt `0`; transport errors, archive-unavailable errors, rate limits, timeouts, and missing historical state are not treated as zero.
- Failed provenance rows retain the underlying `RpcQuorumError` evidence so live diagnostics show which provider/method failed instead of collapsing everything into a generic DRIFT.

Recommended live sequence:

```powershell
npm run check:m1.5.2
npm run goldsky:pilot:preflight
npm run goldsky:pilot:verify
npm run goldsky:pilot:verify:json
```

Only run `goldsky:pilot:watch:smoke` after preflight and one-shot verification are clean. A provenance FAIL caused by canonical state disagreement is meaningful; a quorum/capability error should first be treated as canonical-evidence infrastructure failure, not as proof that Goldsky data drifted.
