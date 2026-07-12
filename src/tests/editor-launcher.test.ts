import fs from "fs";
import os from "os";
import path from "path";
import { resolveEditorLineInvocation } from "../utils/editor-launcher";

function makeExecutable(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(filePath, 0o755);
}

describe("resolveEditorLineInvocation", () => {
  let rootDirectory: string;
  const workspaceDir = "/tmp/workspace";
  const filePath = "/tmp/workspace/prompts/demo.hjson";

  beforeEach(() => {
    rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "quickgpt-editor-"));
  });

  afterEach(() => {
    fs.rmSync(rootDirectory, { recursive: true, force: true });
  });

  it("uses --goto for VS Code family editors and skips tunnel binaries", () => {
    const appPath = path.join(rootDirectory, "Fake Code.app");
    makeExecutable(path.join(appPath, "Contents", "Resources", "app", "bin", "code"));
    makeExecutable(path.join(appPath, "Contents", "Resources", "app", "bin", "code-tunnel"));

    const invocation = resolveEditorLineInvocation(appPath, workspaceDir, filePath, 42);

    expect(invocation).toEqual({
      command: path.join(appPath, "Contents", "Resources", "app", "bin", "code"),
      args: [workspaceDir, "--goto", `${filePath}:42`],
    });
  });

  it("supports Cursor-style forks whose CLI is not named code", () => {
    const appPath = path.join(rootDirectory, "Dancer.app");
    makeExecutable(path.join(appPath, "Contents", "Resources", "app", "bin", "cursor"));
    makeExecutable(path.join(appPath, "Contents", "Resources", "app", "bin", "cursor-tunnel"));

    const invocation = resolveEditorLineInvocation(appPath, workspaceDir, filePath, 7);

    expect(invocation).toEqual({
      command: path.join(appPath, "Contents", "Resources", "app", "bin", "cursor"),
      args: [workspaceDir, "--goto", `${filePath}:7`],
    });
  });

  it("uses the subl CLI with file:line for Sublime Text", () => {
    const appPath = path.join(rootDirectory, "Sublime Text.app");
    makeExecutable(path.join(appPath, "Contents", "SharedSupport", "bin", "subl"));

    const invocation = resolveEditorLineInvocation(appPath, workspaceDir, filePath, 12);

    expect(invocation).toEqual({
      command: path.join(appPath, "Contents", "SharedSupport", "bin", "subl"),
      args: [workspaceDir, `${filePath}:12`],
    });
  });

  it("uses the bundled cli with file:line for Zed", () => {
    const appPath = path.join(rootDirectory, "Zed.app");
    makeExecutable(path.join(appPath, "Contents", "MacOS", "cli"));
    fs.writeFileSync(path.join(appPath, "Contents", "MacOS", "zed"), "binary");

    const invocation = resolveEditorLineInvocation(appPath, workspaceDir, filePath, 3);

    expect(invocation).toEqual({
      command: path.join(appPath, "Contents", "MacOS", "cli"),
      args: [workspaceDir, `${filePath}:3`],
    });
  });

  it("returns undefined for editors without a known line-capable CLI", () => {
    const appPath = path.join(rootDirectory, "TextEdit.app");
    fs.mkdirSync(path.join(appPath, "Contents", "MacOS"), { recursive: true });

    expect(resolveEditorLineInvocation(appPath, workspaceDir, filePath, 5)).toBeUndefined();
  });
});
