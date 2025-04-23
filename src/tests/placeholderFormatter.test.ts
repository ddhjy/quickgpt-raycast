import { placeholderFormatter, SpecificReplacements, resolvePlaceholders } from "../utils/placeholderFormatter";

describe("placeholderFormatter", () => {
  it("should replace {{input}} and {{clipboard}}", () => {
    const text = "Hello {{input}}, your clipboard says {{clipboard}}";
    const replacements: SpecificReplacements = {
      input: "World",
      clipboard: "Copy me",
    };
    const result = placeholderFormatter(text, replacements);
    expect(result).toBe("Hello World, your clipboard says Copy me");
  });

  it("should prioritize {{clipboard|input}} over {{clipboard}}", () => {
    const text = "Hello {{clipboard|input}}, your clipboard says {{clipboard}}";
    const replacements: SpecificReplacements = {
      input: "World",
      clipboard: "Copy me",
    };
    const result = placeholderFormatter(text, replacements);
    expect(result).toBe("Hello Copy me, your clipboard says Copy me");
  });

  it("should use {{input|selection|clipboard}} with selection", () => {
    const text = "Content: {{input|selection|clipboard}}";
    const replacements: SpecificReplacements = {
      selection: "Selected text",
    };
    const result = placeholderFormatter(text, replacements);
    expect(result).toBe("Content: Selected text");
  });

  it("should use aliases {{i}} {{s}} {{c}}", () => {
    const text = "Input: {{i}}, Selection: {{s}}, Clipboard: {{c}}";
    const replacements: SpecificReplacements = {
      input: "Input text",
      selection: "Selected text",
      clipboard: "Clipboard text",
    };
    const result = placeholderFormatter(text, replacements);
    expect(result).toBe(
      "Input: Input text, Selection: Selected text, Clipboard: Clipboard text"
    );
  });

  it("should prioritize replacements in {{i|s|c}}", () => {
    const text = "Content: {{i|s|c}}";

    const replacements1: SpecificReplacements = {
      input: "Input text",
      selection: "Selected text",
      clipboard: "Clipboard text",
    };
    expect(placeholderFormatter(text, replacements1)).toBe("Content: Input text");

    const replacements2: SpecificReplacements = {
      selection: "Selected text",
      clipboard: "Clipboard text",
    };
    expect(placeholderFormatter(text, replacements2)).toBe("Content: Selected text");

    const replacements3: SpecificReplacements = {
      clipboard: "Clipboard text",
    };
    expect(placeholderFormatter(text, replacements3)).toBe("Content: Clipboard text");
  });

  it("should use literals with prefix {{p:i|s|c}}", () => {
    const text = "Content: {{p:i|s|c}}";
    const replacements: SpecificReplacements = {
      input: "Input text",
      selection: "Selected text",
      clipboard: "Clipboard text",
    };
    expect(placeholderFormatter(text, replacements)).toBe("Content: <输入文本>");

    const replacements2: SpecificReplacements = {};
    expect(placeholderFormatter(text, replacements2)).toBe("Content: {{p:i|s|c}}");
  });

  it("should use literals with prefix {{p:i|c}}", () => {
    const text = "Content: {{p:i|c}}";
    const replacements: SpecificReplacements = {
      clipboard: "Clipboard text",
    };
    expect(placeholderFormatter(text, replacements)).toBe("Content: <剪贴板文本>");
  });

  it("should handle unknown placeholders", () => {
    const text = "Hello {{unknown}}";
    const replacements: SpecificReplacements = {};
    expect(placeholderFormatter(text, replacements)).toBe("Hello {{unknown}}");
  });

  it("should handle empty replacements", () => {
    const text = "Content: {{input}}";
    const replacements: SpecificReplacements = {
      clipboard: "Clipboard text",
    };
    expect(placeholderFormatter(text, replacements)).toBe("Content: {{input}}");
  });

  it("should replace {{currentApp}}", () => {
    const text = "Current app: {{currentApp}}";
    const replacements: SpecificReplacements = {
      currentApp: "VS Code",
    };
    expect(placeholderFormatter(text, replacements)).toBe("Current app: VS Code");
  });

  it("should use literal with prefix {{p:currentApp}}", () => {
    const text = "Current app: {{p:currentApp}}";
    const replacements: SpecificReplacements = {
      currentApp: "VS Code",
    };
    expect(placeholderFormatter(text, replacements)).toBe("Current app: <当前应用>");
  });

  it("should handle empty input replacements", () => {
    const text = "Content: {{input}}";
    const replacements: SpecificReplacements = {
      input: "",
    };
    expect(placeholderFormatter(text, replacements)).toBe("Content: {{input}}");
  });
});

describe("resolvePlaceholders", () => {
  it("should identify used placeholders in a template", () => {
    const text = "Hello {{input}}, your clipboard says {{clipboard}}";
    const replacements: SpecificReplacements = {
      input: "World",
      clipboard: "Copy me",
      selection: "Selected text",
    };
    const usedPlaceholders = resolvePlaceholders(text, replacements);
    expect(usedPlaceholders.size).toBe(2);
    expect(usedPlaceholders.has("input")).toBe(true);
    expect(usedPlaceholders.has("clipboard")).toBe(true);
    expect(usedPlaceholders.has("selection")).toBe(false);
  });

  it("should identify placeholders with aliases", () => {
    const text = "Input: {{i}}, Selection: {{s}}, Clipboard: {{c}}";
    const replacements: SpecificReplacements = {
      input: "Input text",
      selection: "Selected text",
      clipboard: "Clipboard text",
    };
    const usedPlaceholders = resolvePlaceholders(text, replacements);
    expect(usedPlaceholders.size).toBe(3);
    expect(usedPlaceholders.has("input")).toBe(true);
    expect(usedPlaceholders.has("selection")).toBe(true);
    expect(usedPlaceholders.has("clipboard")).toBe(true);
  });

  it("should handle fallback placeholders", () => {
    const text = "Content: {{input|selection|clipboard}}";
    const replacements: SpecificReplacements = {
      selection: "Selected text",
      clipboard: "Clipboard text",
    };
    const usedPlaceholders = resolvePlaceholders(text, replacements);
    expect(usedPlaceholders.size).toBe(1);
    expect(usedPlaceholders.has("selection")).toBe(true);
    expect(usedPlaceholders.has("clipboard")).toBe(false);
    expect(usedPlaceholders.has("input")).toBe(false);
  });

  it("should use the first available placeholder in a fallback chain", () => {
    const text = "Content: {{input|selection|clipboard}}";
    const replacements: SpecificReplacements = {
      clipboard: "Clipboard text",
    };
    const usedPlaceholders = resolvePlaceholders(text, replacements);
    expect(usedPlaceholders.size).toBe(1);
    expect(usedPlaceholders.has("clipboard")).toBe(true);
  });

  it("should handle p: prefix placeholders", () => {
    const text = "Content: {{p:input|selection|clipboard}}";
    const replacements: SpecificReplacements = {
      input: "Input text",
    };
    const usedPlaceholders = resolvePlaceholders(text, replacements);
    expect(usedPlaceholders.size).toBe(1);
    expect(usedPlaceholders.has("input")).toBe(true);
  });

  it("should ignore file: placeholders", () => {
    const text = "Content: {{file:path/to/file}}";
    const replacements: SpecificReplacements = {
      input: "Input text",
    };
    const usedPlaceholders = resolvePlaceholders(text, replacements);
    expect(usedPlaceholders.size).toBe(0);
  });

  it("should ignore empty string values", () => {
    const text = "Content: {{input|selection}}";
    const replacements: SpecificReplacements = {
      input: "",
      selection: "Selected text",
    };
    const usedPlaceholders = resolvePlaceholders(text, replacements);
    expect(usedPlaceholders.size).toBe(1);
    expect(usedPlaceholders.has("selection")).toBe(true);
    expect(usedPlaceholders.has("input")).toBe(false);
  });

  it("should handle multiple occurrences of the same placeholder", () => {
    const text = "Input: {{input}}, repeat: {{input}}";
    const replacements: SpecificReplacements = {
      input: "Input text",
    };
    const usedPlaceholders = resolvePlaceholders(text, replacements);
    expect(usedPlaceholders.size).toBe(1);
    expect(usedPlaceholders.has("input")).toBe(true);
  });

  it("should handle null and undefined values", () => {
    const text = "Content: {{input|selection|clipboard}}";
    const replacements = {
      input: undefined,
      selection: undefined,
    };
    const usedPlaceholders = resolvePlaceholders(text, replacements);
    expect(usedPlaceholders.size).toBe(1);
    expect(usedPlaceholders.has("clipboard")).toBe(true);
  });

  it("should handle {{i|s|c}}", () => {
    const text = "Content: {{i|s|c}}";
    const replacements: SpecificReplacements = {
      input: "",
      selection: "",
    };
    const usedPlaceholders = resolvePlaceholders(text, replacements);
    expect(usedPlaceholders.size).toBe(1);
    expect(usedPlaceholders.has("input")).toBe(false);
    expect(usedPlaceholders.has("selection")).toBe(false);
    expect(usedPlaceholders.has("clipboard")).toBe(true);

    const replacements2: SpecificReplacements = {
      input: "Input text",
      selection: "Selected text",
    };
    const usedPlaceholders2 = resolvePlaceholders(text, replacements2);
    expect(usedPlaceholders2.size).toBe(1);
    expect(usedPlaceholders2.has("input")).toBe(true);
    expect(usedPlaceholders2.has("selection")).toBe(false);
    expect(usedPlaceholders2.has("clipboard")).toBe(false);
  });

  it("should handle {{s|i}}", () => {
    const text = "Content: {{s|i}}";
    const replacements: SpecificReplacements = {
      input: "Input text",
      selection: "Selected text",
    };
    const usedPlaceholders = resolvePlaceholders(text, replacements);
    expect(usedPlaceholders.size).toBe(1);
    expect(usedPlaceholders.has("input")).toBe(false);
    expect(usedPlaceholders.has("selection")).toBe(true);
  });
});