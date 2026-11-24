import { environment } from "@raycast/api";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function readScreenText(): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/osascript",
      ["-l", "JavaScript", path.join(environment.assetsPath, "read-screen-text.jxa")],
      { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 },
    );
    return stdout.replace(/\n$/, "");
  } catch (error) {
    const { stderr, killed } = error as { stderr?: string; killed?: boolean };
    if (stderr?.includes("AX_PERMISSION_REQUIRED")) {
      throw new Error("Allow Raycast in System Settings → Privacy & Security → Accessibility, then try again.");
    }
    if (killed || stderr?.includes("AX_READ_TIMEOUT")) {
      throw new Error("Reading visible text timed out. Reopen Prompt Lab to try again.");
    }
    throw new Error("Couldn't read visible text with macOS Accessibility.");
  }
}
