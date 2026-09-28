import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SnapshotSource } from "../core/source.js";
import type { EventRecord, HeadSnapshot, StateValue } from "../core/types.js";

interface TimelineEntry { fromBlock: number; value: string; }
interface FixtureDocument {
  head: HeadSnapshot;
  state?: Record<string, string>;
  stateBlocks?: Record<string, number>;
  stateTimeline?: Record<string, TimelineEntry[]>;
  events?: Record<string, EventRecord[]>;
  blockHashes?: Record<string, string>;
}

export class FixtureSource implements SnapshotSource {
  private constructor(private readonly doc: FixtureDocument) {}

  static async fromFile(file: string, baseDir: string): Promise<FixtureSource> {
    const path = resolve(baseDir, file);
    const raw = await readFile(path, "utf8");
    const doc = JSON.parse(raw) as FixtureDocument;
    if (!doc.head || !Number.isInteger(doc.head.blockNumber)) {
      throw new Error(`Invalid fixture: ${path} is missing head.blockNumber`);
    }
    return new FixtureSource(doc);
  }

  async getHead(): Promise<HeadSnapshot> {
    return structuredClone(this.doc.head);
  }

  async getBlockAt(blockNumber: number): Promise<HeadSnapshot | undefined> {
    const blockHash = this.doc.blockHashes?.[String(blockNumber)];
    if (blockHash === undefined) {
      if (blockNumber === this.doc.head.blockNumber && this.doc.head.blockHash) return structuredClone(this.doc.head);
      return undefined;
    }
    return { blockNumber, blockHash };
  }

  async getState(key: string): Promise<StateValue | undefined> {
    const timeline = this.doc.stateTimeline?.[key];
    if (timeline?.length) return this.getStateAt(key, this.doc.head.blockNumber);
    const value = this.doc.state?.[key];
    if (value === undefined) return undefined;
    return { key, value, blockNumber: this.doc.stateBlocks?.[key] ?? this.doc.head.blockNumber };
  }

  async getStateAt(key: string, blockNumber: number): Promise<StateValue | undefined> {
    const timeline = [...(this.doc.stateTimeline?.[key] ?? [])]
      .filter((entry) => entry.fromBlock <= blockNumber)
      .sort((a, b) => a.fromBlock - b.fromBlock);
    if (timeline.length) {
      const entry = timeline[timeline.length - 1];
      return { key, value: entry.value, blockNumber };
    }
    const value = this.doc.state?.[key];
    if (value === undefined) return undefined;
    return { key, value, blockNumber };
  }

  async getEvents(stream: string): Promise<EventRecord[]> {
    return structuredClone(this.doc.events?.[stream] ?? []);
  }

  async getEventsAt(stream: string, fromBlock: number, toBlock: number): Promise<EventRecord[]> {
    return structuredClone((this.doc.events?.[stream] ?? []).filter(
      (event) => event.blockNumber >= fromBlock && event.blockNumber <= toBlock,
    ));
  }
}
