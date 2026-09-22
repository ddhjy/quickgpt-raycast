import fs from "fs";
import path from "path";
import * as hjson from "hjson";
import {
  addChild,
  deletePrompt,
  needsQuotes,
  promptTree,
  resolvePrompt,
  scan,
  updateFields,
  valueOf,
  type PromptShadow,
} from "../utils/hjson-edit";

type Raw = Record<string, unknown> & { subprompts?: unknown[] };

const FIXTURE_FILES = [
  "assets/prompts.hjson",
  "assets/starter-library.hjson",
  "example/prompt/prompt-template.hjson",
].map((relative) => path.join(__dirname, "..", "..", relative));

const INLINE_LIBRARY = `# Library header comment
[
  "not a prompt"
  { title: Ask, then act
    icon: ❓
    count: 5, // literal followed by a comment
    subprompts: [
      # section marker
      { title: Quick
        content: "Answer briefly: {{i}}"
      }
      { content: 模拟一个实际场景来演示怎么使用吧
      }
      { title: 'single quoted'
        "quoted key": value
        content:
        '''
        Line one {{s|c}}

          indented line
        Line three # not a comment
        '''
        type: {
          "默认": ""
          "拆分": "split it"
        }
      }
    ]
  }
  {
    title: Folder without content
    subprompts: [
      { title: "Leaf A" }
    ]
  }
]
`;

const SINGLE_OBJECT = `{
rootProperty: {
  chs: "! 简体中文作答"
}
title: Root prompt
prefix: chs
content:
'''
Body {{i}}
'''
}
`;

function parsedPrompts(parsed: unknown): { item: Raw; rawIndex: number }[] {
  if (Array.isArray(parsed)) {
    return parsed.map((item, rawIndex) => ({ item, rawIndex })).filter(({ item }) => item && typeof item === "object");
  }
  if (parsed && typeof parsed === "object") {
    const record = parsed as Raw & { prompts?: unknown[] };
    if (Array.isArray(record.prompts)) {
      return record.prompts
        .map((item, rawIndex) => ({ item: item as Raw, rawIndex }))
        .filter(({ item }) => item && typeof item === "object");
    }
    if (record.title || typeof record.content === "string") return [{ item: record, rawIndex: 0 }];
  }
  return [];
}

function getAt(parsed: unknown, indexPath: number[]): Raw {
  let list = parsedPrompts(parsed);
  let node: Raw | undefined;
  for (const index of indexPath) {
    const entry = list.find((candidate) => candidate.rawIndex === index);
    if (!entry) throw new Error(`missing ${JSON.stringify(indexPath)}`);
    node = entry.item;
    list = Array.isArray(node.subprompts)
      ? node.subprompts
          .map((sub, rawIndex) => ({ item: sub as Raw, rawIndex }))
          .filter(({ item }) => item && typeof item === "object")
      : [];
  }
  if (!node) throw new Error("empty index path");
  return node;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function walk(
  parsedList: { item: Raw; rawIndex: number }[],
  shadowList: PromptShadow[],
  prefix: number[],
  visit: (item: Raw, shadow: PromptShadow | undefined, indexPath: number[]) => void,
): void {
  for (const { item, rawIndex } of parsedList) {
    const shadow = shadowList.find((candidate) => candidate.rawIndex === rawIndex);
    const indexPath = [...prefix, rawIndex];
    visit(item, shadow, indexPath);
    if (!shadow) continue;
    const subs = Array.isArray(item.subprompts)
      ? item.subprompts
          .map((sub, i) => ({ item: sub as Raw, rawIndex: i }))
          .filter(({ item: sub }) => sub && typeof sub === "object")
      : [];
    walk(subs, shadow.children, indexPath, visit);
  }
}

function allIndexPaths(text: string): { indexPath: number[]; item: Raw }[] {
  const parsed = hjson.parse(text);
  const result: { indexPath: number[]; item: Raw }[] = [];
  walk(parsedPrompts(parsed), promptTree(scan(text)), [], (item, shadow, indexPath) => {
    expect(shadow).toBeDefined();
    result.push({ indexPath, item });
  });
  return result;
}

const fixtures: { name: string; text: string }[] = [
  { name: "inline library", text: INLINE_LIBRARY },
  { name: "single object", text: SINGLE_OBJECT },
  ...FIXTURE_FILES.map((file) => ({ name: path.basename(file), text: fs.readFileSync(file, "utf8") })),
];

describe("hjson-edit scanner", () => {
  it.each(fixtures)("decodes the same titles and contents as hjson.parse for $name", ({ text }) => {
    const parsed = hjson.parse(text);
    let visited = 0;
    walk(parsedPrompts(parsed), promptTree(scan(text)), [], (item, shadow) => {
      expect(shadow).toBeDefined();
      visited += 1;
      for (const key of ["title", "content"] as const) {
        if (typeof item[key] === "string") expect(valueOf(shadow as PromptShadow, key)).toBe(item[key]);
      }
    });
    expect(visited).toBeGreaterThan(0);
  });

  it("keeps non-object array items in the raw index", () => {
    const tree = promptTree(scan(INLINE_LIBRARY));
    expect(tree.map((node) => node.rawIndex)).toEqual([1, 2]);
    expect(valueOf(tree[0], "title")).toBe("Ask, then act");
    expect(valueOf(tree[0].children[1], "content")).toBe("模拟一个实际场景来演示怎么使用吧");
    expect(valueOf(tree[0].children[2], "title")).toBe("single quoted");
  });
});

describe("hjson-edit updateFields", () => {
  it("replaces only the content span and keeps every other byte", () => {
    const indexPath = [1, 2];
    const before = resolvePrompt(INLINE_LIBRARY, indexPath);
    const member = before.obj.members.find((m) => m.key === "content");
    expect(member?.value.kind).toBe("mlstring");
    const next = updateFields(INLINE_LIBRARY, indexPath, { content: "New body\n\n  keep indent\nend" });
    const start = member!.value.start;
    const tail = INLINE_LIBRARY.length - member!.value.end;
    expect(next.slice(0, start)).toBe(INLINE_LIBRARY.slice(0, start));
    expect(next.slice(next.length - tail)).toBe(INLINE_LIBRARY.slice(member!.value.end));
    expect(getAt(hjson.parse(next), indexPath).content).toBe("New body\n\n  keep indent\nend");
    expect(next).toContain("# section marker");
    expect(next).toContain("// literal followed by a comment");
  });

  it("inserts a title before a derived-title prompt and keeps its content", () => {
    const next = updateFields(INLINE_LIBRARY, [1, 1], { title: "演示场景" });
    const prompt = getAt(hjson.parse(next), [1, 1]);
    expect(prompt.title).toBe("演示场景");
    expect(prompt.content).toBe("模拟一个实际场景来演示怎么使用吧");
  });

  it("adds content to a folder right after its title", () => {
    const next = updateFields(INLINE_LIBRARY, [2], { content: "Shared instructions\nsecond line" });
    const prompt = getAt(hjson.parse(next), [2]);
    expect(prompt.content).toBe("Shared instructions\nsecond line");
    expect(next.indexOf("title: Folder without content")).toBeLessThan(next.indexOf("Shared instructions"));
  });

  it("quotes titles hjson would otherwise misread", () => {
    const next = updateFields(INLINE_LIBRARY, [1, 0], { title: "3, go" });
    expect(next).toContain('title: "3, go"');
    expect(getAt(hjson.parse(next), [1, 0]).title).toBe("3, go");
  });

  it("edits the root prompt of a single-object file with rootProperty", () => {
    const next = updateFields(SINGLE_OBJECT, [0], { title: "Renamed", content: "Line 1\nLine 2" });
    const parsed = hjson.parse(next) as Raw & { rootProperty: Raw };
    expect(parsed.title).toBe("Renamed");
    expect(parsed.content).toBe("Line 1\nLine 2");
    expect(parsed.rootProperty.chs).toBe("! 简体中文作答");
  });
});

describe("hjson-edit addChild and deletePrompt", () => {
  it("appends a child to an existing subprompts array in the file's style", () => {
    const { text, indexPath } = addChild(INLINE_LIBRARY, [1], { title: "新提示词", content: "内容 {{i}}\n第二行" });
    expect(indexPath).toEqual([1, 3]);
    const added = getAt(hjson.parse(text), indexPath);
    expect(added.title).toBe("新提示词");
    expect(added.content).toBe("内容 {{i}}\n第二行");
    expect(text).toContain("      { title: 新提示词\n        content:\n        '''");
  });

  it("creates a subprompts array when a leaf gets its first child", () => {
    const { text, indexPath } = addChild(INLINE_LIBRARY, [1, 0], { title: "Child", content: "" });
    expect(indexPath).toEqual([1, 0, 0]);
    const parent = getAt(hjson.parse(text), [1, 0]);
    expect(Array.isArray(parent.subprompts)).toBe(true);
    expect((parent.subprompts as Raw[])[0].title).toBe("Child");
    expect(parent.content).toBe("Answer briefly: {{i}}");
  });

  it("removes a prompt together with its line and nothing else", () => {
    const next = deletePrompt(INLINE_LIBRARY, [1, 1]);
    const parsed = hjson.parse(next) as unknown[];
    const subprompts = (parsed[1] as Raw).subprompts as Raw[];
    expect(subprompts.map((prompt) => prompt.title ?? prompt.content)).toEqual(["Quick", "single quoted"]);
    expect(next).not.toContain("模拟一个实际场景");
    expect(next).toContain("# section marker");
  });

  it("refuses to delete the whole file", () => {
    expect(() => deletePrompt(SINGLE_OBJECT, [0])).toThrow(/whole file/);
  });
});

describe("hjson-edit round trips on every prompt", () => {
  it.each(fixtures)("update, add and delete re-parse to the expected structure for $name", ({ text }) => {
    const parsed = hjson.parse(text);
    const canDelete = Array.isArray(parsed) || (parsed && Array.isArray((parsed as { prompts?: unknown }).prompts));
    const newContent = "第一行 {{i|s|c}}\n\n  缩进的一行 (with 'single' quotes)\n结尾 # 不是注释";
    for (const { indexPath, item } of allIndexPaths(text)) {
      const expectedContent = structuredClone(parsed);
      getAt(expectedContent, indexPath).content = newContent;
      expect(canonical(hjson.parse(updateFields(text, indexPath, { content: newContent })))).toBe(
        canonical(expectedContent),
      );

      const newTitle = `${typeof item.title === "string" ? item.title : "无标题"} ✎`;
      const expectedTitle = structuredClone(parsed);
      getAt(expectedTitle, indexPath).title = newTitle;
      expect(canonical(hjson.parse(updateFields(text, indexPath, { title: newTitle })))).toBe(canonical(expectedTitle));

      const added = addChild(text, indexPath, { title: "New: child, one", content: "Body {{s}}" });
      const expectedAdd = structuredClone(parsed);
      const target = getAt(expectedAdd, indexPath);
      if (!Array.isArray(target.subprompts)) target.subprompts = [];
      target.subprompts.push({ title: "New: child, one", content: "Body {{s}}" });
      expect(canonical(hjson.parse(added.text))).toBe(canonical(expectedAdd));
      expect(getAt(hjson.parse(added.text), added.indexPath).title).toBe("New: child, one");

      if (indexPath.length > 1 || canDelete) {
        const expectedDelete = structuredClone(parsed);
        const parentPath = indexPath.slice(0, -1);
        const list = parentPath.length
          ? (getAt(expectedDelete, parentPath).subprompts as unknown[])
          : Array.isArray(expectedDelete)
            ? expectedDelete
            : ((expectedDelete as { prompts: unknown[] }).prompts as unknown[]);
        list.splice(indexPath[indexPath.length - 1], 1);
        expect(canonical(hjson.parse(deletePrompt(text, indexPath)))).toBe(canonical(expectedDelete));
      }
    }
  });
});

describe("needsQuotes", () => {
  it.each([
    ["技术方案 生成", false],
    ["Ask, then act", false],
    ["07 code", false],
    ["hello # x", false],
    ["2, 3 and 4", true],
    ["3, go", true],
    ["true", true],
    ["1.5", true],
    ["", true],
    [" lead", true],
    ["{brace", true],
    ["a\nb", true],
    ["// slashes", true],
  ])("%j -> %s", (input, expected) => {
    expect(needsQuotes(input)).toBe(expected);
  });
});
