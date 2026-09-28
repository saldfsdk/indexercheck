import { DEFAULT_POLYMARKET_DATA_URLS, polymarketStatusUrl } from "../live/polymarket-data-api.js";

const url = polymarketStatusUrl(process.env.INDEXERCHECK_POLYMARKET_DATA_URL ?? DEFAULT_POLYMARKET_DATA_URLS[0]);
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 15_000);
try {
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "indexercheck-m1.4.4" }, signal: controller.signal });
  const text = await response.text();
  if (!response.ok) throw new Error(`Polymarket status HTTP ${response.status}: ${text.slice(0, 500)}`);
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  console.log(`Polymarket Data API status — ${url}`);
  console.log(JSON.stringify(body, null, 2));
} finally {
  clearTimeout(timer);
}
