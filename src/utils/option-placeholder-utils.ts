import { PromptProps } from "../managers/prompt-manager";
import { SpecificReplacements, getPropertyByPath, toPlaceholderKey, buildEffectiveMap } from "./placeholder-formatter";

/**
 * Find option placeholders that would actually be used in fallback chains given current replacement values.
 * This function simulates the placeholder resolution process to determine which option: directives
 * would be reached and used in the fallback chain.
 *
 * @param prompt The Prompt object to check
 * @param replacements Current replacement values (to determine which fallbacks would be used)
 * @returns Array of option property names that would actually be used
 */
export function findUsedOptionPlaceholders(prompt: PromptProps, replacements: SpecificReplacements): string[] {
  const usedOptionKeys: string[] = [];
  if (!prompt.content) return usedOptionKeys;

  // Build effective replacement map using shared formatter util
  const map = buildEffectiveMap(replacements as SpecificReplacements & Record<string, unknown>);

  // Regex to find all placeholders including fallback chains
  const regex = /{{(?:(file|option):)?([^}]+)}}/g;
  let match;

  while ((match = regex.exec(prompt.content)) !== null) {
    const [, directive, body] = match;

    // Only process placeholders without directives (potential fallback chains)
    if (!directive) {
      const content = body.trim();

      // Check if this contains a fallback chain
      if (content.includes("|")) {
        const parts = content.split("|");

        for (const part of parts) {
          const trimmedPart = part.trim();

          // Check if this part has an option directive
          const directiveMatch = trimmedPart.match(/^option:(.+)$/);
          if (directiveMatch) {
            const optionKey = directiveMatch[1];

            // Check if this option would be reached (i.e., all previous parts in chain are empty)
            let shouldUseThisOption = true;
            const currentPartIndex = parts.indexOf(part);

            for (let i = 0; i < currentPartIndex; i++) {
              const prevPart = parts[i].trim();

              // Check if previous part has value
              if (prevPart.startsWith("option:") || prevPart.startsWith("file:")) {
                // Skip directive parts in fallback evaluation for simplicity
                continue;
              } else {
                // Check if it's a standard placeholder with value
                const key = toPlaceholderKey(prevPart);
                if (key && map.has(key) && map.get(key) !== "") {
                  shouldUseThisOption = false;
                  break;
                }
              }
            }

            if (shouldUseThisOption) {
              // Verify the option exists and has values in the prompt
              const optionValue = getPropertyByPath(prompt, optionKey);
              if (
                (Array.isArray(optionValue) && optionValue.length > 0) ||
                (optionValue &&
                  typeof optionValue === "object" &&
                  !Array.isArray(optionValue) &&
                  Object.keys(optionValue).length > 0)
              ) {
                usedOptionKeys.push(optionKey);
              }
              break; // Found the option that would be used in this chain
            }
          }
        }
      }
    } else if (directive === "option") {
      // Direct option placeholder
      const optionKey = body.trim();
      const optionValue = getPropertyByPath(prompt, optionKey);
      if (
        (Array.isArray(optionValue) && optionValue.length > 0) ||
        (optionValue &&
          typeof optionValue === "object" &&
          !Array.isArray(optionValue) &&
          Object.keys(optionValue).length > 0)
      ) {
        usedOptionKeys.push(optionKey);
      }
    }
  }

  // Return after deduplication
  return Array.from(new Set(usedOptionKeys));
}
