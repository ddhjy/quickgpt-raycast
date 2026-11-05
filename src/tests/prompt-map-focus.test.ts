import fs from "fs";
import os from "os";
import path from "path";
import { buildPromptMapModel, findPromptMapNode, loadPromptLibrary, promptMapNodeKey } from "../utils/prompt-map-model";
import { FOCUS_PARAM, withFocusParam } from "../utils/prompt-map-launcher";

describe("Prompt Map focus", () => {
  it("builds the node key the model uses from a prompt's file and index path", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quickgpt-focus-"));
    try {
      const file = path.join(dir, "ask #1.hjson");
      fs.writeFileSync(
        file,
        `{
title: Ask
subprompts: [
  { title: "A" }
  { title: "B", content: "b" }
]
}`,
      );
      const library = loadPromptLibrary([dir]);
      expect(library.errors).toEqual([]);
      const leaf = library.roots[0].subprompts![1];
      const model = buildPromptMapModel(library.roots, { sourceDirs: [dir], editableRoots: [dir], editable: true });

      const key = promptMapNodeKey(leaf.filePath!, leaf.sourceIndexPath ?? []);
      expect(key).toBe(`${file}#0.1`);
      expect(findPromptMapNode(model, key)?.title).toBe("B");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("adds the focus key to server and file URLs and round-trips reserved characters", () => {
    const key = "/Users/me/prompts/a b#?&.hjson#0.2";
    const server = withFocusParam("http://127.0.0.1:4000/?t=abc", key);
    expect(new URL(server).searchParams.get("t")).toBe("abc");
    expect(new URL(server).searchParams.get(FOCUS_PARAM)).toBe(key);

    const file = withFocusParam("file:///tmp/prompt-map.html", key);
    expect(new URL(file).pathname).toBe("/tmp/prompt-map.html");
    expect(new URL(file).searchParams.get(FOCUS_PARAM)).toBe(key);
  });

  it("leaves the URL unchanged without a focus key", () => {
    expect(withFocusParam("http://127.0.0.1:4000/?t=abc")).toBe("http://127.0.0.1:4000/?t=abc");
  });
});
