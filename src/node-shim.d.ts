declare const process: any;

declare module "node:fs/promises" {
  export function readFile(path: string, encoding: string): Promise<string>;
  export function writeFile(path: string, data: string, encoding: string): Promise<void>;
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  export function unlink(path: string): Promise<void>;
  export function appendFile(path: string, data: string, encoding: string): Promise<void>;
  export function rename(oldPath: string, newPath: string): Promise<void>;
}

declare module "node:path" {
  export function resolve(...paths: string[]): string;
  export function dirname(path: string): string;
  export function extname(path: string): string;
}

declare module "node:test" {
  const test: (name: string, fn: () => void | Promise<void>) => void;
  export default test;
}

declare module "node:assert/strict" {
  const assert: {
    equal(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
  };
  export default assert;
}

declare module "node:url" {
  export function fileURLToPath(url: URL | string): string;
  export function pathToFileURL(path: string): URL;
}

declare module "node:http" {
  export function createServer(handler: (req: any, res: any) => void | Promise<void>): any;
}


declare module "node:child_process" {
  export function spawnSync(command: string, args?: string[], options?: any): any;
  export function spawn(command: string, args?: string[], options?: any): any;
}


declare module "node:crypto" {
  export function createHash(algorithm: string): { update(data: string): any; digest(encoding: "hex"): string; };
  export function createHmac(algorithm: string, key: string): {
    update(data: string): any;
    digest(encoding: "hex"): string;
  };
}


declare module "node:module" {
  export const stripTypeScriptTypes: any;
}
