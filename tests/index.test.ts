import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { build, type InlineConfig } from "vite";
import viteChunksPlugin, { type ViteChunksPluginOptions } from "../src/index.js";

const TEMP_DIRECTORIES: string[] = [];

afterEach(async () => {
  await Promise.all(
    TEMP_DIRECTORIES.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("vite-chunks-plugin", { timeout: 15000 }, () => {
  it("emits per-entry partials and a chunks manifest for absolute bases", async () => {
    const { distDirectory, readDistFile, readManifest } = await buildFixture({
      base: "/dist/",
      pluginOptions: {
        filename: "templates/[name]-[type].html",
        generateChunksManifest: true,
      },
    });

    await expect(pathExists(path.join(distDirectory, "templates"))).resolves.toBe(true);

    const manifest = await readManifest();
    expect(Object.keys(manifest)).toEqual(["app-b", "shared/app-a"]);
    expect(manifest["shared/app-a"]).toMatchObject({
      styles: ["/dist/css/shared.css", "/dist/css/app-a.css"],
      scripts: ["/dist/js/shared/app-a.js"],
    });
    expect(manifest["shared/app-a"].preloads).toHaveLength(1);
    expect(manifest["shared/app-a"].preloads[0]).toMatch(/^\/dist\/js\/shared-.*\.js$/);
    expect(manifest["app-b"]).toMatchObject({
      styles: ["/dist/css/shared.css", "/dist/css/app-b.css"],
      scripts: ["/dist/js/app-b.js"],
    });

    await expect(readDistFile("templates/shared/app-a-styles.html")).resolves.toBe(
      '<link rel="stylesheet" href="/dist/css/shared.css" /><link rel="stylesheet" href="/dist/css/app-a.css" />',
    );

    await expect(readDistFile("templates/shared/app-a-scripts.html")).resolves.toMatch(
      /^<link rel="modulepreload" href="\/dist\/js\/shared-.*\.js" \/><script type="module" src="\/dist\/js\/shared\/app-a\.js"><\/script>$/,
    );

    await expect(readDistFile("templates/app-b-scripts.html")).resolves.toMatch(
      /^<link rel="modulepreload" href="\/dist\/js\/shared-.*\.js" \/><script type="module" src="\/dist\/js\/app-b\.js"><\/script>$/,
    );
  });

  it("uses relative asset paths in generated html when the Vite base is relative", async () => {
    const { readDistFile, readManifest } = await buildFixture({
      base: "./",
      pluginOptions: {
        filename: "templates/[name]-[type].html",
        generateChunksManifest: true,
      },
    });

    await expect(readDistFile("templates/shared/app-a-styles.html")).resolves.toBe(
      '<link rel="stylesheet" href="../../css/shared.css" /><link rel="stylesheet" href="../../css/app-a.css" />',
    );

    await expect(readDistFile("templates/shared/app-a-scripts.html")).resolves.toMatch(
      /^<link rel="modulepreload" href="\.\.\/\.\.\/js\/shared-.*\.js" \/><script type="module" src="\.\.\/\.\.\/js\/shared\/app-a\.js"><\/script>$/,
    );

    const manifest = await readManifest();
    expect(manifest["shared/app-a"]).toMatchObject({
      styles: ["css/shared.css", "css/app-a.css"],
      scripts: ["js/shared/app-a.js"],
    });
    expect(manifest["shared/app-a"].preloads[0]).toMatch(/^js\/shared-.*\.js$/);
  });

  it("can emit only the manifest when chunk files generation is disabled", async () => {
    const { distDirectory, listDistFiles, readManifest } = await buildFixture({
      base: "/dist/",
      pluginOptions: {
        filename: "templates/[name]-[type].html",
        generateChunksManifest: true,
        generateChunksFiles: false,
      },
    });

    const files = await listDistFiles();
    expect(files).not.toContain("templates/app-b-scripts.html");
    expect(files).not.toContain("templates/shared/app-a-scripts.html");
    expect(files).toContain("chunks-manifest.json");

    const manifest = await readManifest();
    expect(manifest["app-b"].scripts).toEqual(["/dist/js/app-b.js"]);
    await expect(pathExists(path.join(distDirectory, "templates"))).resolves.toBe(false);
  });

  it("supports custom style, preload, and script templates", async () => {
    const { readDistFile } = await buildFixture({
      base: "/dist/",
      pluginOptions: {
        filename: "templates/[name]-[type].html",
        templateStyle: (name, entryName) =>
          `<link data-entry="${entryName}" rel="stylesheet" href="${name}" />`,
        templatePreload: (name, entryName) =>
          `<link data-entry="${entryName}" rel="modulepreload" href="${name}" />`,
        templateScript: (name, entryName) =>
          `<script data-entry="${entryName}" type="module" src="${name}"></script>`,
      },
    });

    await expect(readDistFile("templates/shared/app-a-styles.html")).resolves.toBe(
      '<link data-entry="shared/app-a" rel="stylesheet" href="/dist/css/shared.css" /><link data-entry="shared/app-a" rel="stylesheet" href="/dist/css/app-a.css" />',
    );

    await expect(readDistFile("templates/shared/app-a-scripts.html")).resolves.toMatch(
      /^<link data-entry="shared\/app-a" rel="modulepreload" href="\/dist\/js\/shared-.*\.js" \/><script data-entry="shared\/app-a" type="module" src="\/dist\/js\/shared\/app-a\.js"><\/script>$/,
    );
  });
});

async function buildFixture({
  base,
  pluginOptions,
}: {
  base: string;
  pluginOptions?: Partial<ViteChunksPluginOptions>;
}) {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "vite-chunks-plugin-fixture-"));
  TEMP_DIRECTORIES.push(rootDirectory);

  await writeFixtureFiles(rootDirectory);

  const config: InlineConfig = {
    configFile: false,
    root: rootDirectory,
    logLevel: "silent",
    base,
    build: {
      outDir: "dist",
      emptyOutDir: true,
      cssCodeSplit: true,
      modulePreload: {
        polyfill: false,
      },
      rolldownOptions: {
        input: {
          "shared/app-a": path.resolve(rootDirectory, "src/js/app-a.ts"),
          "app-b": path.resolve(rootDirectory, "src/js/app-b.ts"),
        },
        output: {
          entryFileNames: "js/[name].js",
          chunkFileNames: "js/[name]-[hash].js",
          assetFileNames: (assetInfo) => {
            const names = assetInfo.names ?? [];
            if (names.some((name) => name.endsWith(".css"))) {
              return "css/[name].css";
            }

            return "assets/[name]-[hash][extname]";
          },
        },
      },
    },
    plugins: [viteChunksPlugin(pluginOptions)],
  };

  await build(config);

  const distDirectory = path.join(rootDirectory, "dist");

  return {
    distDirectory,
    readDistFile: (relativePath: string) =>
      readFile(path.join(distDirectory, relativePath), "utf8"),
    readManifest: async () =>
      JSON.parse(
        await readFile(path.join(distDirectory, "chunks-manifest.json"), "utf8"),
      ) as Record<string, { styles: string[]; scripts: string[]; preloads: string[] }>,
    listDistFiles: async () => listRelativeFiles(distDirectory),
  };
}

async function writeFixtureFiles(rootDirectory: string): Promise<void> {
  const files: Record<string, string> = {
    "src/js/shared.ts": `
      import "../css/shared.css";
      export const shared = "shared";
    `,
    "src/js/app-a.ts": `
      import "./shared";
      import "../css/app-a.css";
      console.log("app-a");
    `,
    "src/js/app-b.ts": `
      import "./shared";
      import "../css/app-b.css";
      console.log("app-b");
    `,
    "src/css/shared.css": `
      .shared {
        color: red;
      }
    `,
    "src/css/app-a.css": `
      .app-a {
        color: blue;
      }
    `,
    "src/css/app-b.css": `
      .app-b {
        color: green;
      }
    `,
  };

  await Promise.all(
    Object.entries(files).map(async ([relativePath, contents]) => {
      const filePath = path.join(rootDirectory, relativePath);
      await ensureDirectory(path.dirname(filePath));
      await writeFile(filePath, `${contents.trim()}\n`, "utf8");
    }),
  );
}

async function ensureDirectory(directoryPath: string): Promise<void> {
  await mkdir(directoryPath, { recursive: true });
}

async function listRelativeFiles(directoryPath: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        const fullPath = path.join(directoryPath, entry.name);

        if (entry.isDirectory()) {
          return listRelativeFiles(fullPath, relativePath);
        }

        return [relativePath];
      }),
  );

  return nested.flat();
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
