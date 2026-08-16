import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compileContentPack, compilePresentation } from "./compiler.js";

const [sourcePath, themePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !themePath || !outputPath)
  throw new Error(
    "Usage: compile <content.json> <theme.json> <output-directory>",
  );

const source = JSON.parse(
  await readFile(resolve(sourcePath), "utf8"),
) as unknown;
const theme = JSON.parse(await readFile(resolve(themePath), "utf8")) as unknown;
const pack = compileContentPack(source);
const presentation = compilePresentation(pack, theme);
const outputDirectory = resolve(outputPath);
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(
    resolve(outputDirectory, "gameplay.json"),
    `${JSON.stringify(pack, null, 2)}\n`,
  ),
  writeFile(
    resolve(outputDirectory, "presentation.json"),
    `${JSON.stringify(presentation, null, 2)}\n`,
  ),
]);
console.log(
  JSON.stringify({
    packId: pack.source.manifest.packId,
    cards: pack.cards.length,
    gameplayHash: pack.gameplayHash,
    presentationHash: presentation.presentationHash,
  }),
);
