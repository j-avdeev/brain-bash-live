import { access, copyFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const pagesDir = join(projectRoot, "dist", "client");
const indexFile = join(pagesDir, "index.html");
const fallbackFile = join(pagesDir, "404.html");
const noJekyllFile = join(pagesDir, ".nojekyll");

try {
  await access(indexFile);
} catch {
  throw new Error(`Missing ${indexFile}. Run the GitHub Pages build before creating the fallback.`);
}

await copyFile(indexFile, fallbackFile);
await writeFile(noJekyllFile, "");

console.log("Created dist/client/404.html and dist/client/.nojekyll for GitHub Pages.");
