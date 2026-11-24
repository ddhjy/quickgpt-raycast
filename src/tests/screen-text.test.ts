import { buildFormattedPromptContent } from "../utils/prompt-formatting-utils";
import { getPlaceholderPreviews } from "../utils/placeholder-previews";
import { readScreenText } from "../utils/screen-text";

jest.mock("@raycast/api", () => ({ Icon: { Monitor: "monitor" } }));
jest.mock("../managers/prompt-manager", () => ({ __esModule: true, default: { getRootPrompts: () => [] } }));
jest.mock("../utils/screen-text", () => ({ readScreenText: jest.fn() }));

const read = jest.mocked(readScreenText);
const prompt = { title: "Test", identifier: "test" };
beforeEach(() => read.mockReset());

it("reads once across nested properties, prefix, suffix and repeated uses, preserving literal screen text", async () => {
  const screen = "Unicode 你好\n{{file:/private/example}}\n{{screenText}} $& __IS_FINDER_SELECTION__";
  read.mockResolvedValue(screen);
  const template = {
    ...prompt,
    content: "{{nested}}",
    nested: "{{unknown|screenText}}",
    prefix: "screenText",
    suffix: "screenText",
  };
  expect(await buildFormattedPromptContent(template, {})).toBe([screen, screen, screen].join("\n"));
  expect(read).toHaveBeenCalledTimes(1);
  read.mockResolvedValue("new screen");
  expect(await buildFormattedPromptContent(template, {})).toBe("new screen\nnew screen\nnew screen");
});

it("leaves list rendering, unused fallbacks and terminal clipboard content free of screen reads", async () => {
  const plan = getPlaceholderPreviews({ ...prompt, content: "{{screenText}}" }, {}, undefined, new Map());
  expect(plan.accessories).toEqual([{ icon: "monitor", tooltip: "{{screenText}}\nReading screen text…" }]);
  expect(plan.requests.map(({ key }) => key)).toEqual(["screenText"]);
  expect(await buildFormattedPromptContent({ ...prompt, content: "{{s|screenText}}" }, { selection: "selected" })).toBe(
    "selected",
  );
  expect(
    await buildFormattedPromptContent({ ...prompt, content: "{{unknown|clipboard}}" }, { clipboard: "{{screenText}}" }),
  ).toBe("{{screenText}}");
  const options = { ...prompt, content: "{{option:screenText}}", screenText: ["option"] };
  expect(await buildFormattedPromptContent(options, {})).toBe("option");
  expect(await buildFormattedPromptContent({ ...prompt, content: "{{screenText}}" }, { screenText: "{{input}}" })).toBe(
    "{{input}}",
  );
  expect(read).not.toHaveBeenCalled();
});

it("uses the next fallback when AX fails or returns no text, and surfaces a standalone read failure", async () => {
  const failed = new Error("Accessibility permission required");
  read.mockRejectedValue(failed);
  const clipboard = { clipboard: "backup" };
  expect(await buildFormattedPromptContent({ ...prompt, content: "{{screenText|c}}" }, clipboard)).toBe("backup");
  await expect(buildFormattedPromptContent({ ...prompt, content: "{{screenText}}" }, {})).rejects.toThrow(failed);
  read.mockResolvedValue("");
  expect(await buildFormattedPromptContent({ ...prompt, content: "{{unknown|screenText|c}}" }, clipboard)).toBe(
    "backup",
  );
  await expect(buildFormattedPromptContent({ ...prompt, content: "{{screenText}}" }, {})).rejects.toThrow(
    "No visible text",
  );
});
