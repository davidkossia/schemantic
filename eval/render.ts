/**
 * Render problem drawings and graph charts to SVG, then PNG.
 *
 * Run with `npm run render`. Writes eval/images/<id>.svg and <id>.png for every circuit drawing (60 px grid)
 * and every graph (1200 by 800), then copies the c01, c09 and g01 PNGs to web/public/samples/.
 */
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import { renderChart } from "../src/core/chart";
import { renderDrawing } from "../src/core/schematic";
import { PROBLEMS } from "./problems/index";

const here = dirname(fileURLToPath(import.meta.url));
const imagesDir = join(here, "images");
const samplesDir = join(here, "..", "web", "public", "samples");
const SAMPLE_IDS = ["c01", "c09", "g01"];

mkdirSync(imagesDir, { recursive: true });

const CHART_SIZE = { width: 1200, height: 800 };

function writeImages(id: string, svg: string): void {
  writeFileSync(join(imagesDir, `${id}.svg`), svg);
  const png = new Resvg(svg, {
    fitTo: { mode: "width", value: 1200 },
    background: "white",
    font: { loadSystemFonts: true },
  })
    .render()
    .asPng();
  writeFileSync(join(imagesDir, `${id}.png`), png);
}

let count = 0;
for (const p of PROBLEMS) {
  if (p.truth.kind === "graph") {
    writeImages(p.id, renderChart(p.truth, CHART_SIZE));
    count += 1;
  } else if (p.drawing) {
    writeImages(p.id, renderDrawing(p.drawing, p.style));
    count += 1;
  }
}

mkdirSync(samplesDir, { recursive: true });
for (const id of SAMPLE_IDS) {
  copyFileSync(join(imagesDir, `${id}.png`), join(samplesDir, `${id}.png`));
}

console.log(`Rendered ${count} images to ${imagesDir}`);
