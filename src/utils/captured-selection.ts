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
export const WECHAT_BUNDLE_ID = "com.tencent.xinWeChat";

// Request the selection and its source before the command's UI takes focus.
const selectedTextPromise = getSelectedText().catch(() => "");
export const sourceApplicationPromise = getFrontmostApplication().catch(() => undefined);
export const capturedFinderItemsPromise = getSelectedFinderItems().catch(() => []);
let webSelection: Promise<string> | undefined;

export async function getCapturedSelectedText(source: Application | undefined): Promise<string> {
  const text = await selectedTextPromise;
  if (text.trim()) return text;
  if (!source?.bundleId) return "";
  const isWeChat = source.bundleId === WECHAT_BUNDLE_ID;
  if (!isWeChat && !existsSync(path.join(source.path, "Contents/Frameworks/Electron Framework.framework"))) {
    return "";
  }

  // One capture per launch. Let the WeChat reader finish restoring the pasteboard.
  webSelection ??= execFileAsync(
    "/usr/bin/osascript",
    ["-l", "JavaScript", path.join(environment.assetsPath, "read-web-selection.jxa"), source.bundleId],
    { timeout: isWeChat ? 0 : 2000, maxBuffer: 16 * 1024 * 1024 },
  )
    .then(({ stdout }) => stdout.replace(/\n$/, ""))
    .catch(() => "");
  return webSelection;
}
