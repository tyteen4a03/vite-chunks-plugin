import fs from "node:fs/promises";
import path from "node:path";

const rootDirectory = new URL(".", import.meta.url);
const distDirectory = path.join(rootDirectory.pathname, "dist");
const expectedOutputPath = path.join(rootDirectory.pathname, "expected-output.json");

const expectedOutput = JSON.parse(await fs.readFile(expectedOutputPath, "utf8"));
const manifest = JSON.parse(
  await fs.readFile(path.join(distDirectory, "chunks-manifest.json"), "utf8"),
);

for (const [entryName, entryExpectation] of Object.entries(expectedOutput.entries)) {
  const stylesFileName = path.join(distDirectory, "templates", `${entryName}-styles.html`);
  const scriptsFileName = path.join(distDirectory, "templates", `${entryName}-scripts.html`);

  const stylesHtml = await fs.readFile(stylesFileName, "utf8");
  const scriptsHtml = await fs.readFile(scriptsFileName, "utf8");

  for (const pattern of entryExpectation.styles.patterns) {
    if (!new RegExp(pattern).test(stylesHtml)) {
      throw new Error(`Style output for "${entryName}" does not match pattern: ${pattern}`);
    }
  }

  for (const pattern of entryExpectation.scripts.patterns) {
    if (!new RegExp(pattern).test(scriptsHtml)) {
      throw new Error(`Script output for "${entryName}" does not match pattern: ${pattern}`);
    }
  }

  const manifestEntry = manifest[entryName];
  if (!manifestEntry) {
    throw new Error(`Manifest entry "${entryName}" is missing.`);
  }

  if (JSON.stringify(manifestEntry.styles) !== JSON.stringify(entryExpectation.manifest.styles)) {
    throw new Error(`Manifest styles for "${entryName}" do not match expected output.`);
  }

  if (JSON.stringify(manifestEntry.scripts) !== JSON.stringify(entryExpectation.manifest.scripts)) {
    throw new Error(`Manifest scripts for "${entryName}" do not match expected output.`);
  }

  if (!Array.isArray(manifestEntry.preloads) || manifestEntry.preloads.length !== 1) {
    throw new Error(`Manifest preloads for "${entryName}" should contain exactly one item.`);
  }

  if (!new RegExp(entryExpectation.manifest.preloadsPattern).test(manifestEntry.preloads[0])) {
    throw new Error(`Manifest preload for "${entryName}" does not match the expected pattern.`);
  }
}

console.log("Example build verified.");
