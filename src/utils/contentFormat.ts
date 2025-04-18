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
 * @returns The formatted text.
 */
export function contentFormat(text: string, specificReplacements: SpecificReplacements): string {
  const cleanedReplacements = Object.fromEntries(
    Object.entries(specificReplacements).filter(([, value]) => value !== '')
  ) as SpecificReplacements;

  // 自动添加当前时间
  if (!cleanedReplacements.now) {
    cleanedReplacements.now = new Date().toLocaleString();
  }

  const placeholderPattern = /{{([^}]+)}}/g;

  return text.replace(placeholderPattern, (match, placeholderContent) => {
    // 恢复原有逻辑
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

    // Return the original placeholder if no replacement is found
    return match;
  });
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
          break; // 使用第一个可用的占位符
        }
      }
    }
  }

  return usedPlaceholders;
}
