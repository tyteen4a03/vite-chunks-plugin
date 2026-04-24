import path from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import type {
  ChunksManifest,
  TemplateFunction,
  ViteChunksPluginOptions,
} from "./types.js";

type OutputBundleLike = Record<string, OutputBundleEntryLike>;

type OutputBundleEntryLike = OutputAssetLike | OutputChunkLike;

type OutputAssetLike = {
  type: "asset";
  fileName: string;
};

type OutputChunkLike = {
  type: "chunk";
  fileName: string;
  name: string;
  isEntry: boolean;
  imports: string[];
  dynamicImports: string[];
  viteMetadata?: {
    importedCss?: Iterable<string>;
    importedAssets?: Iterable<string>;
  };
};

type EntryOutput = {
  entryName: string;
  styles: string[];
  scripts: string[];
  preloads: string[];
};

const DEFAULT_OPTIONS: ViteChunksPluginOptions = {
  filename: "[name]-[type].html",
  templateStyle: (name) => `<link rel="stylesheet" href="${name}" />`,
  templateScript: (name) => `<script type="module" src="${name}"></script>`,
  templatePreload: (name) => `<link rel="modulepreload" href="${name}" />`,
  generateChunksManifest: false,
  generateChunksFiles: true,
};

const MANIFEST_FILE_NAME = "chunks-manifest.json";
const VALID_OPTION_KEYS = new Set<keyof ViteChunksPluginOptions>([
  "filename",
  "templateStyle",
  "templateScript",
  "templatePreload",
  "generateChunksManifest",
  "generateChunksFiles",
]);

export function viteChunksPlugin(userOptions: Partial<ViteChunksPluginOptions> = {}): Plugin {
  const options = resolveOptions(userOptions);
  let config: ResolvedConfig | undefined;

  return {
    name: "vite-chunks-plugin",
    apply: "build",
    configResolved(resolvedConfig) {
      config = resolvedConfig;
    },
    generateBundle(_outputOptions, bundle) {
      if (!config || config.build.ssr) {
        return;
      }

      const bundleLike = bundle as OutputBundleLike;
      const entries = getEntryOutputs(bundleLike);

      if (entries.length === 0) {
        return;
      }

      const generatedFiles = new Set<string>();
      const manifest: ChunksManifest = {};

      for (const entry of entries) {
        manifest[entry.entryName] = {
          styles: toManifestUrls(entry.styles, config.base),
          scripts: toManifestUrls(entry.scripts, config.base),
          preloads: toManifestUrls(entry.preloads, config.base),
        };

        if (!options.generateChunksFiles) {
          continue;
        }

        if (entry.styles.length > 0) {
          emitPartialFile({
            plugin: this,
            bundle: bundleLike,
            generatedFiles,
            fileName: renderOutputFileName(options.filename, entry.entryName, "styles"),
            html: renderTags(
              options.templateStyle,
              toHtmlUrls(
                entry.styles,
                config.base,
                renderOutputFileName(options.filename, entry.entryName, "styles"),
              ),
              entry.entryName,
            ),
          });
        }

        if (entry.preloads.length > 0 || entry.scripts.length > 0) {
          const scriptsFileName = renderOutputFileName(
            options.filename,
            entry.entryName,
            "scripts",
          );

          const html =
            renderTags(
              options.templatePreload,
              toHtmlUrls(entry.preloads, config.base, scriptsFileName),
              entry.entryName,
            ) +
            renderTags(
              options.templateScript,
              toHtmlUrls(entry.scripts, config.base, scriptsFileName),
              entry.entryName,
            );

          emitPartialFile({
            plugin: this,
            bundle: bundleLike,
            generatedFiles,
            fileName: scriptsFileName,
            html,
          });
        }
      }

      if (options.generateChunksManifest) {
        ensureFileNameAvailable(MANIFEST_FILE_NAME, bundleLike, generatedFiles);
        this.emitFile({
          type: "asset",
          fileName: MANIFEST_FILE_NAME,
          source: JSON.stringify(manifest, null, 2),
        });
        generatedFiles.add(MANIFEST_FILE_NAME);
      }
    },
  };
}

export default viteChunksPlugin;
export type {
  ChunksManifest,
  ChunksManifestItem,
  TemplateFunction,
  ViteChunksPluginOptions,
} from "./types.js";

function resolveOptions(userOptions: Partial<ViteChunksPluginOptions>): ViteChunksPluginOptions {
  validateOptions(userOptions);

  return {
    ...DEFAULT_OPTIONS,
    ...userOptions,
  };
}

function validateOptions(userOptions: Partial<ViteChunksPluginOptions>): void {
  for (const key of Object.keys(userOptions)) {
    if (!VALID_OPTION_KEYS.has(key as keyof ViteChunksPluginOptions)) {
      throw new TypeError(`vite-chunks-plugin received an unknown option: "${key}".`);
    }
  }

  if (userOptions.filename !== undefined) {
    throw new TypeError(`"filename" must be a string.`);
  }

  validateTemplateOption("templateStyle", userOptions.templateStyle);
  validateTemplateOption("templateScript", userOptions.templateScript);
  validateTemplateOption("templatePreload", userOptions.templatePreload);

  if (
    userOptions.generateChunksManifest !== undefined
  ) {
    throw new TypeError(`"generateChunksManifest" must be a boolean.`);
  }

  if (userOptions.generateChunksFiles !== undefined) {
    throw new TypeError(`"generateChunksFiles" must be a boolean.`);
  }
}

function validateTemplateOption(
  key: "templateStyle" | "templateScript" | "templatePreload",
  value: TemplateFunction | undefined,
): void {
  if (value !== undefined && typeof value !== "function") {
    throw new TypeError(`"${key}" must be a function.`);
  }
}

function getEntryOutputs(bundle: OutputBundleLike): EntryOutput[] {
  const chunks = Object.values(bundle)
    .filter(isChunk)
    .sort((left, right) => left.fileName.localeCompare(right.fileName));

  const chunkByFileName = new Map(chunks.map((chunk) => [chunk.fileName, chunk] as const));

  return chunks
    .filter((chunk) => chunk.isEntry)
    .map((entryChunk) => {
      const importedChunks = collectImportedChunks(entryChunk, chunkByFileName);
      const styles = collectStyles(importedChunks, entryChunk);

      return {
        entryName: entryChunk.name,
        styles,
        scripts: [entryChunk.fileName],
        preloads: importedChunks.map((chunk) => chunk.fileName),
      };
    });
}

function isChunk(entry: OutputBundleEntryLike): entry is OutputChunkLike {
  return entry.type === "chunk";
}

function collectImportedChunks(
  entryChunk: OutputChunkLike,
  chunkByFileName: Map<string, OutputChunkLike>,
): OutputChunkLike[] {
  const visited = new Set<string>();
  const collected: OutputChunkLike[] = [];

  const visit = (fileName: string): void => {
    if (visited.has(fileName)) {
      return;
    }
    visited.add(fileName);

    const chunk = chunkByFileName.get(fileName);
    if (!chunk) {
      return;
    }

    collected.push(chunk);

    for (const importedFileName of chunk.imports) {
      visit(importedFileName);
    }
  };

  for (const importedFileName of entryChunk.imports) {
    visit(importedFileName);
  }

  return collected;
}

function collectStyles(importedChunks: OutputChunkLike[], entryChunk: OutputChunkLike): string[] {
  const styles = new Set<string>();

  for (const chunk of [...importedChunks, entryChunk]) {
    for (const importedCss of chunk.viteMetadata?.importedCss ?? []) {
      styles.add(importedCss);
    }
  }

  return [...styles];
}

function renderOutputFileName(
  filenameTemplate: string,
  entryName: string,
  type: "styles" | "scripts",
): string {
  const rendered = filenameTemplate
    .replaceAll("[name]", entryName)
    .replaceAll("[type]", type)
    .replaceAll("\\", "/");

  const normalized = path.posix.normalize(rendered).replace(/^\/+/, "");

  if (normalized === "" || normalized === ".") {
    throw new Error("Generated filename cannot be empty.");
  }

  return normalized;
}

function toManifestUrls(fileNames: string[], base: string): string[] {
  if (isRelativeBase(base)) {
    return [...fileNames];
  }

  const normalizedBase = ensureTrailingSlash(base);
  return fileNames.map((fileName) => `${normalizedBase}${fileName}`);
}

function toHtmlUrls(fileNames: string[], base: string, partialFileName: string): string[] {
  if (!isRelativeBase(base)) {
    const normalizedBase = ensureTrailingSlash(base);
    return fileNames.map((fileName) => `${normalizedBase}${fileName}`);
  }

  const partialDirectory = path.posix.dirname(partialFileName);
  const relativePath =
    partialDirectory === "." ? "" : ensureTrailingSlash(path.posix.relative(partialDirectory, "."));

  return fileNames.map((fileName) => `${relativePath}${fileName}`);
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function isRelativeBase(base: string): boolean {
  return base === "" || base === "./";
}

function renderTags(template: TemplateFunction, urls: string[], entryName: string): string {
  return urls.map((url) => template(url, entryName)).join("");
}

function emitPartialFile({
  plugin,
  bundle,
  generatedFiles,
  fileName,
  html,
}: {
  plugin: PluginContextLike;
  bundle: OutputBundleLike;
  generatedFiles: Set<string>;
  fileName: string;
  html: string;
}): void {
  ensureFileNameAvailable(fileName, bundle, generatedFiles);
  plugin.emitFile({
    type: "asset",
    fileName,
    source: html,
  });
  generatedFiles.add(fileName);
}

function ensureFileNameAvailable(
  fileName: string,
  bundle: OutputBundleLike,
  generatedFiles: Set<string>,
): void {
  if (generatedFiles.has(fileName) || bundle[fileName] !== undefined) {
    throw new Error(
      `vite-chunks-plugin cannot emit "${fileName}" because that output file already exists.`,
    );
  }
}

type PluginContextLike = {
  emitFile(file: { type: "asset"; fileName: string; source: string }): void;
};
