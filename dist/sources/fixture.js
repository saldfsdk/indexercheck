import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
export class FixtureSource {
    doc;
    constructor(doc) {
        this.doc = doc;
    }
    static async fromFile(file, baseDir) {
        const path = resolve(baseDir, file);
        const raw = await readFile(path, "utf8");
        const doc = JSON.parse(raw);
        if (!doc.head || !Number.isInteger(doc.head.blockNumber)) {
            throw new Error(`Invalid fixture: ${path} is missing head.blockNumber`);
        }
        return new FixtureSource(doc);
    }
    async getHead() {
        return structuredClone(this.doc.head);
    }
    async getBlockAt(blockNumber) {
        const blockHash = this.doc.blockHashes?.[String(blockNumber)];
        if (blockHash === undefined) {
            if (blockNumber === this.doc.head.blockNumber && this.doc.head.blockHash)
                return structuredClone(this.doc.head);
            return undefined;
        }
        return { blockNumber, blockHash };
    }
    async getState(key) {
        const timeline = this.doc.stateTimeline?.[key];
        if (timeline?.length)
            return this.getStateAt(key, this.doc.head.blockNumber);
        const value = this.doc.state?.[key];
        if (value === undefined)
            return undefined;
        return { key, value, blockNumber: this.doc.stateBlocks?.[key] ?? this.doc.head.blockNumber };
    }
    async getStateAt(key, blockNumber) {
        const timeline = [...(this.doc.stateTimeline?.[key] ?? [])]
            .filter((entry) => entry.fromBlock <= blockNumber)
            .sort((a, b) => a.fromBlock - b.fromBlock);
        if (timeline.length) {
            const entry = timeline[timeline.length - 1];
            return { key, value: entry.value, blockNumber };
        }
        const value = this.doc.state?.[key];
        if (value === undefined)
            return undefined;
        return { key, value, blockNumber };
    }
    async getEvents(stream) {
        return structuredClone(this.doc.events?.[stream] ?? []);
    }
    async getEventsAt(stream, fromBlock, toBlock) {
        return structuredClone((this.doc.events?.[stream] ?? []).filter((event) => event.blockNumber >= fromBlock && event.blockNumber <= toBlock));
    }
}
//# sourceMappingURL=fixture.js.map