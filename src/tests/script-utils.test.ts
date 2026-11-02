import fs from "fs";
import os from "os";
import path from "path";
import { getCachedScripts, refreshScripts } from "../utils/script-utils";

describe("script directory scanning", () => {
  let directory: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "quickgpt-scripts-"));
    fs.mkdirSync(path.join(directory, "nested"));
    fs.writeFileSync(path.join(directory, "Alpha.applescript"), "return 1");
    fs.writeFileSync(path.join(directory, "nested", "Beta.scpt"), "compiled");
    fs.writeFileSync(path.join(directory, "ignored.txt"), "ignored");
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it("finds scripts recursively and caches a complete scan", async () => {
    const scripts = await refreshScripts([directory]);

    expect(scripts).toEqual(
      expect.arrayContaining([
        { path: path.join(directory, "Alpha.applescript"), name: "Alpha" },
        { path: path.join(directory, "nested", "Beta.scpt"), name: "Beta" },
      ]),
    );
    expect(scripts).toHaveLength(2);
    expect(getCachedScripts([directory])).toEqual(scripts);
  });

  it("returns and preserves a matching cache when a refresh is incomplete", async () => {
    const nestedDirectory = path.join(directory, "nested");
    const cachedScripts = await refreshScripts([directory]);
    fs.writeFileSync(path.join(directory, "Gamma.applescript"), "return 3");
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    fs.chmodSync(nestedDirectory, 0o000);

    try {
      await expect(refreshScripts([directory])).resolves.toEqual(cachedScripts);
      expect(getCachedScripts([directory])).toEqual(cachedScripts);
    } finally {
      fs.chmodSync(nestedDirectory, 0o755);
      consoleErrorSpy.mockRestore();
    }
  });

  it("returns partial readable results without caching an incomplete first scan", async () => {
    const nestedDirectory = path.join(directory, "nested");
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    fs.chmodSync(nestedDirectory, 0o000);

    try {
      const expected = [{ path: path.join(directory, "Alpha.applescript"), name: "Alpha" }];
      await expect(refreshScripts([directory])).resolves.toEqual(expected);
      expect(getCachedScripts([directory])).toBeUndefined();
    } finally {
      fs.chmodSync(nestedDirectory, 0o755);
      consoleErrorSpy.mockRestore();
    }
  });
});
