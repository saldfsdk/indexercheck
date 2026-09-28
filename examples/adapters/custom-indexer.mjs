import { defineIndexerAdapter } from "indexercheck/sdk";

function normalizeEvent(row) {
  return {
    id: row.id,
    blockNumber: Number(row.block),
    transactionHash: String(row.tx).toLowerCase(),
    logIndex: Number(row.log),
    address: row.contract,
    eventName: row.kind,
    payload: row.payload ?? {},
  };
}

export default defineIndexerAdapter({
  name: "example-legacy-indexer",
  async create({ options }) {
    const data = options ?? {};
    const maybeFail = (operation) => {
      if (data.failOperation === operation) throw new Error(`example adapter forced ${operation} failure`);
    };
    return {
      async getHead() {
        maybeFail("head");
        return { blockNumber: Number(data.headBlock ?? 0), reportedHealthy: true, reportedSynced: true };
      },
      async getState(key) {
        maybeFail("state");
        const row = data.states?.[key];
        if (!row) return undefined;
        return { value: row.value, blockNumber: Number(row.block), payload: row.payload ?? row, metadata: { normalizedBy: "example-legacy-indexer" } };
      },
      async getEvents(stream) {
        maybeFail("events");
        return (data.events?.[stream] ?? []).map(normalizeEvent);
      },
      async getEventsAt(stream, { fromBlock, toBlock }) {
        maybeFail("range");
        const events = (data.events?.[stream] ?? []).map(normalizeEvent).filter((event) => event.blockNumber >= fromBlock && event.blockNumber <= toBlock);
        return { events, coverageProven: data.rangeComplete === true, metadata: { sourceWindow: `${fromBlock}-${toBlock}` } };
      },
    };
  },
});
