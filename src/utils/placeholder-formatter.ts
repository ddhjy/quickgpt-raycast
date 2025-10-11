/**
 * This file provides utility functions for formatting text with placeholders.
 * It supports both synchronous and asynchronous implementations for replacing:
 * - Simple placeholders (input, clipboard, selection, etc.)
 * - File content placeholders for reading files/directories
 * - Fallback handling with alias support
 * - Property path access for referencing prompt object properties
 *
 * The formatter processes placeholders in a two-phase approach for better control:
 * 1. Recursive phase: iteratively resolves property references and fallbacks
 * 2. One-time phase: processes standard context placeholders, files, and options
 */

import fs from "fs";
import path from "path";
import { readDirectoryContentsSync } from "./file-system-utils";

/* Types & Constants */

export type SpecificReplacements = {
  input?: string;
  clipboard?: string;
  selection?: string;
  currentApp?: string;
  allApp?: string;
  browserContent?: string;
  now?: string;
  promptTitles?: string;
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
};

const ALIAS_TO_KEY = new Map<string, PlaceholderKey>(
  Object.entries(PLACEHOLDERS)
    .filter(([, { alias }]) => alias)
    .map(([key, { alias }]) => [alias as string, key as PlaceholderKey]),
);

/* Utility Functions */

const PH_REG = /{{(?:(file|option):)?([^}]+)}}/g;
const isNonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

export const toPlaceholderKey = (p: string): PlaceholderKey | undefined =>
  (ALIAS_TO_KEY.get(p) ?? (p as PlaceholderKey)) satisfies PlaceholderKey;

// Special marker for Finder-selected files
const FINDER_SELECTION_MARKER = "__IS_FINDER_SELECTION__";

/**
 * Determines if a placeholder should be recursively processed in phase 1.
 * Property references and fallback chains not starting with standard placeholder are recursive.
 *
 * @param directive The placeholder directive (file, option, or undefined)
 * @param body The placeholder body text
 * @returns True if this placeholder should be processed recursively
 */
function isRecursivePlaceholder(directive: string | undefined, body: string): boolean {
  if (directive) return false; // file: or option: are not recursive

  const parts = body.split("|");
  const firstPartTrimmed = parts[0].trim();
  const potentialStandardKey = toPlaceholderKey(firstPartTrimmed);

  // Check if the first part is a standard placeholder key or alias
  if (potentialStandardKey && potentialStandardKey in PLACEHOLDERS) {
    // If it starts with a standard placeholder (e.g., {{input|prop}}), handle in phase 2, non-recursive
    return false;
  }
  // If not starting with a standard placeholder, it's a property reference or property-based fallback (recursive)
  return true;
}

/**
 * Builds an effective replacement map from raw replacements.
 * Filters out empty values, trims strings, and adds the current time if not present.
 *
 * @param raw The raw replacement values to process
 * @returns A Map of valid placeholder keys to their replacement values
 */
export function buildEffectiveMap(raw: Partial<SpecificReplacements> & Record<string, unknown>) {
  const m = new Map<PlaceholderKey, string>();
  // Only process standard placeholder keys defined in SpecificReplacements
  Object.entries(raw).forEach(([k, v]) => {
    if (k in PLACEHOLDERS && isNonEmpty(v as string)) m.set(k as PlaceholderKey, (v as string).trim());
  });
  if (!m.has("now")) m.set("now", new Date().toLocaleString());
  return m;
}

/* File Placeholder Handling */

/**
 * Safely resolves a path to an absolute path, with security checks.
 *
 * @param given The path to resolve
 * @param root The root directory for relative paths
 * @returns The resolved absolute path or an Error if resolution fails
 */
function safeResolveAbsolute(given: string, root?: string): string | Error {
  console.log(`Attempting to resolve path: "${given}", root: "${root || "not set"}"`);

  const trimmed = given.trim();
  if (path.isAbsolute(trimmed)) {
    console.log(`Processing absolute path: "${trimmed}"`);
    return trimmed;
  }

  if (!root) {
    const error = `Root directory not configured for relative path: ${trimmed}`;
    console.error(error);
    return new Error(error);
  }

  const resolved = path.resolve(root, trimmed);
  console.log(`Resolved relative path: "${trimmed}" => "${resolved}"`);

  const normalizedRoot = path.resolve(root);
  if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
    const error = `Path traversal detected for: ${trimmed}`;
    console.error(error);
    return new Error(error);
  }

  return resolved;
}

/**
 * Resolves a file placeholder synchronously, reading file or directory contents.
 * This function escapes any placeholders in the file content to prevent them from being processed.
 *
 * @param body The file path to resolve
 * @param root The root directory for relative paths
 * @returns Formatted string containing file/directory content or error message
 */
function resolveFilePlaceholderSync(body: string, root?: string): string {
  const absOrErr = safeResolveAbsolute(body, root);
  if (absOrErr instanceof Error) return `[Error: ${absOrErr.message}]`;

  try {
    const stats = fs.statSync(absOrErr);
    if (stats.isFile()) {
      // Escape placeholders in file content by replacing {{ with \\{\\{ to prevent further processing
      let fileContent = fs.readFileSync(absOrErr, "utf-8");
      // Use a temporary replacement that's unlikely to exist in the content
      fileContent = fileContent.replace(/{{/g, "\\{\\{");
      return `File: ${body.trim()}\n${fileContent}\n\n`;
    }
    if (stats.isDirectory()) {
      const header = `Directory: ${body.trim()}${path.sep}\n`;
      const content = readDirectoryContentsSync(absOrErr, "");
      // Escape placeholders in directory content
      const escapedContent = content.replace(/{{/g, "\\{\\{");
      return `${header}${escapedContent}`;
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
 * Gets a property value from an object using a dot-notation path.
 * Safely traverses the object hierarchy and returns undefined if any path segment is invalid.
 *
 * @param obj The object to get the property from
 * @param path The dot-notation path (e.g., "title", "subprompts.0.title")
 * @returns The property value, or undefined if the path doesn't resolve
 */
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

    // Handle array indices
    const index = parseInt(part, 10);
    if (!isNaN(index) && Array.isArray(current)) {
      current = current[index];
      continue;
    }

    // Handle object properties
    current = (current as Record<string, unknown>)[part];

    if (current === undefined) {
      return undefined;
    }
  }

  return current;
}

/* Synchronous Placeholder Formatter */

/**
 * Formats a string by replacing placeholders with actual values using a two-phase approach:
 * 1. Iteratively resolves property references and fallbacks until stable
 * 2. One-time processing of standard context placeholders, files, and options
 *
 * Special handling for {{selection}} containing file paths from Finder ensures correct file resolution.
 *
 * @param text The text containing placeholders to format
 * @param incoming The replacement values for placeholders and any other properties for p: notation
 * @param root The root directory for file placeholder resolution
 * @param options Additional options for formatting
 * @returns The formatted text with all placeholders replaced
 */
export function placeholderFormatter(
  text: string,
  incoming: SpecificReplacements & Record<string, unknown> = {},
  root?: string,
  options: { resolveFile?: boolean } = { resolveFile: false },
): string {
  if (!text) return text;

  const map = buildEffectiveMap(incoming);

  // === Phase 1: Iterative processing of property references and fallbacks ===
  let currentText = text;
  let iteration = 0;
  const MAX_ITERATIONS = 10; // Prevent infinite recursion

  // Continue until no more changes or reach max iterations
  while (iteration < MAX_ITERATIONS) {
    let changedInIteration = false;
    iteration++;

    PH_REG.lastIndex = 0;

    const iterationResult = currentText.replace(PH_REG, (match, directive, body) => {
      if (!isRecursivePlaceholder(directive, body)) {
        return match;
      }

      const result = processPlaceholder(directive, body, incoming, map, root, options);
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
        const result = processPlaceholder(directive, trimmedBody, incoming, map, root, options);
        if (result !== match) {
          return result;
        }
      }
      return match;
    }

    if (directive === "file") {
      if (!options.resolveFile) {
        return `{{file:${trimmedBody}}}`;
      }
      return resolveFilePlaceholderSync(trimmedBody, root);
    }

    if (directive === "option") {
      const optionValue = getPropertyByPath(incoming, trimmedBody);
      if (optionValue !== undefined) {
        if (Array.isArray(optionValue)) {
          return String(optionValue[0]);
        }
        if (optionValue && typeof optionValue === "object") {
          const firstKey = Object.keys(optionValue)[0];
          return String((optionValue as Record<string, unknown>)[firstKey]);
        }
        return String(optionValue);
      }
      return `{{option:${trimmedBody}}}`;
    }

    const resolvedValue = processPlaceholder(directive, trimmedBody, incoming, map, root, options);

    if (resolvedValue.startsWith(FINDER_SELECTION_MARKER)) {
      const actualValue = resolvedValue.substring(FINDER_SELECTION_MARKER.length);

      const filePathMatch = actualValue.match(/^{{file:([^}]+)}}$/);
      if (filePathMatch && filePathMatch[1]) {
        if (options.resolveFile) {
          return resolveFilePlaceholderSync(filePathMatch[1], root);
        } else {
          return actualValue;
        }
      }

      return actualValue;
    }

    return resolvedValue;
  });

  currentText = currentText.replace(/\\\{\\\{/g, "{{");

  return currentText;
}

/* Placeholder Resolution */

/**
 * Scans a template and returns the set of *standard* placeholder keys that would be used
 * during formatting with the given replacement values. Ignores property placeholders.
 *
 * @param text The text to scan for placeholders
 * @param standardReplacements The available replacement values (standard placeholders only for icon resolution)
 * @returns A Set of standard placeholder keys (e.g., 'input', 'clipboard') that would be used
 */
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
 * Helper function to process a single placeholder
 * Used by both sync and async versions to maintain consistent logic
 *
 * @param directive The directive (file, option, or undefined)
 * @param body The placeholder body text (without {{}})
 * @param incoming The replacement values and properties object
 * @param map The processed map of standard placeholders
 * @param root The root directory for file placeholder resolution (optional)
 * @param options Additional options for formatting
 * @returns The processed value for the placeholder
 */
function processPlaceholder(
  directive: string | undefined,
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

  if (directive === "option") {
    const optionValue = getPropertyByPath(incoming, content);
    if (optionValue !== undefined) {
      if (Array.isArray(optionValue)) {
        return String(optionValue[0]);
      }
      if (optionValue && typeof optionValue === "object") {
        const firstKey = Object.keys(optionValue)[0];
        return String((optionValue as Record<string, unknown>)[firstKey]);
      }
      return String(optionValue);
    }
    return `{{option:${content}}}`;
  }

  if (directive === "file") {
    return `[Path not found: ${content}]`;
  }

  // Handle fallback chain or single placeholder
  const parts = content.includes("|") ? content.split("|") : [content];

  for (const part of parts) {
    const trimmedPart = part.trim();

    // Check if this part has a directive (e.g., "option:key" or "file:path")
    const directiveMatch = trimmedPart.match(/^(option|file):(.+)$/);

    if (directiveMatch) {
      const [, partDirective, partBody] = directiveMatch;

      if (partDirective === "option") {
        const optionValue = getPropertyByPath(incoming, partBody);
        if (optionValue !== undefined) {
          if (Array.isArray(optionValue)) {
            return String(optionValue[0]);
          }
          if (optionValue && typeof optionValue === "object") {
            const firstKey = Object.keys(optionValue)[0];
            return String((optionValue as Record<string, unknown>)[firstKey]);
          }
          return String(optionValue);
        }
      } else if (partDirective === "file" && options.resolveFile) {
        const fileContent = resolveFilePlaceholderSync(partBody, root);
        if (!fileContent.startsWith("[")) {
          // Not an error message
          return fileContent;
        }
      }
    } else {
      // Handle regular placeholder key
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
