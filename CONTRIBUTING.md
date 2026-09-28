# Contributing

IndexerCheck keeps a strict trust boundary: indexed-side adapters may normalize data, but canonical truth must remain in built-in quorum-backed verification paths.

Before submitting a change:

```bash
npm ci
npm run check:release
```

Changes that can turn an unavailable canonical proof into a false `DRIFT` or `INCOMPLETE` should be treated as release-blocking regressions.
