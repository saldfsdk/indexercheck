export const GOLDSKY_EULER_MAINNET_GRAPHQL = "https://api.goldsky.com/api/public/project_cm4iagnemt1wp01xn4gh1agft/subgraphs/euler-simple-mainnet/latest/gn";

// M1.5.2: provenance needs historical eth_call, so the production pool is
// intentionally archive-capable rather than merely head/receipt-capable.
export const DEFAULT_ETHEREUM_RPC_URLS = [
  "https://eth.drpc.org",
  "https://gateway.tenderly.co/public/mainnet",
  "https://eth.merkle.io",
];
