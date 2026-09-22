import fs from "fs";
import os from "os";
import path from "path";
import {
  buildPromptMapModel,
  buildSearchText,
  extractPlaceholders,
  findPromptMapNode,
  isInsideAny,
  loadPromptLibrary,
} from "../utils/prompt-map-model";

function makeLibrary(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "quickgpt-map-"));
  fs.writeFileSync(
    path.join(dir, "10 later.hjson"),
    `[
  { title: Later
    content: "Later body {{c}}"
  }
]`,
  );
  fs.writeFileSync(
    path.join(dir, "02 ask.hjson"),
    `{
rootProperty: { chs: "! 简体中文作答" }
title: Ask
icon: ❓
subprompts: [
  { title: 技术方案 生成
    prefix: chs
    content: "Plan {{i|s|c}} {{option:type}} {{file:./x.md}}"
    type: { "默认": "" , "拆分": "split" }
  }
  { title: Folder
    subprompts: [ { title: "Leaf" } ]
  }
]
}`,
  );
  fs.writeFileSync(path.join(dir, "broken.hjson"), "{ title: broken");
  fs.writeFileSync(path.join(dir, ".hidden.hjson"), "[ { title: Hidden } ]");
  return dir;
}

describe("prompt-map-model", () => {
  it("loads a directory, sorts files numerically and builds nodes with edit metadata", () => {
    const dir = makeLibrary();
    try {
      const library = loadPromptLibrary([dir]);
      expect(library.errors).toHaveLength(1);
      expect(library.errors[0].file).toContain("broken.hjson");

      const model = buildPromptMapModel(library.roots, { sourceDirs: [dir], editableRoots: [dir], editable: true });
      expect(model.editable).toBe(true);
      expect(model.files.map((file) => file.name)).toEqual(["02 ask", "10 later"]);
      expect(model.totals).toEqual({ files: 2, prompts: 5 });

      const ask = model.files[0].roots[0];
      expect(ask.key).toBe(`${path.join(dir, "02 ask.hjson")}#0`);
      expect(ask.readonly).toBe(false);
      expect(ask.content).toBe("");
      expect(ask.children).toHaveLength(2);

      const plan = ask.children[0];
      expect(plan.indexPath).toEqual([0, 0]);
      expect(plan.placeholders).toEqual(["i", "s", "c", "opt", "file"]);
      expect(plan.prefix).toEqual([{ key: "chs", text: "! 简体中文作答" }]);
      expect(plan.options).toEqual([{ key: "type", values: ["默认", "拆分"] }]);
      expect(plan.ownContent).toContain("Plan");
      expect(plan.py).toContain("jsfa");
      expect(plan.line).toBe(6);

      const leaf = findPromptMapNode(model, `${path.join(dir, "02 ask.hjson")}#0.1.0`);
      expect(leaf?.title).toBe("Leaf");
      expect(leaf?.path).toBe("Ask / Folder / Leaf");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("marks files outside the editable roots as read-only", () => {
    const dir = makeLibrary();
    try {
      const library = loadPromptLibrary([dir]);
      const model = buildPromptMapModel(library.roots, { sourceDirs: [dir], editableRoots: [], editable: true });
      expect(model.files.every((file) => file.readonly)).toBe(true);
      expect(model.files[0].roots[0].children[0].readonly).toBe(true);

      const snapshot = buildPromptMapModel(library.roots, { sourceDirs: [dir], editableRoots: [dir], editable: false });
      expect(snapshot.editable).toBe(false);
      expect(snapshot.files.every((file) => file.readonly)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("builds pinyin search text with full readings and initials", () => {
    expect(buildSearchText("技术方案 生成")).toBe("jishufanganshengcheng jsfasc");
    expect(buildSearchText("Ask")).toBe("ask");
  });

  it("extracts short placeholder chips", () => {
    expect(extractPlaceholders("{{i|s|c}} {{input}} {{option:x}} {{content:./a}} {{customProp}}")).toEqual([
      "i",
      "s",
      "c",
      "opt",
      "file",
    ]);
    expect(extractPlaceholders(undefined)).toEqual([]);
  });

  it("checks directory containment", () => {
    expect(isInsideAny("/lib/a/b.hjson", ["/lib/a"])).toBe(true);
    expect(isInsideAny("/lib/a-archive/b.hjson", ["/lib/a"])).toBe(false);
    expect(isInsideAny("/lib/a", ["/lib/a"])).toBe(true);
  });
});
