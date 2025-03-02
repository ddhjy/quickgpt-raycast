import { contentFormat, SpecificReplacements } from "../utils/contentFormat";

describe("contentFormat", () => {
  it("should replace {{input}} and {{clipboard}}", () => {
    const text = "Hello {{input}}, your clipboard says {{clipboard}}";
    const replacements: SpecificReplacements = {
      input: "World",
      clipboard: "Copy me",
    };
    const result = contentFormat(text, replacements);
    expect(result).toBe("Hello World, your clipboard says Copy me");
  });

  it("should prioritize {{clipboard|input}} over {{clipboard}}", () => {
    const text = "Hello {{clipboard|input}}, your clipboard says {{clipboard}}";
    const replacements: SpecificReplacements = {
      input: "World",
      clipboard: "Copy me",
    };
    const result = contentFormat(text, replacements);
    expect(result).toBe("Hello Copy me, your clipboard says Copy me");
  });

  it("should use {{input|selection|clipboard}} with selection", () => {
    const text = "Content: {{input|selection|clipboard}}";
    const replacements: SpecificReplacements = {
      selection: "Selected text",
    };
    const result = contentFormat(text, replacements);
    expect(result).toBe("Content: Selected text");
  });

  it("should use aliases {{i}} {{s}} {{c}}", () => {
    const text = "Input: {{i}}, Selection: {{s}}, Clipboard: {{c}}";
    const replacements: SpecificReplacements = {
      input: "Input text",
      selection: "Selected text",
      clipboard: "Clipboard text",
    };
    const result = contentFormat(text, replacements);
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
    expect(contentFormat(text, replacements1)).toBe("Content: Input text");

    const replacements2: SpecificReplacements = {
      selection: "Selected text",
      clipboard: "Clipboard text",
    };
    expect(contentFormat(text, replacements2)).toBe("Content: Selected text");

    const replacements3: SpecificReplacements = {
      clipboard: "Clipboard text",
    };
    expect(contentFormat(text, replacements3)).toBe("Content: Clipboard text");
  });

  it("should use literals with prefix {{p:i|s|c}}", () => {
    const text = "Content: {{p:i|s|c}}";
    const replacements: SpecificReplacements = {
      input: "Input text",
      selection: "Selected text",
      clipboard: "Clipboard text",
    };
    expect(contentFormat(text, replacements)).toBe("Content: <输入文本>");

    const replacements2: SpecificReplacements = {};
    expect(contentFormat(text, replacements2)).toBe("Content: {{p:i|s|c}}");
  });

  it("should use literals with prefix {{p:i|c}}", () => {
    const text = "Content: {{p:i|c}}";
    const replacements: SpecificReplacements = {
      clipboard: "Clipboard text",
    };
    expect(contentFormat(text, replacements)).toBe("Content: <剪贴板文本>");
  });

  it("should handle unknown placeholders", () => {
    const text = "Hello {{unknown}}";
    const replacements: SpecificReplacements = {};
    expect(contentFormat(text, replacements)).toBe("Hello {{unknown}}");
  });

  it("should handle empty replacements", () => {
    const text = "Content: {{input}}";
    const replacements: SpecificReplacements = {
      clipboard: "Clipboard text",
    };
    expect(contentFormat(text, replacements)).toBe("Content: {{input}}");
  });

  it("should replace {{currentApp}}", () => {
    const text = "Current app: {{currentApp}}";
    const replacements: SpecificReplacements = {
      currentApp: "VS Code",
    };
    expect(contentFormat(text, replacements)).toBe("Current app: VS Code");
  });

  it("should use literal with prefix {{p:currentApp}}", () => {
    const text = "Current app: {{p:currentApp}}";
    const replacements: SpecificReplacements = {
      currentApp: "VS Code",
    };
    expect(contentFormat(text, replacements)).toBe("Current app: <当前应用>");
  });

  it("should handle empty input replacements", () => {
    const text = "Content: {{input}}";
    const replacements: SpecificReplacements = {
      input: "",
    };
    expect(contentFormat(text, replacements)).toBe("Content: {{input}}");
  });
});