import type { SnapshotSource } from "./source.js";
import type { PrimitiveResult, StateParityCheckConfig } from "./types.js";
import { decodeStaticWord, encodeStaticWord, normalizeStaticValue } from "./generic-provenance.js";

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").filter(Boolean).reduce<unknown>((value, key) => {
    if (value === null || value === undefined || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[key];
  }, obj);
}

export async function genericEvmCallStateParity(
  canonical: SnapshotSource,
  indexed: SnapshotSource,
  config: StateParityCheckConfig,
): Promise<PrimitiveResult> {
  const proof = config.proof;
  if (!proof || proof.type !== "evm-call") throw new Error("genericEvmCallStateParity requires an evm-call proof");

  let indexedState;
  try {
    indexedState = await indexed.getState(config.key);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      primitive: "STATE_PARITY",
      name: config.name,
      status: "UNKNOWN",
      summary: `Indexed state source is unavailable for '${config.key}'.`,
      evidence: { key: config.key, proofMode: "evm-call", classification: "INDEXED_SOURCE_UNAVAILABLE", reason },
    };
  }
  if (!indexedState) {
    return {
      primitive: "STATE_PARITY",
      name: config.name,
      status: "UNKNOWN",
      summary: `Indexed state key '${config.key}' is unavailable for generic EVM call proof.`,
      evidence: { key: config.key, proofMode: "evm-call", classification: "INDEXED_STATE_UNAVAILABLE" },
    };
  }
  if (indexedState.blockNumber === undefined || !Number.isFinite(indexedState.blockNumber) || indexedState.blockNumber < 0) {
    return {
      primitive: "STATE_PARITY",
      name: config.name,
      status: "UNKNOWN",
      summary: `Indexed state key '${config.key}' does not expose a valid blockNumber for historical proof.`,
      evidence: { key: config.key, proofMode: "evm-call", classification: "INDEXED_BLOCK_UNAVAILABLE", indexed: indexedState },
    };
  }
  if (!canonical.getEvmCallProof) {
    return {
      primitive: "STATE_PARITY",
      name: config.name,
      status: "UNKNOWN",
      summary: "Canonical source cannot perform quorum-backed EVM call proofs.",
      observedAtBlock: indexedState.blockNumber,
      evidence: { key: config.key, proofMode: "evm-call", classification: "CANONICAL_CALL_UNSUPPORTED", blockNumber: indexedState.blockNumber },
    };
  }

  let data: string;
  let normalizedIndexed: string;
  try {
    const args = (proof.args ?? []).map((arg) => {
      const sourceValue = arg.indexedPath !== undefined ? getPath(indexedState.payload, arg.indexedPath) : arg.value;
      return encodeStaticWord(sourceValue, arg.type);
    });
    data = `${proof.selector.toLowerCase()}${args.join("")}`;
    normalizedIndexed = normalizeStaticValue(indexedState.value, proof.returnType);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      primitive: "STATE_PARITY",
      name: config.name,
      status: "UNKNOWN",
      summary: `Could not construct generic EVM state proof for '${config.key}'.`,
      observedAtBlock: indexedState.blockNumber,
      evidence: {
        key: config.key,
        proofMode: "evm-call",
        classification: "PROOF_INPUT_INVALID",
        blockNumber: indexedState.blockNumber,
        reason,
      },
    };
  }

  try {
    const canonicalState = await canonical.getEvmCallProof({
      to: proof.to,
      data,
      blockNumber: indexedState.blockNumber,
    });
    const normalizedCanonical = decodeStaticWord(canonicalState.value, proof.returnType);
    const equal = normalizedCanonical === normalizedIndexed;
    return {
      primitive: "STATE_PARITY",
      name: config.name,
      status: equal ? "PASS" : "FAIL",
      summary: equal
        ? `Indexed state matches canonical historical EVM call for '${config.key}'.`
        : `Indexed state diverges from canonical historical EVM call for '${config.key}'.`,
      observedAtBlock: indexedState.blockNumber,
      evidence: {
        key: config.key,
        proofMode: "evm-call",
        classification: equal ? "MATCH" : "VALUE_MISMATCH",
        blockNumber: indexedState.blockNumber,
        contract: proof.to.toLowerCase(),
        selector: proof.selector.toLowerCase(),
        returnType: proof.returnType,
        calldata: data,
        indexedValue: normalizedIndexed,
        canonicalValue: normalizedCanonical,
        indexedMetadata: indexedState.metadata,
        canonicalMetadata: canonicalState.metadata,
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      primitive: "STATE_PARITY",
      name: config.name,
      status: "UNKNOWN",
      summary: `Canonical historical EVM state could not be proven for '${config.key}'.`,
      observedAtBlock: indexedState.blockNumber,
      evidence: {
        key: config.key,
        proofMode: "evm-call",
        classification: "CANONICAL_PROOF_UNAVAILABLE",
        blockNumber: indexedState.blockNumber,
        contract: proof.to.toLowerCase(),
        selector: proof.selector.toLowerCase(),
        calldata: data,
        reason,
      },
    };
  }
}
