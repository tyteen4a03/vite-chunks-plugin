import path from "node:path";
import { defineConfig } from "vite";
import viteChunksPlugin from "vite-chunks-plugin";

export default defineConfig({
  base: "/dist/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    cssCodeSplit: true,
    modulePreload: {
      polyfill: false,
    },
    rolldownOptions: {
      input: {
        "shared/app-a": path.resolve("src/js/app-a.ts"),
        "app-b": path.resolve("src/js/app-b.ts"),
        "app-c": path.resolve("src/js/app-c.ts"),
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
  plugins: [
    viteChunksPlugin({
      filename: "templates/[name]-[type].html",
      generateChunksManifest: true,
      templateStyle: (name, entryName) =>
        `<link data-entry="${entryName}" rel="stylesheet" href="https://example.com${name}" />`,
      templatePreload: (name, entryName) =>
        `<link data-entry="${entryName}" rel="modulepreload" href="https://example.com${name}" />`,
      templateScript: (name, entryName) =>
        `<script data-entry="${entryName}" type="module" src="https://example.com${name}"></script>`,
    }),
  ],
});
