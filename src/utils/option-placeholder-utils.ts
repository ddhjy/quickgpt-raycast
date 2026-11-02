import type { PromptProps } from "../managers/prompt-manager";
import { SpecificReplacements, getPropertyByPath, toPlaceholderKey, buildEffectiveMap } from "./placeholder-formatter";

function hasOptionValues(prompt: PromptProps, optionKey: string): boolean {
  const optionValue = getPropertyByPath(prompt, optionKey);
  if (Array.isArray(optionValue)) {
    return optionValue.length > 0;
  }
  return !!optionValue && typeof optionValue === "object" && Object.keys(optionValue).length > 0;
}

/**
 * Option keys the prompt will actually ask for: every `{{option:key}}`, plus
 * the first `option:key` of a fallback chain unless an earlier standard
 * placeholder in that chain already has a value.
 */
export function findUsedOptionPlaceholders(prompt: PromptProps, replacements: SpecificReplacements): string[] {
  const usedOptionKeys = new Set<string>();
  if (!prompt.content) return [];

  const map = buildEffectiveMap(replacements as SpecificReplacements & Record<string, unknown>);

  const regex = /{{(?:(file|option):)?([^}]+)}}/g;
  let match;

  while ((match = regex.exec(prompt.content)) !== null) {
    const [, directive, body] = match;

    if (directive === "option") {
      const optionKey = body.trim();
      if (hasOptionValues(prompt, optionKey)) {
        usedOptionKeys.add(optionKey);
      }
      continue;
    }

    if (directive || !body.includes("|")) {
      continue;
    }

    for (const part of body.trim().split("|")) {
      const trimmedPart = part.trim();
      const optionMatch = trimmedPart.match(/^option:(.+)$/);

      if (optionMatch) {
        if (hasOptionValues(prompt, optionMatch[1])) {
          usedOptionKeys.add(optionMatch[1]);
        }
        break;
      }

      if (trimmedPart.startsWith("file:") || trimmedPart.startsWith("content:")) {
        continue;
      }

      // An earlier standard placeholder with a value wins the chain, so the option is never asked for.
      const key = toPlaceholderKey(trimmedPart);
      if (key && map.has(key) && map.get(key) !== "") {
        break;
      }
    }
  }

  return Array.from(usedOptionKeys);
}
