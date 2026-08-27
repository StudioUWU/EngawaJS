import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const sourcePath = fileURLToPath(new URL("../dist/index.d.ts", import.meta.url));
const outputPath = fileURLToPath(new URL("../dist/index.d.cts", import.meta.url));
const source = await readFile(sourcePath, "utf8");
const output = source.replace(/\r?\n\/\/# sourceMappingURL=index\.d\.ts\.map\s*$/, "");
await writeFile(outputPath, output, "utf8");
