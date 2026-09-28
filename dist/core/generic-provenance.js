import { SourceUnavailableError, isSourceUnavailableError } from "./source.js";
function getPath(obj, path) {
    return path.split(".").filter(Boolean).reduce((value, key) => {
        if (value === null || value === undefined || typeof value !== "object")
            return undefined;
        return value[key];
    }, obj);
}
export function parseStaticType(type) {
    if (type === "address")
        return { kind: "address" };
    if (type === "bool")
        return { kind: "bool" };
    const uint = /^uint(\d+)$/.exec(type);
    if (uint) {
        const bits = Number(uint[1]);
        if (bits >= 8 && bits <= 256 && bits % 8 === 0)
            return { kind: "uint", bits };
    }
    const int = /^int(\d+)$/.exec(type);
    if (int) {
        const bits = Number(int[1]);
        if (bits >= 8 && bits <= 256 && bits % 8 === 0)
            return { kind: "int", bits };
    }
    const bytes = /^bytes(\d+)$/.exec(type);
    if (bytes) {
        const size = Number(bytes[1]);
        if (size >= 1 && size <= 32)
            return { kind: "bytes", bytes: size };
    }
    throw new Error(`Unsupported static ABI type '${type}'. M2.0 supports address, bool, uint8..uint256, int8..int256, bytes1..bytes32.`);
}
function wordHex(raw) {
    const value = String(raw ?? "").toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(value))
        throw new Error(`Expected 32-byte ABI word, got '${value}'`);
    return value.slice(2);
}
export function decodeStaticWord(raw, type) {
    const parsed = parseStaticType(type);
    const hex = wordHex(raw);
    if (parsed.kind === "address")
        return `0x${hex.slice(-40)}`;
    if (parsed.kind === "bool")
        return BigInt(`0x${hex}`) === 0n ? "false" : "true";
    if (parsed.kind === "uint")
        return BigInt(`0x${hex}`).toString(10);
    if (parsed.kind === "int") {
        const unsigned = BigInt(`0x${hex}`);
        const two256 = 1n << 256n;
        const signed = unsigned >= (1n << 255n) ? unsigned - two256 : unsigned;
        return signed.toString(10);
    }
    const bytes = parsed.bytes ?? 32;
    return `0x${hex.slice(0, bytes * 2)}`;
}
export function normalizeStaticValue(value, type) {
    const parsed = parseStaticType(type);
    if (value === undefined || value === null)
        throw new Error("indexed value is missing");
    if (parsed.kind === "address") {
        const text = String(value).toLowerCase();
        if (!/^0x[0-9a-f]{40}$/.test(text))
            throw new Error(`indexed address '${text}' is invalid`);
        return text;
    }
    if (parsed.kind === "bool") {
        if (typeof value === "boolean")
            return value ? "true" : "false";
        const text = String(value).toLowerCase();
        if (text === "true" || text === "1" || text === "0x1")
            return "true";
        if (text === "false" || text === "0" || text === "0x0")
            return "false";
        throw new Error(`indexed bool '${text}' is invalid`);
    }
    if (parsed.kind === "uint" || parsed.kind === "int")
        return BigInt(String(value)).toString(10);
    const text = String(value).toLowerCase();
    const expected = (parsed.bytes ?? 32) * 2;
    if (!new RegExp(`^0x[0-9a-f]{${expected}}$`).test(text))
        throw new Error(`indexed ${type} '${text}' is invalid`);
    return text;
}
export function encodeStaticWord(value, type) {
    const parsed = parseStaticType(type);
    if (value === undefined || value === null)
        throw new Error(`ABI ${type} value is missing`);
    if (parsed.kind === "address") {
        const normalized = normalizeStaticValue(value, type).slice(2);
        return normalized.padStart(64, "0");
    }
    if (parsed.kind === "bool")
        return (normalizeStaticValue(value, type) === "true" ? "1" : "0").padStart(64, "0");
    if (parsed.kind === "uint") {
        const n = BigInt(normalizeStaticValue(value, type));
        const bits = BigInt(parsed.bits ?? 256);
        if (n < 0n || n >= (1n << bits))
            throw new Error(`ABI ${type} value '${value}' is out of range`);
        return n.toString(16).padStart(64, "0");
    }
    if (parsed.kind === "int") {
        const n = BigInt(normalizeStaticValue(value, type));
        const bits = BigInt(parsed.bits ?? 256);
        const min = -(1n << (bits - 1n));
        const max = (1n << (bits - 1n)) - 1n;
        if (n < min || n > max)
            throw new Error(`ABI ${type} value '${value}' is out of range`);
        const encoded = n < 0n ? (1n << 256n) + n : n;
        return encoded.toString(16).padStart(64, "0");
    }
    const normalized = normalizeStaticValue(value, type).slice(2);
    return normalized.padEnd(64, "0");
}
function canonicalArgs(event, inputs) {
    const payload = event.payload ?? {};
    const topics = Array.isArray(payload.topics) ? payload.topics : [];
    const data = String(payload.data ?? "0x").toLowerCase();
    const dataHex = data.startsWith("0x") ? data.slice(2) : data;
    if (dataHex.length % 64 !== 0 || !/^[0-9a-f]*$/.test(dataHex))
        throw new Error("canonical event data is not ABI word-aligned hex");
    let indexedOffset = 1;
    let dataOffset = 0;
    const result = {};
    for (const input of inputs) {
        parseStaticType(input.type);
        if (input.indexed) {
            const topic = topics[indexedOffset++];
            if (topic === undefined)
                throw new Error(`canonical topic missing for indexed input '${input.name}'`);
            result[input.name] = decodeStaticWord(topic, input.type);
        }
        else {
            const start = dataOffset * 64;
            const word = dataHex.slice(start, start + 64);
            if (word.length !== 64)
                throw new Error(`canonical data word missing for input '${input.name}'`);
            result[input.name] = decodeStaticWord(`0x${word}`, input.type);
            dataOffset += 1;
        }
    }
    return result;
}
function eventKey(event) {
    if (!event.txHash || event.logIndex === undefined)
        return undefined;
    return `${event.txHash.toLowerCase()}:${event.logIndex}`;
}
export async function genericEvmLogProvenance(canonical, indexed, config) {
    const proof = config.proof;
    if (!proof || proof.type !== "evm-log")
        throw new Error("genericEvmLogProvenance requires an evm-log proof");
    if (!canonical.getEventsAt && !canonical.getEventsAtWithEvidence)
        throw new Error("Canonical source does not support historical event reads required by evm-log provenance");
    const canonicalStream = proof.canonicalStream ?? config.stream;
    const minSamples = Math.max(1, config.minSamples ?? 1);
    const sampleSize = Math.max(minSamples, proof.sampleSize ?? minSamples);
    let indexedRows;
    try {
        indexedRows = (await indexed.getEvents(config.stream)).slice(0, sampleSize);
    }
    catch (error) {
        throw new SourceUnavailableError("indexed", `getEvents(${config.stream})`, error);
    }
    const blockCache = new Map();
    const fetchBlock = (blockNumber) => {
        let pending = blockCache.get(blockNumber);
        if (!pending) {
            pending = canonical.getEventsAtWithEvidence
                ? canonical.getEventsAtWithEvidence(canonicalStream, blockNumber, blockNumber)
                : canonical.getEventsAt(canonicalStream, blockNumber, blockNumber).then((events) => ({ events }));
            blockCache.set(blockNumber, pending);
        }
        return pending;
    };
    const failures = [];
    const rows = [];
    let verified = 0;
    let observedAtBlock;
    for (const row of indexedRows) {
        observedAtBlock = observedAtBlock === undefined ? row.blockNumber : Math.max(observedAtBlock, row.blockNumber);
        const baseEvidence = {
            id: row.id,
            transactionHash: row.txHash,
            logIndex: row.logIndex,
            blockNumber: row.blockNumber,
        };
        try {
            if (!Number.isFinite(row.blockNumber))
                throw new Error("indexed blockNumber is missing or invalid");
            if (!row.txHash)
                throw new Error("indexed transactionHash is missing");
            if (row.logIndex === undefined || !Number.isFinite(row.logIndex))
                throw new Error("indexed logIndex is missing or invalid");
            let canonicalBlock;
            try {
                canonicalBlock = await fetchBlock(row.blockNumber);
            }
            catch (error) {
                throw new SourceUnavailableError("canonical", `getEventsAt(${canonicalStream},${row.blockNumber})`, error);
            }
            const key = eventKey(row);
            const event = canonicalBlock.events.find((candidate) => eventKey(candidate) === key);
            if (!event)
                throw new Error(`canonical log ${key} not found in stream '${canonicalStream}' at block ${row.blockNumber}`);
            if (event.blockNumber !== row.blockNumber)
                throw new Error(`canonical block mismatch indexed=${row.blockNumber} canonical=${event.blockNumber}`);
            if (row.address && event.address && row.address.toLowerCase() !== event.address.toLowerCase())
                throw new Error(`canonical address mismatch indexed=${row.address} canonical=${event.address}`);
            const fieldEvidence = {};
            if (proof.inputs?.length) {
                const decoded = canonicalArgs(event, proof.inputs);
                for (const input of proof.inputs) {
                    const path = input.indexedPath ?? input.name;
                    const indexedValue = normalizeStaticValue(getPath(row.payload, path), input.type);
                    const canonicalValue = decoded[input.name];
                    const ok = indexedValue === canonicalValue;
                    fieldEvidence[input.name] = { type: input.type, indexed: indexedValue, canonical: canonicalValue, ok };
                    if (!ok)
                        throw new Error(`event field '${input.name}' mismatch indexed=${indexedValue} canonical=${canonicalValue}`);
                }
            }
            verified += 1;
            rows.push({
                ...baseEvidence,
                status: "PASS",
                canonicalAddress: event.address,
                fields: fieldEvidence,
                rpcQuorum: canonicalBlock.metadata?.rpcQuorum,
            });
        }
        catch (error) {
            if (isSourceUnavailableError(error))
                throw error;
            const reason = error instanceof Error ? error.message : String(error);
            failures.push({ transactionHash: row.txHash, reason });
            rows.push({ ...baseEvidence, status: "FAIL", failure: reason });
        }
    }
    return {
        stream: config.stream,
        sampled: indexedRows.length,
        verified,
        failures,
        observedAtBlock,
        metadata: {
            proofMode: "evm-log",
            canonicalStream,
            sampleSize,
            inputs: proof.inputs ?? [],
            rows,
        },
    };
}
//# sourceMappingURL=generic-provenance.js.map