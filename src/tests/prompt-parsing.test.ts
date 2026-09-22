import {
  createPromptParseState,
  generatePromptIdentifier,
  parsePromptsFromFile,
  processPrompts,
} from "../utils/prompt-parsing";

const ROOT_FILE = `{
rootProperty: {
  chs: "! 简体中文作答"
}
}`;

const LIBRARY_FILE = `[
  "ignored string item"
  { title: Code
    icon: 💻
    prefix: chs
    subprompts: [
      { title: 技术方案 生成
        content: "Plan: {{i|s|c}}"
      }
      { content: 模拟一个实际场景
      }
      { title: Nested
        subprompts: [
          { title: Deep
            identifier: explicit-id
            content: "Deep body"
          }
        ]
      }
    ]
  }
]`;

describe("prompt-parsing", () => {
  it("records source index paths, own content and inherited properties", () => {
    const state = createPromptParseState();
    const rootPrompts = parsePromptsFromFile(state, ROOT_FILE, "/lib/root.hjson");
    expect(rootPrompts).toEqual([]);
    expect(state.mergedRootProperties).toEqual({ chs: "! 简体中文作答" });

    const loaded = parsePromptsFromFile(state, LIBRARY_FILE, "/lib/07 code.hjson");
    const [code] = processPrompts(state, loaded);

    expect(code.title).toBe("Code");
    expect(code.sourceIndexPath).toEqual([1]);
    expect(code.hasOwnContent).toBe(false);
    expect(code.content).toBe("Code");
    expect(code.path).toBe("Code");
    expect(code.filePath).toBe("/lib/07 code.hjson");

    const [plan, derived, nested] = code.subprompts ?? [];
    expect(plan.sourceIndexPath).toEqual([1, 0]);
    expect(plan.hasOwnContent).toBe(true);
    expect(plan.prefix).toBe("chs");
    expect((plan as unknown as Record<string, unknown>).chs).toBe("! 简体中文作答");
    expect(plan.path).toBe("Code / 技术方案 生成");
    expect(plan.lineNumber).toBe(7);

    expect(derived.title).toBe("模拟一个实际场景");
    expect(derived.sourceIndexPath).toEqual([1, 1]);

    const [deep] = nested.subprompts ?? [];
    expect(deep.identifier).toBe("explicit-id");
    expect(deep.sourceIndexPath).toEqual([1, 2, 0]);
    expect(deep.path).toBe("Code / Nested / Deep");
  });

  it("derives identifiers from the emoji, title and placeholders", () => {
    const state = createPromptParseState();
    const [code] = processPrompts(state, parsePromptsFromFile(state, LIBRARY_FILE, "/lib/code.hjson"));
    const plan = code.subprompts![0];
    expect(plan.identifier).toBe(generatePromptIdentifier({ title: "技术方案 生成", content: "Plan: {{i|s|c}}" }));
    expect(plan.identifier).toHaveLength(8);
    expect(code.identifier).toBe(generatePromptIdentifier({ title: "Code", content: "Code" }));
  });

  it("reports parse failures instead of throwing", () => {
    const errors: string[] = [];
    const prompts = parsePromptsFromFile(createPromptParseState(), "{ title: broken", "/lib/broken.hjson", (message) =>
      errors.push(message),
    );
    expect(prompts).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("broken.hjson");
  });
});
