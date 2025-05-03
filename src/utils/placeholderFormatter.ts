/**
 * This file provides utility functions for formatting text with placeholders.
 * It supports both synchronous and asynchronous implementations for replacing:
 * - Simple placeholders (input, clipboard, selection, etc.)
 * - File content placeholders for reading files/directories
 * - Fallback handling with alias support
 * - Property path access for referencing prompt object properties
 *
 * The formatter processes all placeholders in a single RegExp scan for efficiency.
 */

import fs from "fs";
import path from "path";
import { readDirectoryContentsSync } from "./fileSystemUtils";

/* Types & Constants */

export type SpecificReplacements = {
  input?: string;
  clipboard?: string;
  selection?: string;
  currentApp?: string;
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
  browserContent: {},
  now: { alias: "n" },
  promptTitles: { alias: "pt" },
};

// alias ⇒ key
const ALIAS_TO_KEY = new Map<string, PlaceholderKey>(
  Object.entries(PLACEHOLDERS)
    .filter(([, { alias }]) => alias)
    .map(([key, { alias }]) => [alias as string, key as PlaceholderKey]),
);

/* Utility Functions */

const PH_REG = /{{(?:(file|option):)?([^}]+)}}/g; // Modified: Single regex for all placeholders including option
const isNonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

const toPlaceholderKey = (p: string): PlaceholderKey | undefined =>
  (ALIAS_TO_KEY.get(p) ?? (p as PlaceholderKey)) satisfies PlaceholderKey;

/**
 * Builds an effective replacement map from raw replacements.
 * Filters out empty values, trims strings, and adds the current time if not present.
 *
 * @param raw The raw replacement values to process
 * @returns A Map of valid placeholder keys to their replacement values
 */
function buildEffectiveMap(raw: Partial<SpecificReplacements> & Record<string, unknown>) {
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

  if (!resolved.startsWith(root)) {
    const error = `Path traversal detected for: ${trimmed}`;
    console.error(error);
    return new Error(error);
  }

  return resolved;
}

/**
 * Resolves a file placeholder synchronously, reading file or directory contents.
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
    if (stats.isFile()) return `File: ${body.trim()}\n${fs.readFileSync(absOrErr, "utf-8")}\n\n`;
    if (stats.isDirectory()) {
      const header = `Directory: ${body.trim()}${path.sep}\n`;
      const content = readDirectoryContentsSync(absOrErr, "");
      return `${header}${content}`;
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
 * Formats a string by replacing placeholders with actual values.
 * Handles both regular placeholders and file content placeholders.
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
  options: { resolveFile?: boolean; recursionLevel?: number; hasResolvedFile?: boolean } = {
    resolveFile: false,
    recursionLevel: 0,
    hasResolvedFile: false,
  },
): string {
  // Limit recursion depth to prevent infinite recursion
  const MAX_RECURSION = 3;
  const currentLevel = options.recursionLevel || 0;

  if (currentLevel > MAX_RECURSION) {
    console.warn(`Maximum recursion depth (${MAX_RECURSION}) exceeded, stopping parsing`);
    return text;
  }

  const map = buildEffectiveMap(incoming);

  // Reset regex state
  PH_REG.lastIndex = 0;

  let hasResolvedFile = options.hasResolvedFile || false;

  let result = text.replace(PH_REG, (_, directive: string | undefined, body: string) => {
    /* File placeholders */
    if (directive === "file") {
      // If file resolution is disabled, return placeholder as-is
      if (!options.resolveFile) {
        return `{{file:${body}}}`;
      }

      const result = resolveFilePlaceholderSync(body, root);
      hasResolvedFile = true;
      return result;
    }

    /* Regular placeholders */
    return processPlaceholder(directive, body, incoming, map);
  });

  // Process nested placeholders if no file has been resolved yet
  if (PH_REG.test(result) && currentLevel < MAX_RECURSION && !hasResolvedFile) {
    // Reset regex state
    PH_REG.lastIndex = 0;
    // Process recursively once
    result = placeholderFormatter(result, incoming, root, {
      ...options,
      recursionLevel: currentLevel + 1,
      hasResolvedFile,
    });
  }

  return result;
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
  standardReplacements: Partial<SpecificReplacements> = {}, // Use only standard replacements for icon logic
): Set<PlaceholderKey> {
  const usedStandardKeys = new Set<PlaceholderKey>();
  // Use only standard replacements to build the map for icon determination
  const map = buildEffectiveMap(standardReplacements);

  let m: RegExpExecArray | null;
  // Reset regex state
  PH_REG.lastIndex = 0;
  while ((m = PH_REG.exec(text))) {
    const [, directive, rawBody] = m as unknown as [string, string | undefined, string];
    if (directive === "file") continue; // Skip file placeholders

    const body = rawBody.trim();

    // Check ONLY for standard placeholders and their fallbacks
    let chosenStandardKey: PlaceholderKey | undefined;
    for (const part of body.split("|")) {
      const key = toPlaceholderKey(part.trim());
      if (!key) continue;

      // Check if it's a known standard placeholder AND has a non-empty value in the map
      if (key in PLACEHOLDERS && map.has(key)) {
        chosenStandardKey = key;
        break; // Found the first valid standard placeholder in the chain
      }
      // Special case: If clipboard is in the chain, always consider it potentially used,
      // even if empty, because its value is fetched later dynamically in some actions
      if (key === "clipboard" && !chosenStandardKey) {
        chosenStandardKey = "clipboard";
        break;
      }
    }

    if (chosenStandardKey) {
      usedStandardKeys.add(chosenStandardKey);
    }
    // IMPORTANT: Do NOT check for property paths here, as this function is for standard placeholder icons
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
 * @returns The processed value for the placeholder
 */
function processPlaceholder(
  directive: string | undefined,
  body: string,
  incoming: SpecificReplacements & Record<string, unknown>,
  map: Map<PlaceholderKey, string>,
): string {
  const content = body.trim(); // Trim the placeholder body

  // --- Priority 1: Check incoming replacements first ---
  const providedValue = getPropertyByPath(incoming, content);
  if (providedValue !== undefined) {
    // Check if it's a standard placeholder that has a value in the map
    const standardKey = toPlaceholderKey(content);
    if (standardKey && map.has(standardKey)) {
      return map.get(standardKey)!;
    }

    // Otherwise use the provided value if it's a string
    if (typeof providedValue === "string") {
      // Don't replace with empty strings
      return providedValue.trim() !== "" ? providedValue : `{{${body}}}`;
    }
    // Convert non-string values to string representation
    return String(providedValue);
  }

  // --- Priority 2: Handle 'option:' directive ---
  if (directive === "option") {
    // Return the original placeholder - this will be detected by PromptListItem
    return `{{option:${content}}}`;
  }

  // --- Priority 3: Handle 'file:' directive ---
  if (directive === "file") {
    return `[Path not found: ${content}]`;
  }

  // --- Priority 4: Handle standard placeholder fallback chain ---
  // e.g., {{input|selection}}
  for (const part of content.split("|")) {
    const key = toPlaceholderKey(part.trim());
    if (!key) continue;

    const standardValue = map.get(key);
    if (standardValue !== undefined && standardValue !== "") {
      return standardValue;
    }
  }

  // --- Fallback: No replacement found ---
  return `{{${body}}}`;
}
