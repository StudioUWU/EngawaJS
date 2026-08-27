import { readdir, readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "vite";

const ENGAWA_PROTOCOL = "engawaui.event";
const root = fileURLToPath(new URL("../tests/vite", import.meta.url));
const output = await mkdtemp(join(tmpdir(), "engawa-vite-"));

try {
  await build({
    root,
    configFile: false,
    logLevel: "silent",
    build: {
      target: "es2020",
      outDir: output,
      emptyOutDir: false,
    },
  });
  const assets = await readdir(join(output, "assets"));
  const scripts = assets.filter((name) => name.endsWith(".js"));
  const bundled = await Promise.all(
    scripts.map((name) => readFile(join(output, "assets", name), "utf8")),
  );
  if (!bundled.some((source) => source.includes(ENGAWA_PROTOCOL))) {
    throw new Error("The Vite consumer omitted Engawa.");
  }
} finally {
  await rm(output, { recursive: true, force: true });
}
