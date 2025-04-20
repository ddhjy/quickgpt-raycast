import fs from "fs";
import path from "path";
import { readDirectoryContentsSync } from "./fileSystemUtils";

/**
 * This file provides functions for handling placeholder substitution within prompt templates.
 * It supports standard placeholders (like `{{clipboard}}`, `{{selection}}`) with optional aliases (`{{c}}`, `{{s}}`),
 * and a special `{{file:path/to/file_or_dir}}` placeholder to include file or directory contents.
 */

export type SpecificReplacements = {
  input?: string;
  clipboard?: string;
  selection?: string;
  currentApp?: string;
  browserContent?: string;
  now?: string;
  promptTitles?: string;
};

type PlaceholderInfo = {
  literal?: string;
  alias?: string;
};

const placeholders: Record<keyof SpecificReplacements, PlaceholderInfo> = {
  input: { literal: "<输入文本>", alias: "i" },
  selection: { literal: "<选中文本>", alias: "s" },
  clipboard: { literal: "<剪贴板文本>", alias: "c" },
  currentApp: { literal: "<当前应用>" },
  browserContent: { literal: "<浏览器内容>" },
  now: { literal: "<当前时间>", alias: "n" },
  promptTitles: { literal: "<提示词标题>", alias: "pt" },
};

// Create alias to key mapping
const aliasMap = Object.fromEntries(
  Object.entries(placeholders)
    .filter(([, placeholder]) => placeholder.alias)
    .map(([key, placeholder]) => [placeholder.alias, key as keyof SpecificReplacements])
) as Record<string, keyof SpecificReplacements>;

/**
 * Replaces placeholders within a given text string with their corresponding values.
 *
 * Supported placeholders:
 * - Standard: `{{input}}`, `{{selection}}`, `{{clipboard}}`, `{{currentApp}}`, `{{browserContent}}`, `{{now}}`, `{{promptTitles}}`
 *   (and their aliases: `i`, `s`, `c`, `n`, `pt`)
 * - Optional prefix `p:` (e.g., `{{p:clipboard}}`) to insert the placeholder literal (e.g., `<剪贴板文本>`) only if the value is non-empty.
 * - File/Directory: `{{file:path/to/your/file_or_directory}}`. Reads the content of the specified file or directory (recursively).
 *   Supports absolute paths and relative paths (resolved against `relativeRootDir`).
 *
 * @param text The input text containing placeholders.
 * @param specificReplacements An object mapping placeholder keys (or aliases) to their replacement values.
 * @param relativeRootDir The root directory to resolve relative paths against for `{{file:...}}` placeholders. Required if using relative paths.
 * @returns The text with all recognized placeholders substituted.
 */
export function placeholderFormatter(
  text: string,
  specificReplacements: SpecificReplacements,
  relativeRootDir?: string
): string {
  const cleanedReplacements = Object.fromEntries(
    Object.entries(specificReplacements).filter(([, value]) => value !== '')
  ) as SpecificReplacements;

  // Automatically add current time
  if (!cleanedReplacements.now) {
    cleanedReplacements.now = new Date().toLocaleString();
  }

  // Process standard placeholders first
  const standardPlaceholderPattern = /{{(?!file:)([^}]+)}}/g;
  const partiallyFormattedText = text.replace(standardPlaceholderPattern, (match, placeholderContent) => {
    const isPrefixed = placeholderContent.startsWith("p:");
    const content = isPrefixed ? placeholderContent.slice(2) : placeholderContent;
    const parts = content.split("|");

    for (const part of parts) {
      const key = aliasMap[part] || (part as keyof SpecificReplacements);

      if (key in cleanedReplacements) {
        const value = cleanedReplacements[key];
        if (isPrefixed) {
          return value ? placeholders[key]?.literal || `<${key}>` : match;
        } else if (value) {
          return value;
        }
      }
    }
    return match;
  });

  // Now process {{file:filepath}} placeholders
  const filePlaceholderPattern = /{{file:([^}]+)}}/g;
  const fullyFormattedText = partiallyFormattedText.replace(filePlaceholderPattern, (match, filePath) => {
    const trimmedPath = filePath.trim();
    let absoluteTargetPath: string;

    if (path.isAbsolute(trimmedPath)) {
      absoluteTargetPath = trimmedPath;
    } else {
      if (!relativeRootDir) {
        console.error(`Error: Relative path "${trimmedPath}" provided, but no custom prompt directory is configured as the root.`);
        return `[Error: Root directory not configured for relative path: ${trimmedPath}]`;
      }
      absoluteTargetPath = path.resolve(relativeRootDir, trimmedPath);
      // Basic security check: ensure the resolved path is still within the root directory
      if (!absoluteTargetPath.startsWith(relativeRootDir)) {
        console.error(`Error: Relative path traversal detected. Attempted access outside of root directory ${relativeRootDir}. Path: ${trimmedPath}`);
        return `[Error: Path traversal detected for: ${trimmedPath}]`;
      }
    }

    try {
      const stats = fs.statSync(absoluteTargetPath);
      if (stats.isFile()) {
        return fs.readFileSync(absoluteTargetPath, 'utf-8');
      } else if (stats.isDirectory()) {
        return readDirectoryContentsSync(absoluteTargetPath, path.basename(absoluteTargetPath));
      } else {
        console.warn(`Warning: Path is neither a file nor a directory: ${absoluteTargetPath}`);
        return `[Unsupported path type: ${trimmedPath}]`;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.warn(`Warning: File or directory not found for placeholder: ${absoluteTargetPath}`);
        return `[Path not found: ${trimmedPath}]`;
      } else if ((error as NodeJS.ErrnoException).code === 'EACCES') {
        console.error(`Error: Permission denied for path: ${absoluteTargetPath}`, error);
        return `[Permission denied: ${trimmedPath}]`;
      } else {
        console.error(`Error accessing path specified in placeholder: ${absoluteTargetPath}`, error);
        return `[Error accessing path: ${trimmedPath}]`;
      }
    }
  });

  return fullyFormattedText;
}

/**
 * Identifies which specific placeholders (like clipboard, selection) are actually used
 * and have a corresponding non-empty value provided in a given text template.
 * This is useful for determining which context information is relevant for a prompt.
 *
 * @param text The text template containing placeholders.
 * @param specificReplacements An object containing the potential replacement values.
 * @returns A Set containing the keys (e.g., 'clipboard', 'selection') of the used and available placeholders.
 */
export function resolvePlaceholders(
  text: string,
  specificReplacements: SpecificReplacements
): Set<string> {
  const cleanedReplacements = Object.fromEntries(
    Object.entries(specificReplacements).filter(([, value]) => value !== "")
  ) as SpecificReplacements;

  const placeholderPattern = /{{([^}]+)}}/g;
  const usedPlaceholders = new Set<string>();

  let match;
  while ((match = placeholderPattern.exec(text)) !== null) {
    const placeholderContent = match[1];
    const isPrefixed = placeholderContent.startsWith("p:");
    const content = isPrefixed ? placeholderContent.slice(2) : placeholderContent;
    const parts = content.split("|");

    for (const part of parts) {
      const key = aliasMap[part] || (part as keyof SpecificReplacements);

      if (key in cleanedReplacements) {
        const value = cleanedReplacements[key];
        if (value) {
          usedPlaceholders.add(key);
          break;
        }
      }
    }
  }

  return usedPlaceholders;
}
