/**
 * Builds the data model behind the Prompt Map page: the whole prompt library
 * as a tree of lightweight nodes with everything the page needs to render,
 * search (including Pinyin) and edit.
 *
 * Shared by the Raycast extension (static read-only snapshot) and the Prompt
 * Map server bundle, so nothing here may import `@raycast/api`.
 */

import * as fs from "fs";
import * as path from "path";
import { pinyin } from "pinyin-pro";
import { createPromptParseState, parsePromptsFromFile, processPrompts, type PromptProps } from "./prompt-parsing";

export interface PromptMapKeyValue {
  key: string;
  text?: string;
}

export interface PromptMapOption {
  key: string;
  values: string[];
}

export interface PromptMapNode {
  id: string;
  /** Stable node key: `${file}#${indexPath.join(".")}`. */
  key: string;
  indexPath: number[];
  title: string;
  icon: string;
  path: string;
  file: string;
  fileName: string;
  line?: number;
  /** Effective content shown in the panel (inherited content for folders is hidden). */
  content: string;
  /** Content defined on the prompt itself, which is what the editor edits. */
  ownContent: string;
  prefix: PromptMapKeyValue[];
  suffix: PromptMapKeyValue[];
  options: PromptMapOption[];
  textInputs: string[];
  actions: string[];
  placeholders: string[];
  /** Pinyin search text for the title: full readings plus initials. */
  py: string;
  depth: number;
  readonly: boolean;
  /** The file's single root object: it cannot be moved, deleted or get siblings. */
  fileRoot: boolean;
  children: PromptMapNode[];
}

export interface PromptMapFile {
  name: string;
  path: string;
  readonly: boolean;
  roots: PromptMapNode[];
}

export interface PromptMapError {
  file: string;
  message: string;
}

export interface PromptMapModel {
  generatedAt: string;
  sourceDirs: string[];
  deeplinkBase: string;
  editable: boolean;
  errors: PromptMapError[];
  totals: { files: number; prompts: number };
  files: PromptMapFile[];
}

export const PROMPT_MAP_DEEPLINK_BASE = "raycast://extensions/ddhjy2012/quickgpt/prompt-lab";

const PLACEHOLDER_SHORT: Record<string, string> = {
  i: "i",
  input: "i",
  s: "s",
  selection: "s",
  c: "c",
  clipboard: "c",
  n: "n",
  now: "n",
  currentApp: "app",
  allApp: "apps",
  browserContent: "web",
  diff: "diff",
  pt: "pt",
  promptTitles: "pt",
  ps: "ps",
  prompts: "ps",
};

const collator = new Intl.Collator("zh-Hans-CN", { numeric: true, sensitivity: "base" });

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Short chip labels for the context placeholders a prompt consumes. Custom
 * prompt properties are left out; they still show highlighted in the panel.
 */
export function extractPlaceholders(content: string | undefined): string[] {
  const result: string[] = [];
  const regex = /{{([^}]+)}}/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content || "")) !== null) {
    for (const rawPart of match[1].split("|")) {
      const part = rawPart.trim();
      if (!part) continue;
      const directive = part.match(/^(option|file|content):/);
      const label = directive ? (directive[1] === "option" ? "opt" : "file") : PLACEHOLDER_SHORT[part];
      if (label && !result.includes(label)) result.push(label);
    }
  }
  return result;
}

function extractOptionKeys(content: string | undefined): string[] {
  const keys: string[] = [];
  const regex = /option:([^}|\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content || "")) !== null) {
    if (!keys.includes(match[1])) keys.push(match[1]);
  }
  return keys;
}

function resolveKeyList(prompt: PromptProps, list: string | undefined): PromptMapKeyValue[] {
  if (!list || typeof list !== "string") return [];
  const keys = Array.from(
    new Set(
      list
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean),
    ),
  );
  return keys.map((key) => {
    const value = (prompt as unknown as Record<string, unknown>)[key];
    return { key, text: typeof value === "string" ? value : undefined };
  });
}

/**
 * Pinyin search text: the full reading and the initials of the title, both
 * lower-case and without spaces, so `jsfa` finds `技术方案`.
 */
export function buildSearchText(title: string): string {
  const options = { toneType: "none", type: "array", nonZh: "consecutive" } as const;
  const full = pinyin(title, options).join("").toLowerCase().replace(/\s+/g, "");
  const first = pinyin(title, { ...options, pattern: "first" })
    .join("")
    .toLowerCase()
    .replace(/\s+/g, "");
  return full === first ? full : `${full} ${first}`;
}

/** True when `filePath` sits inside any of `roots` (or is one of them). */
export function isInsideAny(filePath: string, roots: readonly string[]): boolean {
  const resolved = path.resolve(filePath);
  return roots.some((root) => {
    const resolvedRoot = path.resolve(root);
    if (resolved === resolvedRoot) return true;
    const relative = path.relative(resolvedRoot, resolved);
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  });
}

function toNode(prompt: PromptProps, depth: number, readonly: boolean): PromptMapNode {
  const children = (prompt.subprompts || []).map((sub) => toNode(sub, depth + 1, readonly));
  const filePath = prompt.filePath ?? "";
  const indexPath = prompt.sourceIndexPath ?? [];
  const record = prompt as unknown as Record<string, unknown>;
  const options = extractOptionKeys(prompt.content)
    .map((key): PromptMapOption | undefined => {
      const value = record[key];
      if (Array.isArray(value)) return { key, values: value.map(String) };
      if (isObject(value)) return { key, values: Object.keys(value) };
      return undefined;
    })
    .filter((option): option is PromptMapOption => option !== undefined);

  return {
    id: prompt.identifier,
    key: `${filePath}#${indexPath.join(".")}`,
    indexPath,
    title: prompt.title,
    icon: prompt.icon || "",
    path: prompt.path ?? prompt.title,
    file: filePath,
    fileName: path.basename(filePath, ".hjson"),
    line: prompt.lineNumber,
    content: prompt.content === prompt.title && children.length > 0 ? "" : (prompt.content ?? ""),
    ownContent: prompt.hasOwnContent ? (prompt.content ?? "") : "",
    prefix: resolveKeyList(prompt, prompt.prefix),
    suffix: resolveKeyList(prompt, prompt.suffix),
    options,
    textInputs: isObject(prompt.textInputs) ? Object.keys(prompt.textInputs) : [],
    actions: Array.isArray(prompt.actions) ? prompt.actions : [],
    placeholders: extractPlaceholders(prompt.content),
    py: buildSearchText(prompt.title),
    depth,
    readonly,
    fileRoot: Boolean(prompt.isFileRoot),
    children,
  };
}

export interface BuildPromptMapModelOptions {
  /** Directories and files the library was loaded from, for display. */
  sourceDirs: string[];
  /** Directories whose files may be edited; everything else is read-only. */
  editableRoots: string[];
  editable: boolean;
  errors?: PromptMapError[];
  deeplinkBase?: string;
  now?: Date;
}

/**
 * Turns processed root prompts into the page model, grouped by source file
 * and sorted by file name (numeric aware, so `02 ask` follows `01 inbox`).
 */
export function buildPromptMapModel(rootPrompts: PromptProps[], options: BuildPromptMapModelOptions): PromptMapModel {
  const byFile = new Map<string, PromptProps[]>();
  for (const prompt of rootPrompts) {
    const filePath = prompt.filePath ?? "";
    const list = byFile.get(filePath) ?? [];
    list.push(prompt);
    byFile.set(filePath, list);
  }

  const files: PromptMapFile[] = Array.from(byFile.entries())
    .sort(([a], [b]) => collator.compare(path.basename(a), path.basename(b)))
    .map(([filePath, prompts]) => {
      const readonly = !options.editable || !isInsideAny(filePath, options.editableRoots);
      return {
        name: path.basename(filePath, ".hjson"),
        path: filePath,
        readonly,
        roots: prompts.map((prompt) => toNode(prompt, 0, readonly)),
      };
    });

  let total = 0;
  const count = (node: PromptMapNode): void => {
    total += 1;
    node.children.forEach(count);
  };
  files.forEach((file) => file.roots.forEach(count));

  return {
    generatedAt: (options.now ?? new Date()).toISOString(),
    sourceDirs: options.sourceDirs,
    deeplinkBase: options.deeplinkBase ?? PROMPT_MAP_DEEPLINK_BASE,
    editable: options.editable,
    errors: options.errors ?? [],
    totals: { files: files.length, prompts: total },
    files,
  };
}

/** Collects `.hjson` files under a directory (or the file itself), skipping hidden entries. */
export function collectPromptFiles(target: string): string[] {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(target);
  } catch {
    return [];
  }
  if (stat.isFile()) return target.toLowerCase().endsWith(".hjson") ? [target] : [];
  if (!stat.isDirectory()) return [];
  const files: string[] = [];
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name.startsWith("#")) continue;
    const full = path.join(target, entry.name);
    if (entry.isDirectory()) files.push(...collectPromptFiles(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".hjson")) files.push(full);
  }
  return files;
}

export interface LoadedPromptLibrary {
  files: string[];
  roots: PromptProps[];
  errors: PromptMapError[];
}

/**
 * Loads and processes every prompt file under `sources` with the same rules
 * as the extension, so identifiers and paths match Prompt Lab.
 */
export function loadPromptLibrary(sources: readonly string[]): LoadedPromptLibrary {
  const files = Array.from(new Set(sources.flatMap(collectPromptFiles)));
  const state = createPromptParseState();
  const errors: PromptMapError[] = [];
  const loaded: PromptProps[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch (error) {
      errors.push({ file, message: String(error) });
      continue;
    }
    loaded.push(
      ...parsePromptsFromFile(state, text, file, (message, error) => {
        errors.push({
          file,
          message: `${message} ${error instanceof Error ? error.message : String(error ?? "")}`.trim(),
        });
      }),
    );
  }
  return { files, roots: processPrompts(state, loaded), errors };
}

/** Finds a node by its stable key anywhere in the model. */
export function findPromptMapNode(model: PromptMapModel, key: string): PromptMapNode | undefined {
  const visit = (node: PromptMapNode): PromptMapNode | undefined => {
    if (node.key === key) return node;
    for (const child of node.children) {
      const hit = visit(child);
      if (hit) return hit;
    }
    return undefined;
  };
  for (const file of model.files) {
    for (const root of file.roots) {
      const hit = visit(root);
      if (hit) return hit;
    }
  }
  return undefined;
}
