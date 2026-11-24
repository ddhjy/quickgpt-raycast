import { Clipboard, Icon, type List } from "@raycast/api";
import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { PromptProps } from "../managers/prompt-manager";
import {
  extractFinderSelectionPaths,
  resolvePlaceholders,
  safeResolveAbsolute,
  type SpecificReplacements,
} from "./placeholder-formatter";
import { getIndentedPromptTitles, wrapWithPrefixAndSuffix } from "./prompt-formatting-utils";
import { readScreenText } from "./screen-text";
import ignoreManager from "./ignore-manager";

const tooltipLimit = 1600;
const icons: Partial<Record<keyof SpecificReplacements, Icon>> = {
  input: Icon.TextInput,
  selection: Icon.TextCursor,
  clipboard: Icon.Clipboard,
  currentApp: Icon.AppWindow,
  allApp: Icon.AppWindowGrid2x2,
  browserContent: Icon.Globe,
  screenText: Icon.Monitor,
  promptTitles: Icon.List,
  diff: Icon.CodeBlock,
};

const readClipboard = async () => (await Clipboard.readText()) ?? "";
const liveReaders = { screenText: readScreenText, clipboard: readClipboard };
type PreviewValues = ReadonlyMap<string, string | Error>;
type PreviewRequest = { key: string; read: () => Promise<string> };

/** Shared by the lists and option forms opened during one invocation of Prompt Lab. */
export class PromptPreviews {
  private reads = new Map<string, Promise<string>>();
  private values: PreviewValues = new Map();
  private listeners = new Set<() => void>();

  snapshot = () => this.values;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  load({ key, read }: PreviewRequest): Promise<string> {
    const existing = this.reads.get(key);
    if (existing) return existing;
    const promise = Promise.resolve().then(read);
    this.reads.set(key, promise);
    const publish = (value: string | Error) => {
      this.values = new Map(this.values).set(key, value);
      this.listeners.forEach((listener) => listener());
    };
    void promise.then(publish, (error) => publish(error instanceof Error ? error : new Error(String(error))));
    return promise;
  }

  screenText = () => this.load({ key: "screenText", read: readScreenText });
  clipboard = () => this.load({ key: "clipboard", read: readClipboard });
}

function excerpt(text: string): string {
  if (text.length <= tooltipLimit) return text;
  return (
    text
      .slice(0, tooltipLimit)
      .replace(/[\uD800-\uDBFF]$/u, "")
      .trimEnd() + "…"
  );
}

async function fileHead(file: string): Promise<string> {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc((tooltipLimit + 1) * 4);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.toString("utf8", 0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function* directoryPreview(dir: string, root: string): AsyncGenerator<string> {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (!item.isDirectory() && !item.isFile()) continue;
    const file = path.join(dir, item.name);
    const relative = path.relative(root, file);
    const label = item.isDirectory() ? "Directory" : "File";
    if (ignoreManager.shouldIgnore(file, root, item.isDirectory())) {
      yield `${label}: ${relative} (ignored)\n\n`;
    } else if (item.isDirectory()) {
      yield `Directory: ${relative}/\n`;
      yield* directoryPreview(file, root);
    } else if (ignoreManager.isBinaryFile(file)) {
      yield `File: ${relative} (binary/media, content ignored)\n\n`;
    } else {
      yield `File: ${relative}\n`;
      yield (await fileHead(file)) + "\n\n";
    }
  }
}

async function readPathPreview(directive: "file" | "content", given: string, root?: string): Promise<string> {
  const file = safeResolveAbsolute(given, root);
  if (file instanceof Error) throw file;
  const stats = await stat(file);
  if (stats.isFile()) return excerpt((directive === "file" ? `File: ${given}\n` : "") + (await fileHead(file)));
  if (!stats.isDirectory()) throw new Error(`Unsupported path type: ${given}`);
  let text = directive === "file" ? `Directory: ${given}/\n` : "";
  for await (const part of directoryPreview(file, file)) {
    text += part;
    if (text.length > tooltipLimit) break;
  }
  return excerpt(text);
}

export function getPlaceholderPreviews(
  prompt: PromptProps,
  replacements: SpecificReplacements,
  root: string | undefined,
  snapshot: PreviewValues,
): { accessories: List.Item.Accessory[]; requests: PreviewRequest[] } {
  const requests = new Map<string, PreviewRequest>();
  const accessories: List.Item.Accessory[] = [];
  const fileTips = new Map<string, string>();
  const values: SpecificReplacements & Record<string, unknown> = {
    ...prompt,
    ...replacements,
    clipboard: replacements.clipboard,
  };
  const screenOverride = values.screenText;
  // Both library placeholders have generated defaults. Only build the title list if its icon is used.
  values.promptTitles ||= "{{promptTitles}}";
  values.prompts ||= "{{prompts}}";
  for (const key of ["clipboard", "screenText"] as const) {
    const value = snapshot.get(key);
    if (typeof values[key] !== "string") values[key] = value instanceof Error ? "" : value;
  }

  function previewFile(directive: "file" | "content", file: string) {
    const key = JSON.stringify([root, directive, file]);
    const value = snapshot.get(key);
    if (value === undefined) requests.set(key, { key, read: () => readPathPreview(directive, file, root) });
    return value;
  }

  const used = resolvePlaceholders(wrapWithPrefixAndSuffix(prompt), values, (directive, file, fallback) => {
    const token = `{{${directive}:${file}}}`;
    const value = previewFile(directive, file);
    if (fallback && (value instanceof Error || value?.startsWith("["))) return false;
    fileTips.set(token, `${token}\n${value instanceof Error ? value.message : (value ?? "Reading file…")}`);
    return true;
  });

  for (const key of used) {
    const icon = icons[key];
    if (!icon) continue;
    let text = String(values[key] ?? "");
    if (key === "screenText" || key === "clipboard") {
      const override = key === "screenText" ? screenOverride : replacements.clipboard;
      if (typeof override !== "string") {
        const value = snapshot.get(key);
        if (value === undefined) requests.set(key, { key, read: liveReaders[key] });
        text =
          value instanceof Error
            ? value.message
            : (value ?? (key === "screenText" ? "Reading screen text…" : "Reading clipboard…"));
      }
    } else if (key === "promptTitles") {
      text = replacements.promptTitles || getIndentedPromptTitles();
    } else if (key === "selection") {
      const files = extractFinderSelectionPaths(text);
      if (files.length)
        text = files
          .map((file) => {
            const value = previewFile("file", file);
            return value instanceof Error ? value.message : (value ?? file);
          })
          .join("\n");
    }
    accessories.push({ icon, tooltip: `{{${key}}}\n${excerpt(text.trim() || "No text available.")}` });
  }
  if (fileTips.size) accessories.push({ icon: Icon.Document, tooltip: excerpt([...fileTips.values()].join("\n\n")) });
  return { accessories, requests: [...requests.values()] };
}
