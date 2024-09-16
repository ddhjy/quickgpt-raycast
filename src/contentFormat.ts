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
  browserContent: {},
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

export function contentFormat(text: string, specificReplacements: SpecificReplacements): string {
  // 创建正则表达式匹配所有占位符
  const placeholderPattern = /{{([^}]+)}}/g;

  // 修改占位符替换逻辑
  return text.replace(placeholderPattern, (_, placeholderContent) => {
    // 检查是否有 'p:' 前缀
    const isPrefixed = placeholderContent.startsWith('p:');
    const content = isPrefixed ? placeholderContent.slice(2) : placeholderContent;

    // 分割可能的多个选项
    const parts = content.split('|');

    for (const part of parts) {
      // 首先尝试通过别名查找对应的键
      const key = aliasMap[part] || (part as keyof SpecificReplacements);

      let replacement: string | undefined;

      if (isPrefixed) {
        // 如果有 'p:' 前缀从 placeholders 获取 literal
        if (specificReplacements[key]) {
          replacement = placeholders[key]?.literal ?? `<${key}>`;
        }
      } else {
        // 否则从 specificReplacements 获取替换值
        replacement = specificReplacements[key];
      }

      if (replacement) {
        return replacement;
      }
    }

    return _;
  });
}