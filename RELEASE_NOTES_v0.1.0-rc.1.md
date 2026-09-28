# IndexerCheck v0.1.0-rc.1 — Release Notes

Date: 2026-09-27

## What this RC proves

IndexerCheck's M1 kernel has been exercised against two materially different live indexing architectures:

### Polymarket Data API / Polygon

- Managed REST API rather than a subgraph.
- Official serving/ingestion watermark for freshness.
- Reverse canonical transaction coverage for `OrderFilled`.
- Forward sampled provenance.
- Finality-aware Polygon RPC quorum.
- Continuous watch confirmation and soak behavior.

Observed M1.4.5 soak baseline:

```text
successful=12
errors=0
quorumHealthy=12
quorumDegraded=0
maxLag=15
maxHeadLag=109
```

The large diagnostic head distance did not become a false freshness incident because verification used the authoritative v2 status watermark.

### Goldsky / Euler / Ethereum

- GraphQL subgraph rather than REST.
- `_meta` watermark for freshness.
- Historical state provenance rather than transaction-feed completeness.
- Receipt + historical `balanceOf` + Euler `try_debtOf` semantics.
- Archive-capable Ethereum canonical quorum.

Observed M1.5.2 soak baseline:

```text
successful=8
errors=0
quorumHealthy=0
quorumDegraded=8
quorumUnknown=0
maxLag=0
rpcFailures=eth.merkle.io:8
```

Every verification tick passed while one of three configured RPC providers was unavailable/rate-limited. dRPC and Tenderly maintained the required 2-provider agreement.

## What `PASS` means

A `PASS` means the configured checks were provable and satisfied for their explicit scope using the required canonical evidence/quorum. It does not mean every possible property of the indexed system has been exhaustively verified.

## What this RC intentionally does not claim

- No universal config-only adapter for arbitrary indexers yet.
- No reverse completeness guarantee for the Goldsky/Euler integration.
- No guarantee that public RPC endpoints will remain available or archive-capable.
- No claim that N-provider agreement eliminates correlated provider bugs.
- No automatic root-cause guess when evidence is insufficient.

## Recommended evaluation sequence

```powershell
npm run check:rc

npm run pilot:verify
npm run pilot:watch:smoke

npm run goldsky:pilot:preflight
npm run goldsky:pilot:verify
npm run goldsky:pilot:watch:smoke
```

Use `--json` / the `*:verify:json` scripts when evaluating evidence structure for automation.

## Release decision

M1 is feature-frozen at `v0.1.0-rc.1`. Further M1.x-style polishing should be limited to release-blocking correctness defects. New product work should focus on making the kernel configurable for user-owned indexers and APIs rather than adding more hard-coded production pilots.
