type SpecificReplacements = {
  query?: string;
  clipboard?: string;
  selection?: string;
  currentApp?: string;
  [key: string]: string | undefined;
};

const literalPlaceholder: { [K in keyof SpecificReplacements]: string } = {
  query: "<输入文本>",
  clipboard: "<剪贴板文本>",
  selection: "<选中文本>",
  currentApp: "<当前应用>"
};

const inputPlaceholder: { [key: string]: keyof SpecificReplacements } = {
  i: "query",
  s: "selection",
  c: "clipboard",
};

const generateCombinations = (arr: string[]): string[] => {
  if (arr.length === 1) return arr;
  const combinations = [];
  for (let i = 0; i < arr.length; i++) {
    combinations.push(arr[i]);
    const rest = arr.slice(0, i).concat(arr.slice(i + 1));
    for (const restCombination of generateCombinations(rest)) {
      combinations.push(`${arr[i]}|${restCombination}`);
    }
  }
  return combinations;
};

const allCombinations = generateCombinations(Object.keys(inputPlaceholder));

export function contentFormat(text: string, specificReplacements: SpecificReplacements): [string] {
  const compositeReplacements = new Map<string, string>();
  
  // 处理预定义的替换项
  for (const combination of allCombinations) {
    const keysInCombination = combination.split("|");
    for (const key of keysInCombination) {
      const value = specificReplacements[inputPlaceholder[key]];
      if (value) {
        compositeReplacements.set(`{{${combination}}}`, value);
        compositeReplacements.set(`{{p:${combination}}}`, literalPlaceholder[inputPlaceholder[key]]);
        break;
      }
    }
  }
  
  // 处理其他替换项
  for (const [key, value] of Object.entries(specificReplacements)) {
    if (value && !Object.values(inputPlaceholder).includes(key as keyof SpecificReplacements)) {
      compositeReplacements.set(`{{${key}}}`, value);
    }
  }

  // 应用替换
  for (const [tag, value] of compositeReplacements) {
    if (text.includes(tag)) {
      text = text.split(tag).join(value);
    }
  }

  return [text];
}