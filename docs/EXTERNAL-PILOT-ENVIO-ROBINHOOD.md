# IndexerCheck External Pilot #1

## Environment

- IndexerCheck: 0.2.0
- Installation: fresh npm install from public registry
- Indexed provider: Envio HyperIndex
- Chain: Robinhood Chain mainnet
- Chain ID: 4663
- Indexed API: local Envio GraphQL / Hasura
- Canonical evidence: Robinhood Chain JSON-RPC
- Quorum requirement: 2
- Working RPC providers:
  - https://rpc.mainnet.chain.robinhood.com
  - https://robinhood.drpc.org

## Goal

Validate IndexerCheck 0.2.0 against a genuinely external indexer without modifying IndexerCheck core code.

The pilot tested both directions:

1. Indexed -> canonical
   - Is an indexed event actually supported by canonical chain evidence?

2. Canonical -> indexed
   - Is any canonical event missing from the indexed dataset?

## Envio integration findings

The original tutorial-style Envio indexer exposed aggregate entities but did not initially persist proof-ready raw event identity.

Required Envio settings:

```yaml
raw_events: true

field_selection:
  transaction_fields:
    - hash
```

After enabling these settings, `raw_events` exposed:

- block_number
- log_index
- src_address
- transaction_fields.hash
- params.from
- params.to
- params.value

This was sufficient for IndexerCheck generic EVM log verification without an Envio-specific IndexerCheck adapter.

## Positive Control A — Provenance

IndexerCheck read recent Envio Transfer rows over GraphQL and verified:

- blockNumber
- transactionHash
- logIndex
- contract address
- from
- to
- value

against canonical `eth_getLogs` evidence.

Result:

```text
PROVENANCE: PASS
sampled: 3
verified: 3
failureCount: 0
```

## Positive Control B — Reverse Completeness

A deterministic historical active range was selected:

```text
74705261-74705280
```

Canonical RPC quorum found 9 Transfer events.

Envio returned the same 9 events.

Result:

```text
EVENT_COMPLETENESS: PASS
classification: COMPLETE

canonicalCount: 9
indexedCount: 9
matchedCount: 9
missingCount: 0
coverageProven: true
```

## Negative Control A — Value Corruption

A test adapter changed exactly one indexed Transfer value:

```text
indexed value = canonical value + 1
```

Envio itself was not modified.

Result:

```text
Verdict: DRIFT

PROVENANCE: FAIL
sampled: 3
verified: 2
failureCount: 1
```

Detected mismatch:

```text
indexed   = 568546998302886170
canonical = 568546998302886169
```

The other 2 sampled rows remained PASS.

## Negative Control B — Missing Event

A test adapter removed exactly one indexed event from the known 9-event historical range.

Envio itself was not modified.

Result:

```text
Verdict: INCOMPLETE

EVENT_COMPLETENESS: FAIL
classification: MISSING_EVENTS

canonicalCount: 9
indexedCount: 8
matchedCount: 8
missingCount: 1
```

Missing event:

```text
0x0590a89b738f934e8e2b4a5a97804620ad22c868678f12e1002762b044735103:18
```

Missing block:

```text
74705263
```

The negative-control adapter reported:

```text
originalCount: 9
returnedCount: 8
deliberatelyDropped: 1
```

## Head verification

Live head comparison was also exercised.

Example successful observation:

```text
CANONICAL_HEAD: PASS
canonicalHead: 74710869
indexedHead:   74710832
lagBlocks:     37
maxLagBlocks:  50
```

Envio also reported `isReady=true`.

IndexerCheck did not rely solely on Envio's own readiness flag; it independently compared the indexed head with canonical evidence.

## RPC findings

Several public Robinhood RPC endpoints were tested.

### Working

- Robinhood official public RPC
- dRPC

These produced agreeing canonical evidence for the tested provenance and bounded completeness windows.

### PublicNode

Returned HTTP 403 during the pilot.

### ArrowRPC

Returned HTTP 530 during the pilot.

### dRPC range behavior

A 200-block `eth_getLogs` request produced:

```text
ranges over 10000 blocks are not supported on free plan
```

despite the actual request being approximately 200 blocks.

A 20-block bounded completeness window succeeded with 2-provider agreement.

This should be treated as provider-specific behavior rather than proof that IndexerCheck requires 20-block windows.

## Final Validation Matrix

| Test | Expected | Actual |
|---|---|---|
| Valid indexed events | PASS | PASS |
| One corrupted event field | DRIFT | DRIFT |
| Complete canonical event range | PASS | PASS |
| One missing indexed event | INCOMPLETE | INCOMPLETE |

## Main conclusion

IndexerCheck 0.2.0 successfully verified a third-party Envio HyperIndex deployment on Robinhood Chain without IndexerCheck core changes or a provider-specific production adapter.

The generic data contract was sufficient once strong event identity was available.

The pilot demonstrated:

- real external onboarding
- generic GraphQL integration
- canonical RPC quorum evidence
- field-level event provenance
- reverse event completeness
- DRIFT detection
- INCOMPLETE detection
- fail-closed UNKNOWN behavior when canonical evidence could not be proven

## Friction discovered

1. Discovering that Envio `raw_events` is disabled by default required external investigation.
2. Transaction hash persistence required explicit Envio `field_selection`.
3. Generic GraphQL configuration is powerful but verbose.
4. Reverse completeness requires users to understand the `historicalRangeComplete` contract.
5. RPC provider quirks can make UNKNOWN difficult to diagnose without looking at detailed JSON evidence.
6. Historical deterministic testing required manually manipulating `headTag`.
7. A provider-specific onboarding example would substantially reduce setup time.

## Candidate v0.2.1 work

Prefer onboarding and diagnostics improvements over new proof primitives:

- Envio HyperIndex example documentation
- clear prerequisites for strong event identity
- documented GraphQL provenance recipe
- documented reverse completeness recipe
- clearer RPC quorum failure presentation
- deterministic historical verification example
- possibly an Envio-oriented init/example preset if justified by repeated pilot demand

No new core semantic primitive is required based on this pilot.
