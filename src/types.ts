export type TemplateFunction = (name: string, entryName: string) => string;

export type ChunksManifestItem = {
  styles: string[];
  scripts: string[];
  preloads: string[];
};

export type ChunksManifest = Record<string, ChunksManifestItem>;

export type ViteChunksPluginOptions = {
  filename: string;
  templateStyle: TemplateFunction;
  templateScript: TemplateFunction;
  templatePreload: TemplateFunction;
  generateChunksManifest: boolean;
  generateChunksFiles: boolean;
};
