import fs from "fs";
import path from "path";
import * as hjson from "hjson";
import {
  addChild,
  deletePrompt,
  deletePrompts,
  movePrompts,
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

const titleOf = (item: unknown): string => {
  if (typeof item === "string") return item;
  const raw = item as Raw;
  return String(raw.title ?? raw.content ?? "");
};

describe("hjson-edit deletePrompts", () => {
  it("removes several prompts by their original index paths", () => {
    const next = deletePrompts(INLINE_LIBRARY, [
      [1, 0],
      [1, 2],
    ]);
    const subprompts = (hjson.parse(next) as Raw[])[1].subprompts as Raw[];
    expect(subprompts.map(titleOf)).toEqual(["模拟一个实际场景来演示怎么使用吧"]);
    expect(next).toContain("# section marker");
  });

  it("drops a subprompts array that becomes empty", () => {
    const next = deletePrompts(INLINE_LIBRARY, [[2, 0]]);
    const folder = (hjson.parse(next) as Raw[])[2];
    expect(folder.subprompts).toBeUndefined();
    expect(folder.title).toBe("Folder without content");
    expect(next).not.toContain("subprompts: [\n    ]");
  });

  it("ignores prompts whose ancestor is also deleted", () => {
    const next = deletePrompts(INLINE_LIBRARY, [[1], [1, 1]]);
    expect((hjson.parse(next) as unknown[]).map(titleOf)).toEqual(["not a prompt", "Folder without content"]);
  });
});

const COMMA_LIBRARY = `{
  prompts: [
    {
      title: A
      subprompts: [
        { title: "A1", content: "one" },
        { title: "A2", content: "two" },
        { title: "A3", content: "three" }
      ]
    },
    {
      title: B
      content:
        '''
        B body
          indented
        '''
    }
  ]
}
`;

describe("hjson-edit movePrompts", () => {
  const FILE = "/lib/inline.hjson";
  const move = (
    text: string,
    sources: number[][],
    target: number[],
    where: Parameters<typeof movePrompts>[2]["where"],
  ) =>
    movePrompts(
      { [FILE]: text },
      sources.map((indexPath) => ({ file: FILE, indexPath })),
      { file: FILE, indexPath: target, where },
    );

  it("reorders siblings and reports where they landed", () => {
    const { texts, moved } = move(INLINE_LIBRARY, [[1, 2]], [1, 0], "before");
    const subprompts = (hjson.parse(texts[FILE]) as Raw[])[1].subprompts as Raw[];
    expect(subprompts.map(titleOf)).toEqual(["single quoted", "Quick", "模拟一个实际场景来演示怎么使用吧"]);
    expect(moved).toEqual([{ file: FILE, indexPath: [1, 0] }]);
    expect(subprompts[0].content).toBe("Line one {{s|c}}\n\n  indented line\nLine three # not a comment");
    expect(texts[FILE]).toContain("# section marker");
  });

  it("moves several prompts into another folder in the given order and re-indents them", () => {
    const { texts, moved } = move(
      INLINE_LIBRARY,
      [
        [1, 2],
        [1, 0],
      ],
      [2],
      "inside-last",
    );
    const parsed = hjson.parse(texts[FILE]) as Raw[];
    expect((parsed[1].subprompts as Raw[]).map(titleOf)).toEqual(["模拟一个实际场景来演示怎么使用吧"]);
    const folder = parsed[2].subprompts as Raw[];
    expect(folder.map(titleOf)).toEqual(["Leaf A", "single quoted", "Quick"]);
    expect(folder[1].content).toBe("Line one {{s|c}}\n\n  indented line\nLine three # not a comment");
    expect(moved.map((location) => location.indexPath)).toEqual([
      [2, 1],
      [2, 2],
    ]);
  });

  it("turns a leaf into a folder and moves prompts to the root level", () => {
    const intoLeaf = move(INLINE_LIBRARY, [[2]], [1, 0], "inside-first");
    const quick = ((hjson.parse(intoLeaf.texts[FILE]) as Raw[])[1].subprompts as Raw[])[0];
    expect((quick.subprompts as Raw[]).map(titleOf)).toEqual(["Folder without content"]);
    expect(quick.content).toBe("Answer briefly: {{i}}");

    const toRoot = move(INLINE_LIBRARY, [[1, 1]], [1], "after");
    expect((hjson.parse(toRoot.texts[FILE]) as unknown[]).map(titleOf)).toEqual([
      "not a prompt",
      "Ask, then act",
      "模拟一个实际场景来演示怎么使用吧",
      "Folder without content",
    ]);
  });

  it("keeps the comma style of the target array", () => {
    const { texts } = move(COMMA_LIBRARY, [[1]], [0, 1], "after");
    const a = (hjson.parse(texts[FILE]) as { prompts: Raw[] }).prompts[0];
    expect((a.subprompts as Raw[]).map(titleOf)).toEqual(["A1", "A2", "B", "A3"]);
    expect((a.subprompts as Raw[])[2].content).toBe("B body\n  indented");
    expect(texts[FILE]).toMatch(/\{ title: "A2", content: "two" \},\n {8}\{/);
  });

  it("moves prompts across files", () => {
    const other = "/lib/other.hjson";
    const result = movePrompts(
      { [FILE]: INLINE_LIBRARY, [other]: COMMA_LIBRARY },
      [{ file: other, indexPath: [0, 1] }],
      { file: FILE, indexPath: [2], where: "inside-first" },
    );
    const a = (hjson.parse(result.texts[other]) as { prompts: Raw[] }).prompts[0];
    expect((a.subprompts as Raw[]).map(titleOf)).toEqual(["A1", "A3"]);
    const folder = (hjson.parse(result.texts[FILE]) as Raw[])[2];
    expect((folder.subprompts as Raw[]).map(titleOf)).toEqual(["A2", "Leaf A"]);
    expect(result.moved).toEqual([{ file: FILE, indexPath: [2, 0] }]);
  });

  it("refuses to move a prompt into itself", () => {
    expect(() => move(INLINE_LIBRARY, [[1]], [1, 0], "inside-last")).toThrow(/自己/);
    expect(() => move(SINGLE_OBJECT, [[0]], [0], "after")).toThrow();
  });

  it("returns no changes when the order stays the same", () => {
    const { texts } = move(INLINE_LIBRARY, [[1, 0]], [1, 1], "before");
    expect(texts).toEqual({});
  });

  it.each(fixtures.filter((fixture) => fixture.name !== "single object"))(
    "moves every nested prompt to the front of its root in $name",
    ({ text }) => {
      const parsed = hjson.parse(text);
      for (const { indexPath } of allIndexPaths(text)) {
        if (indexPath.length < 3) continue;
        const root = [indexPath[0]];
        const expected = structuredClone(parsed);
        const parent = getAt(expected, indexPath.slice(0, -1));
        const list = parent.subprompts as unknown[];
        const [item] = list.splice(indexPath[indexPath.length - 1], 1);
        if (!list.length) delete parent.subprompts;
        const rootNode = getAt(expected, root);
        (rootNode.subprompts as unknown[]).unshift(item);
        const { texts } = move(text, [indexPath], root, "inside-first");
        expect(canonical(hjson.parse(texts[FILE]))).toBe(canonical(expected));
      }
    },
  );
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
