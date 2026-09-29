# External Pilot #2 — Ponder / Ethereum USDC

## Summary

This pilot validated IndexerCheck `v0.2.1` against a genuinely external Ponder application using real Ethereum mainnet data.

The pilot started from Ponder's generated ERC-20 reference project, identified the minimum data-contract changes required for deterministic event proof, and then exercised IndexerCheck from a separate consumer project.

The final test matrix covered all four major verification outcomes:

| Scenario | IndexerCheck result |
| --- | --- |
| Correct indexed event samples | `PASS` — `PROVENANCE 3/3` |
| Complete indexed historical range | `PASS` — `COMPLETE 846/846` |
| One deliberately omitted canonical event | `INCOMPLETE` — `845/846`, `missing=1` |
| One deliberately corrupted indexed field | `DRIFT` — `2/3`, exact field mismatch |
| Ponder API unavailable | `UNKNOWN / INDEXED_SOURCE_UNAVAILABLE` |
| Canonical RPC quorum unavailable | `UNKNOWN / CANONICAL_PROOF_UNAVAILABLE` |

The important product result is not only that Ponder can be verified. The pilot also demonstrated that IndexerCheck preserves the distinction between:

```text
proven mismatch           -> DRIFT / INCOMPLETE
proof unavailable         -> UNKNOWN
```

under real indexed-source and canonical-source failure conditions.

---

## Goal

The goal was to test the public npm release, `indexercheck@0.2.1`, as an external consumer against a third-party indexer stack that was materially different from the first Envio pilot.

The pilot intentionally avoided modifying the IndexerCheck proof kernel first.

The questions were:

1. Can a normal Ponder application expose enough information for deterministic canonical event proof?
2. How much Ponder-side adaptation is required?
3. Can IndexerCheck prove indexed event provenance against independent Ethereum RPC evidence?
4. Can it prove reverse event completeness over a bounded historical range?
5. Does it distinguish data corruption, missing data, indexed-source outages, and canonical-proof outages correctly?
6. What onboarding friction should influence the next `v0.2.x` release?

---

## Environment

### Ponder application

The pilot used the Ponder ERC-20 reference application generated with:

```text
create-ponder 0.17.12
Ponder ^0.17.12
viem 2.35.0
Node >= 22
```

The local Ponder API was served at:

```text
http://localhost:42069/graphql
```

The application used PGlite for its local database.

### IndexerCheck consumer

IndexerCheck was installed into a separate project rather than into the Ponder application:

```bash
mkdir -p ~/indexercheck-ponder-verifier
cd ~/indexercheck-ponder-verifier
npm init -y
npm install indexercheck@0.2.1
npx indexercheck --version
```

Observed version:

```text
0.2.1
```

The install completed with zero reported npm vulnerabilities.

---

## Initial Ponder reference shape

The generated Ponder reference application's Transfer table initially exposed fields equivalent to:

```text
id
amount
timestamp
from
to
```

The generated GraphQL API therefore did **not** initially expose the three explicit event-identity fields required by IndexerCheck's generic EVM-log provenance proof:

```text
blockNumber
transactionHash
logIndex
```

This was the first material onboarding finding.

The generated `event.id` was intentionally **not** treated as canonical event identity. Although it is deterministic inside Ponder, the pilot did not rely on parsing an opaque framework-specific identifier when the underlying canonical EVM identity can be stored explicitly.

---

## Historical-reference RPC friction

The original Ponder reference project covered an older Ethereum block range around block `13,142,655` to `13,150,000`.

Trying to reproduce that range exposed substantial public-RPC friction before IndexerCheck itself was involved.

Observed during the pilot:

- one endpoint repeatedly rate-limited requests;
- dRPC returned a misleading free-plan range error on a much smaller historical request;
- PublicNode required a personal token for archive access;
- 1RPC returned a mixture of timeouts, pruned-history errors, archive-token requirements, rate limits, and block-range restrictions during the old historical backfill;
- the Ponder backfill could therefore not be completed reliably with the tested unauthenticated public endpoints.

These observations are specific to the pilot session and should not be interpreted as permanent service-level statements about those providers.

The pilot therefore moved away from the old archival reference range and used a recent deterministic Ethereum window instead. This kept the experiment focused on Ponder/IndexerCheck interoperability rather than public archive-provider discovery.

---

## Recent deterministic Ethereum window

The pilot selected Ethereum USDC:

```text
contract:
0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48

Transfer topic:
0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef
```

The fixed block window was:

```text
26076701 .. 26076710
```

A direct canonical probe against both dRPC and PublicNode returned the same count:

```text
Transfer logs: 846
```

The first observed canonical event was:

```text
blockNumber:      26076701
transactionHash:  0x824050e9af6b5a2b26b1b6dde4b4da1fae720215c33b673623516b8b2d8b942e
logIndex:         7
```

---

## Ponder configuration for the bounded pilot

The Ponder contract configuration was changed to the recent USDC window:

```ts
export default createConfig({
  chains: {
    mainnet: {
      id: 1,
      rpc: process.env.PONDER_RPC_URL_1,
      ethGetLogsBlockRange: 10,
    },
  },
  contracts: {
    ERC20: {
      chain: "mainnet",
      abi: erc20ABI,
      address: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      startBlock: 26076701,
      endBlock: 26076710,
    },
  },
});
```

With a fresh Ponder database, the bounded range completed successfully:

```text
Started backfill indexing chain=mainnet block_range=[26076701,26076710]
Finished fetching backfill JSON-RPC data
Indexed block range chain=mainnet event_count=936 block_range=[26076701,26076710]
Completed backfill indexing across all chains
```

Ponder's final event counts were:

```text
ERC20:Transfer  846
ERC20:Approval    90
```

The combined `936` event count therefore matched `846 + 90`.

Ponder reported:

```text
Chain status: complete
Block:        26076710
```

---

## Minimal proof-ready Ponder change

Only three fields were added to the Transfer table:

```ts
blockNumber: t.bigint().notNull(),
transactionHash: t.hex().notNull(),
logIndex: t.integer().notNull(),
```

And the handler persisted the corresponding Ponder event metadata:

```ts
blockNumber: event.block.number,
transactionHash: event.transaction.hash,
logIndex: event.log.logIndex,
```

No IndexerCheck kernel changes were required.

The generated GraphQL schema then exposed:

```graphql
type transferEvent {
  id: String!
  blockNumber: BigInt!
  transactionHash: String!
  logIndex: Int!
  amount: BigInt!
  timestamp: Int!
  from: String!
  to: String!
  fromAccount: account
  toAccount: account
}
```

The first GraphQL row matched the independently observed canonical identity exactly:

```text
blockNumber:      26076701
transactionHash:  0x824050e9af6b5a2b26b1b6dde4b4da1fae720215c33b673623516b8b2d8b942e
logIndex:         7
```

The GraphQL collection reported:

```text
totalCount: 846
```

---

## TypeScript baseline-snapshot friction

A baseline copy of the original Ponder files was initially stored inside the project as `.ts` files.

After the live schema gained the three required proof fields, `pnpm typecheck` also compiled the preserved baseline `index.ts`. That old handler naturally failed type checking because it did not contain the newly required fields.

This was not a Ponder application error and not an IndexerCheck error. The baseline evidence files simply needed to be stored outside the TypeScript compilation surface, for example as:

```text
index.ts.txt
ponder.schema.ts.txt
```

This is a pilot-documentation detail rather than a product issue.

---

## Historical GraphQL range coverage

Before enabling `historicalRangeComplete: true`, the pilot explicitly verified that the bounded Ponder GraphQL request exhausted its result set.

For blocks `26076701..26076710`:

```text
items:        846
totalCount:   846
hasNextPage:  false
```

The first and last returned identities were:

```text
first:
26076701
0x824050e9af6b5a2b26b1b6dde4b4da1fae720215c33b673623516b8b2d8b942e
7

last:
26076710
0x08b8c7de33106706fd765084f2344934a11b98133f6945e17b91dc8cee4d0b4e
157
```

The query used `limit: 1000`, while the actual result set contained 846 rows.

This matters because `historicalRangeComplete: true` is a proof contract, not a pagination switch. The pilot only asserted complete coverage after confirming that this specific fixed range did not have an unresolved next page.

---

## Positive control #1 — Event provenance

The first IndexerCheck verification used the Ponder GraphQL endpoint as the indexed source and independent Ethereum JSON-RPC providers as canonical truth.

The sampled Ponder rows exposed:

```text
blockNumber
transactionHash
logIndex
amount
from
to
```

IndexerCheck then resolved each exact canonical log and compared:

```text
from   address
  to   address
value  uint256
```

Observed result:

```text
IndexerCheck — ponder-usdc-external-pilot

Verdict            PASS
Canonical head     26076710
Indexed head       26076710

PASS    PROVENANCE  ponder-usdc-transfer-provenance observedAtBlock=26076710
        Verified 3/3 indexed 'Transfer' row(s) against canonical chain evidence.
```

Machine evidence:

```text
sampled:       3
verified:      3
failureCount:  0
```

For each row, the configured RPC quorum initially showed both tested providers agreeing on the canonical `eth_getLogs` result.

The proof therefore established more than event existence: the indexed `from`, `to`, and `amount` values matched the canonical log contents.

---

## Positive control #2 — Reverse event completeness

A separate config exercised `EVENT_COMPLETENESS` over the exact same fixed range.

Configuration semantics:

```text
canonical head:       26076710
windowBlocks:         10
settlementLagBlocks:  0
verified range:       26076701..26076710
```

Observed result:

```text
Verdict PASS

PASS EVENT_COMPLETENESS ponder-usdc-transfer-completeness
     classification=COMPLETE
```

Machine evidence:

```text
canonicalCount:          846
indexedCount:            846
matchedCount:            846
missingCount:              0
unexpectedIndexedCount:    0
coverageProven:          true
```

The indexed coverage evidence was:

```text
coverageBasis: declared-complete-range-query
requestedFromBlock: 26076701
requestedToBlock:   26076710
```

This demonstrated the reverse direction:

```text
canonical Ethereum logs
        ->
all required indexed rows exist
```

rather than only proving sampled indexed rows individually.

---

## Negative control #1 — Deliberately omitted event

To test missing-event detection without corrupting the real Ponder database, the pilot used an indexed-side Adapter SDK wrapper.

The adapter queried the complete Ponder range, verified that pagination was exhausted, then deliberately removed exactly one known event while still declaring the synthetic test range complete.

Deliberately omitted identity:

```text
transactionHash:
0x824050e9af6b5a2b26b1b6dde4b4da1fae720215c33b673623516b8b2d8b942e

logIndex:
7

blockNumber:
26076701
```

Observed human result:

```text
Verdict INCOMPLETE

FAIL EVENT_COMPLETENESS ponder-usdc-missing-one
     classification=MISSING_EVENTS

Indexed source is missing 1/846 canonical 'Transfer' event(s)
in settled blocks 26076701-26076710.
```

Process exit code:

```text
1
```

Machine evidence:

```text
canonicalCount:  846
indexedCount:    845
matchedCount:    845
missingCount:      1
coverageProven:  true
```

Exact missing event:

```text
0x824050e9af6b5a2b26b1b6dde4b4da1fae720215c33b673623516b8b2d8b942e:7
```

The report also identified:

```text
oldestMissingBlock:     26076701
newestMissingBlock:     26076701
maxMissingDepthBlocks:  9
minMissingDepthBlocks:  9
```

This confirmed that IndexerCheck could distinguish a complete-looking indexed surface with one missing canonical event from a healthy complete range.

---

## Negative control #2 — Deliberately corrupted event value

A second indexed-side adapter preserved the real Ponder identity fields but changed exactly one sampled `amount` value by `+1`.

The original indexed/canonical value was:

```text
120000001050
```

The synthetic corrupted indexed value was:

```text
120000001051
```

After canonical quorum evidence became available, the human verification returned:

```text
Verdict DRIFT

FAIL PROVENANCE ponder-usdc-corrupt-one observedAtBlock=26076710
     Provenance verification failed for 'Transfer':
     verified 2/3, failures=1, minSamples=3.
```

Machine evidence was captured after several transient canonical-quorum failures:

```text
verdict:       DRIFT
status:        FAIL
sampled:       3
verified:      2
failureCount:  1
```

Exact failed event:

```text
transactionHash:
0x08b8c7de33106706fd765084f2344934a11b98133f6945e17b91dc8cee4d0b4e

logIndex:
157
```

Exact failure:

```text
event field 'value' mismatch indexed=120000001051 canonical=120000001050
```

This is the desired DRIFT behavior: the event identity existed on both sides, but the indexed field value did not match canonical evidence.

---

## Fail-closed control #1 — Indexed source unavailable

During the corruption negative control, the local Ponder process was initially not running.

A direct request to the local GraphQL endpoint failed to connect.

IndexerCheck returned:

```text
Verdict UNKNOWN

UNKNOWN PROVENANCE ponder-usdc-corrupt-one
        Indexed event data is unavailable for 'Transfer'.
```

Machine classification:

```text
INDEXED_SOURCE_UNAVAILABLE
```

Reason shape:

```text
indexed source unavailable during getEvents(Transfer)
...
fetch failed
```

Importantly, IndexerCheck did **not** report DRIFT when it could not read the indexed source.

After restarting Ponder, the same database cache rebuilt the bounded application successfully and again exposed all 846 Transfer rows.

---

## Fail-closed control #2 — Canonical quorum unavailable

The pilot also encountered periods where the indexed Ponder source was healthy but the configured canonical RPC quorum could not reach its required agreement threshold.

IndexerCheck returned:

```text
Verdict UNKNOWN

UNKNOWN PROVENANCE ponder-usdc-corrupt-one
        Canonical event proof is unavailable for 'Transfer'.
```

Machine classification:

```text
CANONICAL_PROOF_UNAVAILABLE
```

Observed reason shape:

```text
Canonical RPC quorum failed for eth_getLogs:
agreement 1/2, successful=1, distinct=1
```

Again, IndexerCheck did **not** convert lack of proof into a false DRIFT verdict.

This behavior was reproduced multiple times before the canonical quorum became available and the same corruption test produced a real DRIFT verdict.

---

## Canonical RPC normalization observation

During the pilot, PublicNode and 1RPC returned the same 19 USDC Transfer logs for block `26076710`, and the same block hash:

```text
0x0887c5c26396c3ae970e25f112e7490c3bac12fee2b48774c23fb1e173a1c605
```

A naive SHA-256 over the providers' raw JSON responses differed.

However, after applying the same semantic normalization used by IndexerCheck's EVM-log quorum logic, both responses produced exactly the same normalized result and hash:

```text
raw logs:         19
normalized logs:  19
normalized_equal: true

normalized SHA-256:
e7f5bc88c2d4fdec673af457c0bc9e3d921bd5d0972df5e6c9299e86901aed2b
```

The relevant canonical event fields are normalized before quorum comparison:

```text
address
transactionHash
blockHash
blockNumber
logIndex
topics
data
```

The logs are also normalized for casing and ordering.

This avoided treating provider-specific raw response formatting or additional fields as canonical disagreement.

---

## Public RPC operational observations

The pilot encountered materially different behavior from public Ethereum RPC endpoints over a short time window.

Examples observed during this session included:

- successful exact-block and recent-range reads;
- routing failures;
- rate limits;
- archive restrictions on older history;
- pruned-history errors;
- request timeouts;
- provider-specific block-range limits;
- transient inability to satisfy a two-provider canonical quorum.

The corruption negative control illustrates the consequence directly:

```text
attempt 1 -> UNKNOWN
attempt 2 -> UNKNOWN
attempt 3 -> UNKNOWN
attempt 4 -> DRIFT
```

The underlying indexed corruption did not change. What changed was whether sufficient canonical evidence was available to prove it.

This is exactly why the product should retain the distinction between `UNKNOWN` and a proven mismatch.

These observations should not be generalized into permanent claims about any specific provider's current service limits.

---

## Ponder onboarding findings

### 1. The default reference Transfer table is not proof-ready

The largest Ponder-specific friction was not transport or GraphQL compatibility.

It was the data contract.

The default Transfer entity exposed useful application data but did not explicitly persist:

```text
blockNumber
transactionHash
logIndex
```

IndexerCheck cannot derive strong deterministic EVM event identity from `amount/from/to/timestamp` alone.

### 2. The required Ponder-side change is small

The proof-ready adaptation was only:

```text
3 schema fields
+ 3 handler assignments
```

Once present, the normal generated GraphQL API was sufficient for config-only provenance.

### 3. Opaque framework IDs should not be treated as canonical proof identity

The pilot deliberately avoided parsing the generated Ponder `event.id`.

Using explicit EVM identity makes the integration clearer, more portable, and less dependent on undocumented framework encoding details.

### 4. GraphQL pagination matters for completeness

Provenance only needs sampled rows.

Reverse completeness is stricter: IndexerCheck must know whether the indexed range is actually complete.

For this bounded pilot, `limit=1000`, `totalCount=846`, and `hasNextPage=false` made the range contract explicit.

For larger ranges, silently setting:

```json
"historicalRangeComplete": true
```

on a paginated query would be unsafe.

A pagination-aware Adapter SDK implementation is the honest path when one GraphQL request cannot prove full coverage.

### 5. Indexed head metadata is not required for the core range proof

The completeness-only GraphQL config did not expose an explicit Ponder indexed-head mapping, so the human CLI displayed:

```text
Indexed head ?
```

The reverse completeness proof still succeeded because it used a fixed canonical head and requested the exact historical indexed range.

This is acceptable for the proof itself, although Ponder-specific freshness/head guidance may improve onboarding.

---

## Product findings

### Finding A — The generic kernel worked without Ponder-specific code

No Ponder-specific canonical verifier was required.

Once Ponder exposed a clean event identity, the existing generic pipeline was sufficient:

```text
Ponder GraphQL row
    ->
blockNumber + transactionHash + logIndex
    ->
quorum-backed canonical eth_getLogs
    ->
identity and decoded-field comparison
```

This supports the Bring Your Own Indexer architecture.

### Finding B — Data contracts are the integration boundary

The most important integration requirement is not the framework name.

It is whether the indexed surface exposes the proof data contract required by the verification primitive.

For generic event provenance, that includes explicit canonical event identity.

### Finding C — Completeness requires stronger API semantics than provenance

A GraphQL endpoint that is sufficient for sampled provenance is not automatically sufficient for reverse completeness.

Completeness additionally needs a credible full-range coverage contract.

This distinction should remain prominent in documentation and examples.

### Finding D — UNKNOWN classifications are part of the value proposition

The pilot produced two independent real-world UNKNOWN cases:

```text
INDEXED_SOURCE_UNAVAILABLE
CANONICAL_PROOF_UNAVAILABLE
```

Both prevented false mismatch verdicts.

This is not only defensive implementation behavior; it is an important operator-facing semantic guarantee.

### Finding E — Public RPC quorum is operationally noisy

Independent canonical evidence is stronger than trusting one provider, but public endpoints can be transiently unreliable.

The pilot does **not** yet justify changing the core quorum semantics. It does justify documenting RPC-provider operational expectations and considering retry/backoff UX separately from proof semantics.

---

## Candidate work for v0.2.2

This pilot does not justify a new proof primitive or an M3 expansion.

The strongest evidence supports an onboarding-focused `v0.2.2`.

### Candidate 1 — Ponder example and integration guide

Add a checked-in Ponder example showing the minimal proof-ready data contract:

```text
blockNumber
transactionHash
logIndex
```

and a matching GraphQL provenance config.

Potential files:

```text
examples/ponder-erc20.example.json
docs/PONDER-INTEGRATION.md
```

The guide should explicitly show the required Ponder schema/handler additions rather than implying that the default generated Transfer table is already sufficient.

### Candidate 2 — Pagination-aware Ponder completeness example

Add an Adapter SDK example that:

1. requests a block range;
2. follows Ponder GraphQL pagination until exhaustion;
3. verifies there is no remaining page;
4. returns the normalized events with `coverageProven: true` only after the full range has been consumed.

This would remove the temptation to misuse `historicalRangeComplete: true` for arbitrarily large paginated queries.

### Candidate 3 — RPC operational guidance

Document that canonical quorum can legitimately become `UNKNOWN` under transient public-RPC failures.

Useful guidance could include:

- use multiple genuinely independent providers where possible;
- prefer authenticated/reliable production RPC endpoints for continuous monitoring;
- treat public unauthenticated endpoints as useful evaluation infrastructure, not guaranteed production dependencies;
- keep proof thresholds strict rather than silently lowering quorum when one provider fails.

### Candidate 4 — Retry/backoff UX, but only as a measured follow-up

The sequence:

```text
UNKNOWN
UNKNOWN
UNKNOWN
DRIFT
```

suggests that a bounded retry/backoff layer might improve operator experience.

However, this pilot alone is not enough evidence to redesign canonical-source behavior.

Any future retry feature must preserve the same semantic rule:

```text
no quorum -> UNKNOWN
```

It must never downgrade the agreement threshold merely to obtain a verdict.

---

## What should not change based on this pilot

The pilot did **not** reveal a need to:

- add a Ponder-specific canonical source;
- parse Ponder's opaque event IDs;
- weaken canonical quorum requirements;
- classify missing proof as DRIFT;
- classify unproven pagination as complete coverage;
- start M3 solely because a second external indexer was validated.

The current generic proof architecture handled the integration after a small indexed-side data-contract adaptation.

---

## Final result

External Pilot #2 demonstrated that the public `indexercheck@0.2.1` release can verify a real Ponder application against Ethereum mainnet evidence without modifying the IndexerCheck proof kernel.

The pilot established:

```text
correct sampled data
-> PASS / PROVENANCE 3/3

complete bounded range
-> PASS / COMPLETE 846/846

one missing canonical event
-> INCOMPLETE / 845/846

one corrupted indexed amount
-> DRIFT / 2/3
   indexed=120000001051
   canonical=120000001050

indexed source unavailable
-> UNKNOWN / INDEXED_SOURCE_UNAVAILABLE

canonical quorum unavailable
-> UNKNOWN / CANONICAL_PROOF_UNAVAILABLE
```

The central conclusion is that Ponder is compatible with IndexerCheck's generic verification model once the indexed application persists explicit canonical event identity.

The main remaining work is onboarding quality — examples, pagination guidance, and RPC-operational documentation — rather than a new verification primitive.

---

## Pilot status

```text
External Pilot #1 — Envio / Robinhood Chain     COMPLETE
External Pilot #2 — Ponder / Ethereum USDC      COMPLETE

IndexerCheck v0.2.1 external validation:
PASS / DRIFT / INCOMPLETE / UNKNOWN exercised against real external indexer stacks.
```
