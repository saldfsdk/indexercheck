# IndexerCheck v0.1.0-rc.2 — Release Notes

Date: 2026-09-28

## Scope

`v0.1.0-rc.2` is the release-packaging hardening candidate for the M1 feature-freeze baseline. It intentionally adds no new verification primitive or production integration.

The verification baseline remains the same M1 core proven against:

- Polymarket Data API / Polygon; and
- Goldsky / Euler / Ethereum.

## What changed since rc.1

### CLI release ergonomics

- `indexercheck --version` now prints the package/tool version and exits successfully.
- `indexercheck -v` is an alias for `--version`.
- `indexercheck --help` and `indexercheck -h` now use an explicit successful help path rather than the invalid-command usage path.

### npm package contents

The npm tarball now uses a whitelist. Runtime distribution is limited to the CLI/runtime modules, the two production-pilot examples, stable schemas, and release documentation.

Development-only material is intentionally excluded from the npm tarball, including:

- `src/`;
- compiled `dist/tests/`;
- milestone scripts under `dist/scripts/milestone-*`; and
- internal M1 development notes.

The source/ZIP distribution still retains the complete test and milestone history.

### Automated package gate

`npm run check:package` now performs a clean packaging smoke test:

1. build;
2. `npm pack`;
3. inspect tarball contents;
4. install the generated `.tgz` into a fresh temporary npm project;
5. run the installed CLI through `npx indexercheck --help`;
6. verify `npx indexercheck --version` and `-v` report `0.1.0-rc.2`.

`npm run check:rc` includes this packaging gate after the full M1 regression/milestone suite.

## M1 release baseline

The deterministic baseline remains 108 tests at feature freeze, with the previously completed live production pilots and soak runs unchanged.

`rc.2` should therefore be interpreted as a packaging/release-quality candidate, not a change to blockchain verification semantics.

## Next product phase

After this candidate is accepted, new feature work moves to M2: making the canonical verification kernel configurable for user-owned REST/GraphQL indexers rather than adding more hard-coded production pilots.
