import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

type PackageJson = {
  engines?: {
    node?: string;
  };
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const ROOT_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("package metadata", () => {
  it("supports the same Node.js releases as Vite 8", async () => {
    const packageJson = await readPackageJson("package.json");
    const vitePackageJson = await readPackageJson("node_modules/vite/package.json");

    expect(packageJson.engines?.node).toBe(vitePackageJson.engines?.node);
  });

  it("keeps Vite 8 as the supported major in package metadata", async () => {
    const packageJson = await readPackageJson("package.json");
    const examplePackageJson = await readPackageJson("example/package.json");

    expect(packageJson.peerDependencies?.vite).toMatch(/^\^8(?:\.|$)/);
    expect(examplePackageJson.devDependencies?.vite).toMatch(/^\^8(?:\.|$)/);
    expect(examplePackageJson.engines?.node).toBe(packageJson.engines?.node);
  });
});

async function readPackageJson(relativePath: string): Promise<PackageJson> {
  return JSON.parse(await readFile(path.join(ROOT_DIRECTORY, relativePath), "utf8")) as PackageJson;
}
