import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build as bundle } from "esbuild";
import { build as buildRenderer } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");
const output = resolve(appRoot, "dist");

await rm(output, { recursive: true, force: true });

await Promise.all([
  bundle({
    entryPoints: [resolve(appRoot, "src/main/index.ts")],
    outfile: resolve(output, "main/index.js"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    sourcemap: true,
    external: ["electron"],
    logLevel: "info",
  }),
  bundle({
    entryPoints: [resolve(appRoot, "src/preload/index.ts")],
    outfile: resolve(output, "preload/index.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    sourcemap: true,
    external: ["electron"],
    logLevel: "info",
  }),
  buildRenderer({
    root: resolve(appRoot, "src/renderer"),
    base: "./",
    build: {
      outDir: resolve(output, "renderer"),
      emptyOutDir: false,
      sourcemap: true,
    },
  }),
]);
