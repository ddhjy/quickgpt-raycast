export type SpecificReplacements = {
  query?: string;
  clipboard?: string;
  selection?: string;
  currentApp?: string;
  [key: string]: string | undefined;
};

const literalPlaceholder: Record<keyof SpecificReplacements, string> = {
  query: "<输入文本>",
  clipboard: "<剪贴板文本>",
  selection: "<选中文本>",
  currentApp: "<当前应用>",
};

const inputPlaceholder: Record<string, keyof SpecificReplacements> = {
  i: "query",
  s: "selection",
  c: "clipboard",
};

const generateCombinations = (keys: string[]): string[] => {
  const combinations: string[] = [];
  const total = 1 << keys.length; // 2^n combinations

  for (let i = 1; i < total; i++) { // 从1开始，避免空组合
    const combo = keys.filter((_, index) => (i & (1 << index)) !== 0);
    combinations.push(combo.join("|"));
  }

  return combinations;
};

const allCombinations = generateCombinations(Object.keys(inputPlaceholder));

export function contentFormat(text: string, specificReplacements: SpecificReplacements): string {
  const compositeReplacements: Record<string, string> = {};

  // 处理预定义的替换项
  for (const combination of allCombinations) {
    const keysInCombination = combination.split("|") as (keyof SpecificReplacements)[];
    for (const key of keysInCombination) {
      const replacementKey = inputPlaceholder[key as string];
      const value = specificReplacements[replacementKey];
      if (value) {
        compositeReplacements[`{{${combination}}}`] = value;
        compositeReplacements[`{{p:${combination}}}`] = literalPlaceholder[replacementKey];
        break;
      }
    }
  }

  // 处理其他替换项
  for (const [key, value] of Object.entries(specificReplacements)) {
    if (value && !(key in inputPlaceholder)) {
      compositeReplacements[`{{${key}}}`] = value;
    }
  }

  // 创建正则表达式匹配所有占位符
  const placeholderPattern = new RegExp(
    Object.keys(compositeReplacements)
      .map(tag => tag.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'))
      .join('|'),
    'g'
  );

  // 替换文本中的占位符
  return text.replace(placeholderPattern, matched => compositeReplacements[matched] || matched);
}