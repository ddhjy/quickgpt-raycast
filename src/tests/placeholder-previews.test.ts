import { Clipboard } from "@raycast/api";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { getPlaceholderPreviews, PromptPreviews } from "../utils/placeholder-previews";
import { buildFormattedPromptContent } from "../utils/prompt-formatting-utils";
import { readScreenText } from "../utils/screen-text";

jest.mock("@raycast/api", () => ({
  Clipboard: { readText: jest.fn() },
  Icon: { TextCursor: "cursor", Monitor: "monitor", Clipboard: "clipboard", Document: "document" },
  getPreferenceValues: () => ({}),
}));
jest.mock("../managers/prompt-manager", () => ({ __esModule: true, default: { getRootPrompts: () => [] } }));
jest.mock("../utils/screen-text", () => ({ readScreenText: jest.fn() }));

const prompt = { identifier: "test", title: "Test", content: "{{s}} {{screenText}}" };
const screen = jest.mocked(readScreenText);
const clipboard = jest.mocked(Clipboard.readText);
beforeEach(() => {
  screen.mockReset();
  clipboard.mockReset();
});

it("puts the selection and screen text on their own icons and shares an in-flight capture with actions", async () => {
  const session = new PromptPreviews();
  const notify = jest.fn();
  const unsubscribe = session.subscribe(notify);
  const values = { selection: "第一行\n{{clipboard}} $&" };
  const plan = () => getPlaceholderPreviews(prompt, values, undefined, session.snapshot());
  let finish!: (text: string) => void;
  screen.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  expect(plan().accessories).toEqual([
    { icon: "cursor", tooltip: "{{selection}}\n第一行\n{{clipboard}} $&" },
    { icon: "monitor", tooltip: "{{screenText}}\nReading screen text…" },
  ]);
  const read = session.load(plan().requests[0]);
  expect(session.load(plan().requests[0])).toBe(read);
  const action = buildFormattedPromptContent(prompt, values, undefined, session);
  await Promise.resolve();
  const full = "屏幕实际文本 {{file:secret}} $&\n" + "字".repeat(1800);
  finish(full);
  await expect(action).resolves.toBe(values.selection + " " + full);
  expect(notify).toHaveBeenCalledTimes(1);
  expect(plan().requests).toEqual([]);
  expect(plan().accessories[1].tooltip).toBe("{{screenText}}\n" + full.slice(0, 1600) + "…");
  expect(screen).toHaveBeenCalledTimes(1);
  expect(clipboard).not.toHaveBeenCalled();
  unsubscribe();
  screen.mockResolvedValueOnce("another screen");
  await expect(new PromptPreviews().screenText()).resolves.toBe("another screen");
  expect(screen).toHaveBeenCalledTimes(2);
});

it("uses deeplink values and the selected fallback inside nested properties, prefixes and suffixes", () => {
  const template = {
    ...prompt,
    prefix: "nested",
    nested: "{{s|screenText}}",
    content: "{{option:format}}",
    format: ["short"],
    suffix: "screenText",
  };
  const plan = getPlaceholderPreviews(
    template,
    { selection: "chosen", screenText: "override\nline" },
    undefined,
    new Map(),
  );
  expect(plan.accessories).toEqual([
    { icon: "cursor", tooltip: "{{selection}}\nchosen" },
    { icon: "monitor", tooltip: "{{screenText}}\noverride\nline" },
  ]);
  expect(plan.requests).toEqual([]);
  const empty = getPlaceholderPreviews(prompt, { screenText: "" }, undefined, new Map());
  expect(empty.accessories.map((icon) => icon.tooltip)).toEqual([
    "{{selection}}\nNo text available.",
    "{{screenText}}\nNo text available.",
  ]);
  expect(empty.requests).toEqual([]);
  const selected = getPlaceholderPreviews(
    { ...prompt, content: "{{s|screenText}}" },
    { selection: "chosen" },
    undefined,
    new Map(),
  );
  expect(selected.requests).toEqual([]);
});

it("shows an AX error on the monitor and previews the actual clipboard when it is the fallback", async () => {
  const session = new PromptPreviews();
  const error = new Error("Accessibility permission required");
  screen.mockRejectedValueOnce(error);
  clipboard.mockResolvedValueOnce("clipboard text");
  const template = { ...prompt, content: "{{screenText|c}}" };
  const plan = () => getPlaceholderPreviews(template, {}, undefined, session.snapshot());
  await expect(session.load(plan().requests[0])).rejects.toThrow(error);
  const failed = getPlaceholderPreviews(prompt, {}, undefined, session.snapshot());
  expect(failed.accessories[1].tooltip).toBe("{{screenText}}\nAccessibility permission required");
  const noBackup = getPlaceholderPreviews(
    { ...prompt, content: "{{s|screenText}}" },
    {},
    undefined,
    session.snapshot(),
  );
  expect(noBackup.accessories).toEqual([failed.accessories[1]]);
  expect(plan().requests.map((request) => request.key)).toEqual(["clipboard"]);
  await session.load(plan().requests[0]);
  expect(plan().accessories).toEqual([{ icon: "clipboard", tooltip: "{{clipboard}}\nclipboard text" }]);
  await expect(buildFormattedPromptContent(template, {}, undefined, session)).resolves.toBe("clipboard text");
  expect(clipboard).toHaveBeenCalledTimes(1);
  expect(screen).toHaveBeenCalledTimes(1);
});

it("reads the screen for an unavailable clipboard fallback and surfaces a standalone clipboard error", async () => {
  const session = new PromptPreviews();
  const failure = new Error("Clipboard unavailable");
  clipboard.mockRejectedValueOnce(failure);
  screen.mockResolvedValueOnce("visible");
  const template = { ...prompt, content: "{{c|screenText}}" };
  await expect(buildFormattedPromptContent(template, {}, undefined, session)).resolves.toBe("visible");
  expect(getPlaceholderPreviews(template, {}, undefined, session.snapshot()).accessories[0].tooltip).toBe(
    "{{screenText}}\nvisible",
  );
  await expect(
    buildFormattedPromptContent({ ...prompt, content: "{{clipboard}}" }, {}, undefined, session),
  ).rejects.toThrow(failure);
  expect(clipboard).toHaveBeenCalledTimes(1);
  expect(screen).toHaveBeenCalledTimes(1);
});

it("previews actual file, directory and Finder contents and skips unused file fallbacks", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "quickgpt-hover-"));
  try {
    await mkdir(path.join(root, "docs"));
    await writeFile(path.join(root, "docs", "one.md"), "file {{screenText}}");
    const session = new PromptPreviews();
    const file = path.join(root, "docs", "one.md");
    const values = { selection: `__IS_FINDER_SELECTION__{{file:${file}}}` };
    const template = {
      ...prompt,
      content: "{{s|file:unused.md}} {{content:docs}} {{unknown|file:docs/one.md|screenText}}",
    };
    const plan = () => getPlaceholderPreviews(template, values, root, session.snapshot());
    expect(plan().requests).toHaveLength(3);
    await Promise.all(plan().requests.map((request) => session.load(request)));
    const ready = plan();
    expect(ready.requests).toEqual([]);
    expect(ready.accessories).toEqual([
      { icon: "cursor", tooltip: `{{selection}}\nFile: ${file}\nfile {{screenText}}` },
      {
        icon: "document",
        tooltip:
          "{{content:docs}}\nFile: one.md\nfile {{screenText}}\n\n\n\n{{file:docs/one.md}}\nFile: docs/one.md\nfile {{screenText}}",
      },
    ]);
    expect(screen).not.toHaveBeenCalled();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
