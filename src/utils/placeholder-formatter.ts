import fs from "fs";
import path from "path";
import { readDirectoryContentsSync } from "./file-system-utils";
import { expandPath } from "./path-alias-utils";

export type SpecificReplacements = {
  input?: string;
  clipboard?: string;
  selection?: string;
  currentApp?: string;
  allApp?: string;
  browserContent?: string;
  now?: string;
  promptTitles?: string;
  prompts?: string;
  diff?: string;
};

type PlaceholderKey = keyof SpecificReplacements;
type PlaceholderInfo = { alias?: string };

const PLACEHOLDERS: Record<PlaceholderKey, PlaceholderInfo> = {
  input: { alias: "i" },
  selection: { alias: "s" },
  clipboard: { alias: "c" },
  currentApp: {},
  allApp: {},
  browserContent: {},
  now: { alias: "n" },
  promptTitles: { alias: "pt" },
  prompts: { alias: "ps" },
  diff: {},
};

const ALIAS_TO_KEY = new Map<string, PlaceholderKey>(
  Object.entries(PLACEHOLDERS)
    .filter(([, { alias }]) => alias)
    .map(([key, { alias }]) => [alias as string, key as PlaceholderKey]),
);

const PH_REG = /{{(?:(file|option|content):)?([^}]+)}}/g;
const isNonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

export const toPlaceholderKey = (p: string): PlaceholderKey | undefined =>
  (ALIAS_TO_KEY.get(p) ?? (p as PlaceholderKey)) satisfies PlaceholderKey;

export const FINDER_SELECTION_MARKER = "__IS_FINDER_SELECTION__";

const FINDER_FILE_PLACEHOLDER_REG = new RegExp(FINDER_SELECTION_MARKER + "\\{\\{file:([^}]+)\\}\\}", "g");

export function extractFinderSelectionPaths(text?: string): string[] {
  if (!text || !text.includes(FINDER_SELECTION_MARKER)) return [];

  const paths: string[] = [];
  FINDER_FILE_PLACEHOLDER_REG.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FINDER_FILE_PLACEHOLDER_REG.exec(text)) !== null) {
    paths.push(match[1].trim());
  }
  return paths;
}

function isRecursivePlaceholder(directive: string | undefined, body: string): boolean {
  if (directive) return false;

  const parts = body.split("|");
  const firstPartTrimmed = parts[0].trim();
  const potentialStandardKey = toPlaceholderKey(firstPartTrimmed);

  if (potentialStandardKey && potentialStandardKey in PLACEHOLDERS) {
    return false;
  }
  return true;
}

export function buildEffectiveMap(raw: Partial<SpecificReplacements> & Record<string, unknown>) {
  const m = new Map<PlaceholderKey, string>();
  Object.entries(raw).forEach(([k, v]) => {
    if (k in PLACEHOLDERS && isNonEmpty(v as string)) m.set(k as PlaceholderKey, (v as string).trim());
  });
  if (!m.has("now")) m.set("now", new Date().toLocaleString());
  return m;
}

function safeResolveAbsolute(given: string, root?: string): string | Error {
  const trimmed = expandPath(given).trim();
  if (path.isAbsolute(trimmed)) {
    return trimmed;
  }

  if (!root) {
    return new Error(`Root directory not configured for relative path: ${trimmed}`);
  }

  const resolved = path.resolve(root, trimmed);
  const normalizedRoot = path.resolve(root);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
    return new Error(`Path traversal detected for: ${trimmed}`);
  }

  return resolved;
}

/**
 * Reads the file or directory a `{{file:...}}` / `{{content:...}}` placeholder
 * points at. `file` labels the result with its path; `content` returns the
 * bare text.
 */
function resolvePathPlaceholderSync(directive: "file" | "content", body: string, root?: string): string {
  const absOrErr = safeResolveAbsolute(body, root);
  if (absOrErr instanceof Error) return `[Error: ${absOrErr.message}]`;

  const withHeader = directive === "file";

  try {
    const stats = fs.statSync(absOrErr);
    if (stats.isFile()) {
      const fileContent = fs.readFileSync(absOrErr, "utf-8").replace(/{{/g, "\\{\\{");
      return withHeader ? `File: ${body.trim()}\n${fileContent}\n\n` : fileContent;
    }
    if (stats.isDirectory()) {
      const content = readDirectoryContentsSync(absOrErr, "").replace(/{{/g, "\\{\\{");
      return withHeader ? `Directory: ${body.trim()}${path.sep}\n${content}` : content;
    }
    return `[Unsupported path type: ${body}]`;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return `[Path not found: ${body}]`;
    if (code === "EACCES") return `[Permission denied: ${body}]`;
    return `[Error accessing path: ${body}]`;
  }
}

/**
 * Value of an `{{option:key}}` placeholder: the chosen value when the options
 * form supplied one, otherwise the first entry of the prompt's option list.
 */
function resolveOptionValue(incoming: Record<string, unknown>, key: string): string | undefined {
  const optionValue = getPropertyByPath(incoming, key);
  if (optionValue === undefined) {
    return undefined;
  }
  if (Array.isArray(optionValue)) {
    return String(optionValue[0]);
  }
  if (optionValue && typeof optionValue === "object") {
    const firstKey = Object.keys(optionValue)[0];
    return String((optionValue as Record<string, unknown>)[firstKey]);
  }
  return String(optionValue);
}

export function getPropertyByPath(obj: unknown, path: string): unknown {
  if (!obj || typeof obj !== "object" || !path) {
    return undefined;
  }

  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || typeof current !== "object") {
      return undefined;
    }

    const index = parseInt(part, 10);
    if (!isNaN(index) && Array.isArray(current)) {
      current = current[index];
      continue;
    }

    current = (current as Record<string, unknown>)[part];

    if (current === undefined) {
      return undefined;
    }
  }

  return current;
}

export function placeholderFormatter(
  text: string,
  incoming: SpecificReplacements & Record<string, unknown> = {},
  root?: string,
  options: { resolveFile?: boolean } = { resolveFile: false },
): string {
  if (!text) return text;

  const map = buildEffectiveMap(incoming);

  let currentText = text;
  let iteration = 0;
  const MAX_ITERATIONS = 10;

  while (iteration < MAX_ITERATIONS) {
    let changedInIteration = false;
    iteration++;

    PH_REG.lastIndex = 0;

    const iterationResult = currentText.replace(PH_REG, (match, directive, body) => {
      if (!isRecursivePlaceholder(directive, body)) {
        return match;
      }

      const result = processPlaceholder(body, incoming, map, root, options);
      if (result !== match) {
        changedInIteration = true;
      }
      return result;
    });

    currentText = iterationResult;

    if (!changedInIteration) {
      break;
    }
  }

  if (iteration >= MAX_ITERATIONS) {
    console.warn(
      `Maximum placeholder recursion depth (${MAX_ITERATIONS}) exceeded, some placeholders may not be fully resolved`,
    );
  }

  PH_REG.lastIndex = 0;

  currentText = currentText.replace(PH_REG, (match, directive, body) => {
    const trimmedBody = body.trim();

    if (directive === undefined && isRecursivePlaceholder(directive, trimmedBody)) {
      if (trimmedBody.includes("|")) {
        const result = processPlaceholder(trimmedBody, incoming, map, root, options);
        if (result !== match) {
          return result;
        }
      }
      return match;
    }

    if (directive === "file" || directive === "content") {
      if (!options.resolveFile) {
        return `{{${directive}:${trimmedBody}}}`;
      }
      return resolvePathPlaceholderSync(directive, trimmedBody, root);
    }

    if (directive === "option") {
      return resolveOptionValue(incoming, trimmedBody) ?? `{{option:${trimmedBody}}}`;
    }

    const resolvedValue = processPlaceholder(trimmedBody, incoming, map, root, options);

    if (resolvedValue.includes(FINDER_SELECTION_MARKER)) {
      const processLine = (line: string): string => {
        const actualValue = line.startsWith(FINDER_SELECTION_MARKER)
          ? line.substring(FINDER_SELECTION_MARKER.length)
          : line;

        const filePathMatch = actualValue.match(/^{{file:([^}]+)}}$/);
        if (filePathMatch && filePathMatch[1]) {
          if (options.resolveFile) {
            return resolvePathPlaceholderSync("file", filePathMatch[1], root);
          }
          return actualValue;
        }

        return actualValue;
      };

      return resolvedValue
        .split("\n")
        .map((line) => processLine(line))
        .join("\n");
    }

    return resolvedValue;
  });

  currentText = currentText.replace(/\\\{\\\{/g, "{{");

  return currentText;
}

export function resolvePlaceholders(
  text: string,
  standardReplacements: Partial<SpecificReplacements> = {},
): Set<PlaceholderKey> {
  const usedStandardKeys = new Set<PlaceholderKey>();
  const map = buildEffectiveMap(standardReplacements);

  let m: RegExpExecArray | null;
  PH_REG.lastIndex = 0;
  while ((m = PH_REG.exec(text))) {
    const [, directive, rawBody] = m as unknown as [string, string | undefined, string];
    if (directive === "file") continue;

    const body = rawBody.trim();

    let chosenStandardKey: PlaceholderKey | undefined;
    for (const part of body.split("|")) {
      const key = toPlaceholderKey(part.trim());
      if (!key) continue;

      if (key in PLACEHOLDERS && map.has(key)) {
        chosenStandardKey = key;
        break;
      }
      if (key === "clipboard" && !chosenStandardKey) {
        chosenStandardKey = "clipboard";
        break;
      }
    }

    if (chosenStandardKey) {
      usedStandardKeys.add(chosenStandardKey);
    }
  }
  return usedStandardKeys;
}

/**
 * Resolves a placeholder without a directive: a prompt property, a standard
 * placeholder, or a `a|b|c` fallback chain whose parts may carry directives.
 * Returns the placeholder unchanged when nothing resolves.
 */
function processPlaceholder(
  body: string,
  incoming: SpecificReplacements & Record<string, unknown>,
  map: Map<PlaceholderKey, string>,
  root?: string,
  options: { resolveFile?: boolean } = { resolveFile: false },
): string {
  const content = body.trim();

  const providedValue = getPropertyByPath(incoming, content);
  if (providedValue !== undefined) {
    const standardKey = toPlaceholderKey(content);
    if (standardKey && map.has(standardKey)) {
      return map.get(standardKey)!;
    }

    if (typeof providedValue === "string") {
      return providedValue.trim() !== "" ? providedValue : `{{${body}}}`;
    }
    return String(providedValue);
  }

  for (const part of content.split("|")) {
    const trimmedPart = part.trim();

    const directiveMatch = trimmedPart.match(/^(option|file|content):(.+)$/);

    if (directiveMatch) {
      const [, partDirective, partBody] = directiveMatch;

      if (partDirective === "option") {
        const optionValue = resolveOptionValue(incoming, partBody);
        if (optionValue !== undefined) {
          return optionValue;
        }
      } else if (options.resolveFile) {
        const pathResult = resolvePathPlaceholderSync(partDirective as "file" | "content", partBody, root);
        if (!pathResult.startsWith("[")) {
          return pathResult;
        }
      }
    } else {
      const key = toPlaceholderKey(trimmedPart);
      if (!key) continue;

      const standardValue = map.get(key);
      if (standardValue !== undefined && standardValue !== "") {
        return standardValue;
      }
    }
  }

  return `{{${body}}}`;
}
