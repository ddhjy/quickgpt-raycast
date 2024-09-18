export type SpecificReplacements = {
  input?: string;
  clipboard?: string;
  selection?: string;
  currentApp?: string;
  browserContent?: string;
};

type PlaceholderInfo = {
  literal?: string;
  alias?: string;
};

const placeholders: Record<keyof SpecificReplacements, PlaceholderInfo> = {
  input: { literal: '<输入文本>', alias: 'i' },
  selection: { literal: '<选中文本>', alias: 's' },
  clipboard: { literal: '<剪贴板文本>', alias: 'c' },
  currentApp: { literal: '<当前应用>' },
  browserContent: { literal: '<浏览器内容>' },
};

// 创建别名到键的映射
const aliasMap: Record<string, keyof SpecificReplacements> = Object.entries(placeholders).reduce(
  (acc, [key, placeholder]) => {
    if (placeholder.alias) {
      acc[placeholder.alias] = key as keyof SpecificReplacements;
    }
    return acc;
  },
  {} as Record<string, keyof SpecificReplacements>
);

/**
 * 格式化内容，替换占位符为具体值
 * @param text 要格式化的文本
 * @param specificReplacements 替换的具体值
 * @returns 格式化后的文本
 */
export function contentFormat(text: string, specificReplacements: SpecificReplacements): string {
  const placeholderPattern = /{{([^}]+)}}/g;

  return text.replace(placeholderPattern, (_, placeholderContent) => {
    const isPrefixed = placeholderContent.startsWith('p:');
    const content = isPrefixed ? placeholderContent.slice(2) : placeholderContent;
    const parts = content.split('|');

    for (const part of parts) {
      const key = aliasMap[part] || (part as keyof SpecificReplacements);
      let replacement: string | undefined;

      if (isPrefixed) {
        replacement = specificReplacements[key] ? placeholders[key]?.literal || `<${key}>` : undefined;
      } else {
        replacement = specificReplacements[key];
      }

      if (replacement) {
        return replacement;
      }
    }

    // 如果没有找到合适的替换，则返回原始占位符
    return _;
  });
}