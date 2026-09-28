import { defineIndexerAdapter } from "indexercheck/sdk";

type LegacyRow = { id?: string; block: number; tx: string; log: number; contract?: string; kind?: string; payload?: Record<string, unknown> };
type Options = {
  headBlock?: number;
  rangeComplete?: boolean;
  events?: Record<string, LegacyRow[]>;
  states?: Record<string, { value: string | number; block: number; payload?: unknown }>;
};

export default defineIndexerAdapter<Options>({
  name: "example-typescript-indexer",
  create({ options }) {
    const normalize = (row: LegacyRow) => ({
      id: row.id,
      blockNumber: Number(row.block),
      transactionHash: row.tx.toLowerCase(),
      logIndex: Number(row.log),
      address: row.contract,
      eventName: row.kind,
      payload: row.payload ?? {},
    });
    return {
      getHead: () => ({ blockNumber: Number(options?.headBlock ?? 0), reportedHealthy: true, reportedSynced: true }),
      getState: (key) => {
        const row = options?.states?.[key];
        return row ? { value: row.value, blockNumber: Number(row.block), payload: row.payload ?? row } : undefined;
      },
      getEvents: (stream) => (options?.events?.[stream] ?? []).map(normalize),
      getEventsAt: (stream, { fromBlock, toBlock }) => ({
        events: (options?.events?.[stream] ?? []).map(normalize).filter((event) => event.blockNumber >= fromBlock && event.blockNumber <= toBlock),
        coverageProven: options?.rangeComplete === true,
      }),
    };
  },
});
