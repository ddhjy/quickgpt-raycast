import fs from "fs";
import path from "path";
import { readDirectoryContentsSync } from "./fileSystemUtils";

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
 * Formats the content by replacing placeholders with specific values.
 * @param text - The text to format.
 * @param specificReplacements - The specific values for replacement.
 * @param relativeRootDir - The relative root directory for file placeholders.
 * @returns The formatted text.
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
