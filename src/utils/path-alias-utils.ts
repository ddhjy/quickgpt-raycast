import { getPreferenceValues } from "@raycast/api";
import { homedir } from "os";

const CURRENT_FLINK_PREFIX = "📁 ";
const FLINK_PREFIXES = ["fk:", "flink:", "📁:", CURRENT_FLINK_PREFIX, "📁\u00A0", "📁\u3000"];
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const FLINK_PREFIX_REGEX = new RegExp(`(${FLINK_PREFIXES.map(escapeRegExp).join("|")})`);

export function getPathAliases(): Record<string, string> {
  try {
    const preferences = getPreferenceValues<Preferences.PromptLab>();
    const aliases = JSON.parse(preferences.pathAliases || "{}");
    const home = homedir();
    const expandedAliases: Record<string, string> = {};

    for (const [key, value] of Object.entries(aliases)) {
      if (typeof value === "string") {
        expandedAliases[key] = value.replace(/^~/, home);
      }
    }
    return expandedAliases;
  } catch (error) {
    console.error("Failed to parse path aliases:", error);
    return {};
  }
}

export function expandPath(inputPath: string): string {
  let path = preprocessPath(inputPath);
  path = expandAliases(path, getPathAliases());
  return path;
}

export function preprocessPath(path: string): string {
  path = path.split("\n")[0].trim();
  path = path.replace(/\[([^\]]+)\]/g, "$1.");
  path = path.replace(/\{\{([^}]+)\}\}/g, "$1.");
  path = removeFlinkPrefix(path);
  path = removeMarkdownSyntax(path);
  return path;
}

function removeFlinkPrefix(inputPath: string): string {
  return inputPath.replace(FLINK_PREFIX_REGEX, "").trim();
}

function removeMarkdownSyntax(path: string): string {
  return path.replace(/(\*\*|__)(.*?)\1/g, "$2");
}

/**
 * Replaces every alias occurrence with its directory, longest alias first so
 * `work.notes` is not shadowed by `work`. A `.` after an alias acts as a path
 * separator (`work.notes` -> `<work dir>/notes`).
 */
function expandAliases(inputPath: string, aliases: Record<string, string>): string {
  const entries = Object.entries(aliases)
    .map(([alias, directory]) => ({ alias: alias.replace(/\/+$/, ""), directory: directory.replace(/\/+$/, "") }))
    .sort((a, b) => b.alias.length - a.alias.length);

  let result = inputPath;
  let hasReplacement = true;

  while (hasReplacement) {
    hasReplacement = false;

    for (const { alias, directory } of entries) {
      const index = result.indexOf(alias);
      if (index !== -1) {
        const before = result.slice(0, index);
        let after = result.slice(index + alias.length);

        if (after.startsWith(".")) {
          after = after.slice(1);
        }

        let replacement = directory;
        if (after && !after.startsWith("/") && !replacement.endsWith("/")) {
          replacement += "/";
        }

        result = before + replacement + after;
        hasReplacement = true;
        break;
      }
    }
  }

  return result.replace(/\/+/g, "/");
}
