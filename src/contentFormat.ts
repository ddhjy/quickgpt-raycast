export type SpecificReplacements = {
  query?: string;
  clipboard?: string;
  selection?: string;
  currentApp?: string;
};

const placeholders: Record<string, { key: keyof SpecificReplacements; literal: string }> = {
  i: { key: 'query', literal: '<输入文本>' },
  s: { key: 'selection', literal: '<选中文本>' },
  c: { key: 'clipboard', literal: '<剪贴板文本>' },
};

export function contentFormat(text: string, specificReplacements: SpecificReplacements): string {
  const compositeReplacements: Record<string, string> = {};

  // 处理预定义的替换项
  for (const [shortKey, { key, literal }] of Object.entries(placeholders)) {
    const value = specificReplacements[key];
    if (value) {
      compositeReplacements[shortKey] = value;
      compositeReplacements[`p:${shortKey}`] = literal;
    }
  }

  // 处理其他替换项
  for (const [key, value] of Object.entries(specificReplacements)) {
    if (value && !Object.values(placeholders).some(p => p.key === key)) {
      compositeReplacements[key] = value;
    }
  }

  // 创建正则表达式匹配所有占位符，包括复合占位符
  const placeholderPattern = /{{([^}]+)}}/g;

  // 替换文本中的占位符
  return text.replace(placeholderPattern, (_, placeholderContent) => {
    const parts = placeholderContent.split('|');
    for (const part of parts) {
      if (compositeReplacements[part]) {
        return compositeReplacements[part];
      }
    }
    return _;
  });
}