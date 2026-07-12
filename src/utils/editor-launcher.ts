/**
 * Opens prompt files in the user's configured editor, jumping to the line
 * where the prompt is defined when the editor supports line navigation.
 *
 * Line navigation is implemented through the CLI helpers bundled inside the
 * editor app bundles, so it works for any VS Code fork (VS Code, Cursor,
 * Windsurf, Dancer, ...) as well as Zed and Sublime Text without hardcoding
 * app names. Editors without a known CLI fall back to the plain `open`
 * behavior (workspace directory + file, no line).
 */

import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { findRepoRoot } from "./git-utils";

const execFileAsync = promisify(execFile);

export interface EditorAppInfo {
  name?: string;
  path?: string;
  bundleId?: string;
}

export interface EditorInvocation {
  command: string;
  args: string[];
}

function isExecutableFile(candidatePath: string): boolean {
  try {
    const stat = fs.statSync(candidatePath);
    if (!stat.isFile()) {
      return false;
    }
    fs.accessSync(candidatePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * VS Code forks ship their CLI helpers in `Contents/Resources/app/bin`
 * (e.g. `code`, `cursor`), all supporting `--goto file:line`.
 */
function findVSCodeFamilyCli(appPath: string): string | undefined {
  const binDir = path.join(appPath, "Contents", "Resources", "app", "bin");
  let entries: string[];
  try {
    entries = fs.readdirSync(binDir);
  } catch {
    return undefined;
  }

  const candidates = entries.filter((entry) => !entry.endsWith("-tunnel") && !entry.includes(".")).sort();
  for (const candidate of candidates) {
    const candidatePath = path.join(binDir, candidate);
    if (isExecutableFile(candidatePath)) {
      return candidatePath;
    }
  }
  return undefined;
}

/**
 * Resolves a CLI invocation that opens `filePath` at `line` (1-based) with the
 * workspace directory loaded, or undefined when the editor has no known CLI.
 */
export function resolveEditorLineInvocation(
  appPath: string,
  workspaceDir: string,
  filePath: string,
  line: number,
): EditorInvocation | undefined {
  const fileWithLine = `${filePath}:${line}`;

  const vsCodeFamilyCli = findVSCodeFamilyCli(appPath);
  if (vsCodeFamilyCli) {
    return { command: vsCodeFamilyCli, args: [workspaceDir, "--goto", fileWithLine] };
  }

  const sublimeCli = path.join(appPath, "Contents", "SharedSupport", "bin", "subl");
  if (isExecutableFile(sublimeCli)) {
    return { command: sublimeCli, args: [workspaceDir, fileWithLine] };
  }

  const zedCli = path.join(appPath, "Contents", "MacOS", "cli");
  if (isExecutableFile(zedCli)) {
    return { command: zedCli, args: [workspaceDir, fileWithLine] };
  }

  return undefined;
}

export interface OpenPromptFileResult {
  /** True when the file was opened at the requested line via a CLI. */
  openedAtLine: boolean;
}

/**
 * Opens a prompt file in the given editor. When `line` is provided and the
 * editor exposes a supported CLI, the file is opened at that line; otherwise
 * this falls back to opening the workspace directory and file via `open`.
 *
 * The returned flag reflects what actually happened, so callers can adapt
 * (e.g. only copy the prompt title for manual searching when no line jump
 * was possible).
 */
export async function openPromptFileWithEditor(
  editor: EditorAppInfo,
  filePath: string,
  line?: number,
): Promise<OpenPromptFileResult> {
  const repoRoot = await findRepoRoot(filePath);
  const workspaceDir = repoRoot ?? path.dirname(filePath);

  if (line && line > 0 && editor.path) {
    const invocation = resolveEditorLineInvocation(editor.path, workspaceDir, filePath, line);
    if (invocation) {
      try {
        await execFileAsync(invocation.command, invocation.args);
        return { openedAtLine: true };
      } catch (error) {
        console.error("Editor line navigation failed, falling back to open:", error);
      }
    }
  }

  const openArgs =
    editor.bundleId && editor.bundleId.trim() !== ""
      ? ["-b", editor.bundleId, workspaceDir, filePath]
      : ["-a", editor.path ?? editor.name ?? "", workspaceDir, filePath];
  await execFileAsync("open", openArgs);
  return { openedAtLine: false };
}
