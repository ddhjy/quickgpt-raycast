import type { Application } from "@raycast/api";
import { placeholderFormatter, resolvePlaceholders } from "../utils/placeholder-formatter";

const byter: Application = {
  name: "Byter",
  path: "/Applications/Byter.app",
  bundleId: "com.todesktop.230313mzl4w4u92.byter",
};
const mockExecFile = jest.fn();

jest.mock("@raycast/api", () => ({
  environment: { assetsPath: "/assets" },
  getSelectedText: jest.fn(),
  getFrontmostApplication: jest.fn(),
  getSelectedFinderItems: jest.fn().mockResolvedValue([]),
}));
jest.mock("node:child_process", () => ({ execFile: (...args: unknown[]) => mockExecFile(...args) }));
jest.mock("node:fs", () => ({
  existsSync: (file: string) => file === "/Applications/Byter.app/Contents/Frameworks/Electron Framework.framework",
}));

async function launch(selectedText: string | Error, app: Application = byter) {
  const api = await import("@raycast/api");
  jest.mocked(api.getFrontmostApplication).mockResolvedValue(app);
  if (selectedText instanceof Error) {
    jest.mocked(api.getSelectedText).mockRejectedValue(selectedText);
  } else {
    jest.mocked(api.getSelectedText).mockResolvedValue(selectedText);
  }
  const { sourceApplicationPromise, getCapturedSelectedText } = await import("../utils/captured-selection");
  return getCapturedSelectedText(await sourceApplicationPromise);
}

beforeEach(() => {
  jest.resetModules();
  mockExecFile.mockReset();
});

it("uses Raycast's selection directly when it is available", async () => {
  await expect(launch("Native selection")).resolves.toBe("Native selection");
  expect(mockExecFile).not.toHaveBeenCalled();
});

it.each([new Error("No selected text"), "  "])("recovers the Electron selection for the template", async (missing) => {
  const transcript = "第一段\n\n最后一段";
  mockExecFile.mockImplementation((_file, _args, _options, callback) => callback(null, { stdout: transcript + "\n" }));

  const selection = await launch(missing);
  expect(mockExecFile.mock.calls[0][1]).toEqual([
    "-l",
    "JavaScript",
    "/assets/read-electron-selection.jxa",
    byter.bundleId,
  ]);
  expect(resolvePlaceholders("{{i|s|c}}", { selection })).toEqual(new Set(["selection"]));
  expect(placeholderFormatter("{{i|s|c}}", { selection, clipboard: "older copy" })).toBe(transcript);
});

it("keeps the clipboard fallback when neither source has a selection", async () => {
  mockExecFile.mockImplementation((_file, _args, _options, callback) => callback(null, { stdout: "\n" }));
  const selection = await launch("");
  expect(selection).toBe("");
  expect(resolvePlaceholders("{{i|s|c}}", { selection })).toEqual(new Set(["clipboard"]));
});

it("skips the Electron reader for other applications", async () => {
  const finder = { name: "Finder", path: "/System/Library/CoreServices/Finder.app", bundleId: "com.apple.finder" };
  await expect(launch("", finder)).resolves.toBe("");
  expect(mockExecFile).not.toHaveBeenCalled();
});
