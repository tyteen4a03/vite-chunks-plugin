# vite-chunks-plugin

`vite-chunks-plugin` recreates the core idea of
[`chunks-webpack-plugin`](https://github.com/yoriiis/chunks-webpack-plugin)
for Vite 8 builds.

It generates per-entry HTML partials for styles and scripts, plus an optional
`chunks-manifest.json`, so multi-entry apps can include the correct assets for
each entry.

## Installation

```bash
npm install -D vite-chunks-plugin
```

This package supports the same Node.js releases as Vite 8:
`^20.19.0 || >=22.12.0`.

## Usage

This plugin is meant for `vite build`, especially when you use explicit
multi-entry inputs via `build.rolldownOptions.input`.

```ts
import { defineConfig } from "vite";
import viteChunksPlugin from "vite-chunks-plugin";
import path from "node:path";

export default defineConfig({
  base: "/dist/",
  build: {
    outDir: "dist",
    cssCodeSplit: true,
    rolldownOptions: {
      input: {
        "shared/app-a": path.resolve("src/js/app-a.ts"),
        "app-b": path.resolve("src/js/app-b.ts"),
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
    }),
  ],
});
```

That build emits files like:

- `templates/shared/app-a-styles.html`
- `templates/shared/app-a-scripts.html`
- `templates/app-b-styles.html`
- `templates/app-b-scripts.html`
- `chunks-manifest.json`

## Example fixture

A publish-ready multi-entry example lives in `./example`.

Run it with:

```bash
npm run build:example
```

That command:

- builds this plugin package
- installs the local package into the example app
- runs the example Vite build
- verifies the generated output against `example/expected-output.json`

## Quality checks

This repo uses `oxfmt` for formatting and `oxlint` for linting.

```bash
npm run quality
```

That runs `oxfmt --check` and `oxlint --deny-warnings`.

To rewrite files into the expected format, run:

```bash
npm run format
```

After `npm install`, Husky installs a `pre-commit` hook in Git checkouts so
commits run `npm run quality` automatically.

## Default output

Styles partials render stylesheet links:

```html
<link rel="stylesheet" href="/dist/css/shared.css" /><link
  rel="stylesheet"
  href="/dist/css/app-a.css"
/>
```

Scripts partials are Vite-idiomatic: preload shared static dependencies, then
load the entry module itself.

```html
<link rel="modulepreload" href="/dist/js/shared-abc123.js" />
<script type="module" src="/dist/js/shared/app-a.js"></script>
```

## Options

### `filename`

Type: `string`

Default: `"[name]-[type].html"`

Controls where generated partials are written inside `build.outDir`. `[name]`
is replaced with the entry name and `[type]` with `styles` or `scripts`.

### `templateStyle`

Type: `(name: string, entryName: string) => string`

Default:

```ts
(name) => `<link rel="stylesheet" href="${name}" />`;
```

### `templatePreload`

Type: `(name: string, entryName: string) => string`

Default:

```ts
(name) => `<link rel="modulepreload" href="${name}" />`;
```

### `templateScript`

Type: `(name: string, entryName: string) => string`

Default:

```ts
(name) => `<script type="module" src="${name}"></script>`;
```

### `generateChunksManifest`

Type: `boolean`

Default: `false`

When enabled, the plugin emits `chunks-manifest.json`.

### `generateChunksFiles`

Type: `boolean`

Default: `true`

When set to `false`, the plugin skips HTML partial generation. This is useful
when you only want `chunks-manifest.json` for custom rendering.

## Manifest format

The Vite version adds `preloads` so shared module chunks can be represented
without pretending they should be loaded as independent entry scripts.

```json
{
  "shared/app-a": {
    "styles": ["/dist/css/shared.css", "/dist/css/app-a.css"],
    "scripts": ["/dist/js/shared/app-a.js"],
    "preloads": ["/dist/js/shared-abc123.js"]
  }
}
```

## Webpack-to-Vite translation notes

- This plugin only runs during `vite build`.
- Entry relationships are derived from the final Vite output bundle, not a
  Webpack compilation API.
- Shared JavaScript becomes module preload links plus one entry
  `<script type="module">`, instead of multiple script tags.
- When `base` is relative (`""` or `"./"`), generated HTML partials use paths
  relative to the partial file location, while the JSON manifest keeps raw
  output-relative file names.

## Current status

The package currently includes:

- the Vite 8 plugin implementation
- integration tests that run real `vite build`
- a publish-ready example fixture with output verification
