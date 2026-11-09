import {
  environment,
  getFrontmostApplication,
  getSelectedFinderItems,
  getSelectedText,
  type Application,
} from "@raycast/api";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// Request the selection and its source before the command's UI takes focus.
const selectedTextPromise = getSelectedText().catch(() => "");
export const sourceApplicationPromise = getFrontmostApplication().catch(() => undefined);
export const capturedFinderItemsPromise = getSelectedFinderItems().catch(() => []);

export async function getCapturedSelectedText(source: Application | undefined): Promise<string> {
  const text = await selectedTextPromise;
  if (text.trim()) return text;
  if (!source?.bundleId || !existsSync(path.join(source.path, "Contents/Frameworks/Electron Framework.framework"))) {
    return "";
  }

  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/osascript",
      ["-l", "JavaScript", path.join(environment.assetsPath, "read-electron-selection.jxa"), source.bundleId],
      { timeout: 2000, maxBuffer: 16 * 1024 * 1024 },
    );
    // osascript appends a newline to its result, including for an empty string.
    return stdout.replace(/\n$/, "");
  } catch {
    return "";
  }
}
