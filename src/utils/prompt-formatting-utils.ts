import { Icon, List } from "@raycast/api";
import { PromptProps } from "../managers/prompt-manager";
import {
  SpecificReplacements,
  placeholderFormatter,
  resolvePlaceholders,
  getPropertyByPath,
} from "./placeholder-formatter";
import promptManager from "../managers/prompt-manager";

/**
 * This file provides utility functions specifically related to formatting and processing
 * prompt content before it's displayed or sent to an AI.
 * Includes handling of prefix commands, resolving quick prompts from context,
 * building the final formatted content with placeholders, and generating UI elements like icons and indented titles.
 */

const IDENTIFIER_PREFIX = "quickgpt-";

const placeholderIcons: { [key: string]: Icon } = {
  input: Icon.TextInput,
  clipboard: Icon.Clipboard,
  selection: Icon.TextCursor,
  currentApp: Icon.Window,
  allApp: Icon.AppWindowGrid2x2,
  browserContent: Icon.Globe,
  promptTitles: Icon.List,
  file: Icon.Document,
  diff: Icon.CodeBlock,
};

/**
 * Generates placeholder string based on a comma-separated property keys list.
 * Keys listed are directly converted to {{key}} placeholders.
 * Relies on these keys existing as properties in the prompt object (defined in HJSON).
 * No defaults, no validation against a predefined list, no "none", no "!".
 *
 * @param keysList Comma-separated string of property keys (e.g., "myPromptSetting,lang").
 * @param position Specifies placeholder position, affecting how newlines are added. 'prefix' adds trailing newline, 'suffix' adds leading newline.
 * @returns Placeholder string with appropriate newlines based on position parameter.
 */
export function generatePlaceholders(keysList: string | undefined, position: "prefix" | "suffix"): string {
  let activeKeys: string[] = [];
  const providedKeysTrimmed = keysList?.trim();

  if (providedKeysTrimmed && providedKeysTrimmed.length > 0) {
    activeKeys = providedKeysTrimmed
      .split(",")
      .map((key) => key.trim())
      // Filter out any empty strings resulting from splitting (e.g., "key1,,key2")
      .filter((key) => key.length > 0); // Only check for non-empty keys

    // Ensure uniqueness
    activeKeys = Array.from(new Set(activeKeys));
  }
  // If keys list is null, undefined, or empty, activeKeys remains []

  // Generate placeholder strings using the keys directly
  const placeholderString = activeKeys.map((key) => `{{${key}}}`).join("\n");

  // Add newline based on position
  if (position === "prefix") {
    return placeholderString + (placeholderString.length > 0 ? "\n" : ""); // Add trailing newline if needed
  } else {
    // suffix
    return (placeholderString.length > 0 ? "\n" : "") + placeholderString; // Add leading newline if needed
  }
}

/**
 * Generates placeholder string based on prefix property.
 * Keys listed in prefix are directly converted to {{key}} placeholders.
 *
 * @param prefix Comma-separated string of property keys (e.g., "myPromptSetting,lang").
 * @returns Placeholder string (e.g., "{{myPromptSetting}}\n{{lang}}\n") or empty string.
 */
export function generatePrefixPlaceholders(prefix: string | undefined): string {
  return generatePlaceholders(prefix, "prefix");
}

/**
 * Generates placeholder string based on suffix property.
 * Keys listed in suffix are directly converted to {{key}} placeholders.
 *
 * @param suffix Comma-separated string of property keys (e.g., "finalDirective,signature").
 * @returns Placeholder string (e.g., "\n{{finalDirective}}\n{{signature}}") or empty string.
 */
export function generateSuffixPlaceholders(suffix: string | undefined): string {
  return generatePlaceholders(suffix, "suffix");
}

/**
 * Attempts to find a "quick prompt" based on the current selection text or a target identifier.
 * A quick prompt is triggered if the selection text contains a prompt identifier
 * (e.g., "Translate this: quickgpt-translate123") or if a specific identifier is provided.
 * It also cleans the selection text by removing the identifier if found.
 *
 * @param selectionText The currently selected text, potentially containing a prompt identifier.
 * @param identifier An optional specific prompt identifier to look for (e.g., from deeplink arguments).
 * @param filePath Optional file path associated with the prompt call (used if identifier is provided).
 * @returns A tuple: [foundPrompt | undefined, cleanedSelectionText].
 *          `foundPrompt` is the PromptProps object if a quick prompt is identified.
 *          `cleanedSelectionText` is the selection text with the identifier removed (if applicable).
 */
export function getQuickPrompt(
  selectionText: string,
  identifier?: string,
  filePath?: string,
): [PromptProps | undefined, string] {
  let foundPrompt;
  let cleanedText = selectionText;

  if (identifier) {
    foundPrompt = promptManager.findPrompt((prompt) => `${IDENTIFIER_PREFIX}${prompt.identifier}` === identifier);
    if (foundPrompt && filePath) {
      foundPrompt.filePath = filePath;
    }
  } else {
    const targetIdentifierPrefix = `${IDENTIFIER_PREFIX}`;
    const trimmedSelectionText = selectionText.trimStart();
    let identifierStartIndexInOriginal = -1;

    foundPrompt = promptManager.findPrompt((prompt) => {
      if (prompt.identifier) {
        const fullIdentifier = `${targetIdentifierPrefix}${prompt.identifier}`;
        if (trimmedSelectionText.startsWith(fullIdentifier)) {
          const leadingWhitespaceLength = selectionText.length - trimmedSelectionText.length;
          identifierStartIndexInOriginal = leadingWhitespaceLength;
          return true;
        }
      }
      return false;
    });

    if (foundPrompt?.identifier && identifierStartIndexInOriginal !== -1) {
      const fullIdentifier = `${targetIdentifierPrefix}${foundPrompt.identifier}`;
      cleanedText = selectionText.substring(identifierStartIndexInOriginal + fullIdentifier.length).trim();
    } else {
      cleanedText = selectionText;
    }
  }

  return [foundPrompt, cleanedText];
}

/**
 * Builds the final, fully formatted prompt content string.
 * Generates prefix placeholders based on prefix property, prepends these placeholders to the original content,
 * and uses `placeholderFormatter` to substitute all placeholders based on prompt properties and runtime replacements.
 *
 * @param prompt The PromptProps object containing the base content and configuration.
 * @param replacements An object containing the values for standard placeholders (clipboard, selection, etc.).
 * @param relativeRootDir The root directory needed by `placeholderFormatter` to resolve relative `{{file:...}}` paths.
 * @returns The final formatted content string ready to be used (e.g., sent to AI).
 */
export function buildFormattedPromptContent(
  prompt: PromptProps,
  replacements: SpecificReplacements,
  relativeRootDir?: string,
): string {
  const currentContent = prompt.content || "";

  const prefixPlaceholderString = generatePrefixPlaceholders(prompt.prefix);

  const suffixPlaceholderString = generateSuffixPlaceholders(prompt.suffix);

  const contentWithPlaceholders = prefixPlaceholderString + currentContent + suffixPlaceholderString;

  const mergedReplacements = {
    ...prompt,
    ...replacements,
    promptTitles: replacements.promptTitles || getIndentedPromptTitles(),
    prompts: replacements.prompts || getIndentedPromptsWithContent(),
  };

  const formattedContent = placeholderFormatter(contentWithPlaceholders, mergedReplacements, relativeRootDir, {
    resolveFile: true,
  });

  return formattedContent;
}

/**
 * Determines which placeholder icons (e.g., Clipboard, Text, Globe) should be displayed
 * as accessories for a prompt list item based on the placeholders used in its content
 * and the available replacement values.
 *
 * @param content The raw prompt content string (may contain placeholders).
 * @param replacements An object containing the available replacement values for placeholders.
 * @returns An array of `List.Item.Accessory` objects (containing icons) for the used placeholders.
 */
export function getPlaceholderIcons(
  content: string | undefined,
  replacements: Omit<SpecificReplacements, "clipboard">,
): List.Item.Accessory[] {
  if (!content) return [];

  const usedPlaceholders = resolvePlaceholders(content, replacements);

  const placeholderIconsArray: List.Item.Accessory[] = [];
  usedPlaceholders.forEach((placeholder) => {
    const icon = placeholderIcons[placeholder];
    if (icon) {
      placeholderIconsArray.push({ icon });
    }
  });

  const fileRegex = /{{(file|content):[^}]+}}/g;
  if (fileRegex.test(content)) {
    placeholderIconsArray.push({ icon: placeholderIcons.file });
  }

  return placeholderIconsArray;
}

/**
 * Generates a string containing a hierarchically indented list of all prompt titles.
 * Each title is followed by a short summary of its content (first 20 chars).
 * Used for the `{{promptTitles}}` placeholder.
 *
 * @returns A newline-separated string of indented prompt titles and summaries.
 */
export function getIndentedPromptTitles(): string {
  const rootPrompts = promptManager.getRootPrompts();
  const result: string[] = [];

  function processPrompt(prompt: PromptProps, level: number = 0) {
    const indent = "  ".repeat(level);

    // Get content summary (first 20 characters)
    let contentSummary = "";
    if (prompt.content) {
      // Use original content for summary
      let processedContent = prompt.content;

      // Generate prefix and suffix placeholders
      const prefixPlaceholders = generatePrefixPlaceholders(prompt.prefix);
      const suffixPlaceholders = generateSuffixPlaceholders(prompt.suffix);
      processedContent = prefixPlaceholders + processedContent + suffixPlaceholders;

      // Remove newlines and placeholder lines from content for better summary display
      const cleanContent = processedContent
        .replace(/{{.*?}}\n/g, "") // Remove placeholder lines
        .replace(/\n/g, " ") // Replace newlines with spaces
        .trim();

      contentSummary = cleanContent.length > 20 ? cleanContent.substring(0, 20) + "..." : cleanContent;

      if (contentSummary) {
        contentSummary = ` - ${contentSummary}`;
      }
    }

    result.push(`${indent}${prompt.title}${contentSummary}`);

    if (prompt.subprompts && prompt.subprompts.length > 0) {
      prompt.subprompts.forEach((subprompt) => {
        processPrompt(subprompt, level + 1);
      });
    }
  }

  rootPrompts.forEach((prompt) => {
    processPrompt(prompt);
  });

  return result.join("\n");
}

/**
 * Generates a string containing a hierarchically indented list of all prompt titles and their content.
 * Used for the `{{prompts}}` placeholder.
 *
 * @returns A newline-separated string of indented prompt titles and content.
 */
export function getIndentedPromptsWithContent(): string {
  const rootPrompts = promptManager.getRootPrompts();
  const result: string[] = [];

  function processPrompt(prompt: PromptProps, level: number = 0) {
    const indent = "  ".repeat(level);
    const icon = prompt.icon ? `${prompt.icon} ` : "";
    result.push(`${indent}${icon}${prompt.title}`);

    if (prompt.content) {
      const contentIndent = "  ".repeat(level + 1);
      const formattedContent = prompt.content
        .split("\n")
        .map((line) => `${contentIndent}${line}`)
        .join("\n");
      result.push(formattedContent);
    }

    if (prompt.subprompts && prompt.subprompts.length > 0) {
      prompt.subprompts.forEach((subprompt) => {
        processPrompt(subprompt, level + 1);
      });
    }
  }

  rootPrompts.forEach((prompt) => {
    processPrompt(prompt);
  });

  return result.join("\n");
}

/**
 * Scan prompt.content to find valid {{option:propertyName}} placeholders
 * Only return property names that actually exist in the prompt object and are non-empty arrays
 *
 * @param prompt The Prompt object to check
 * @returns Array of valid option property names
 */
export function findOptionPlaceholders(prompt: PromptProps): string[] {
  const optionKeys: string[] = [];
  if (!prompt.content) return optionKeys;

  // Simple regex to detect option placeholders
  const regex = /{{option:([^}]+)}}/g;
  let match;

  while ((match = regex.exec(prompt.content)) !== null) {
    const propertyName = match[1].trim();
    // Check if the prompt object itself has this property and it is a non-empty array
    const propValue = getPropertyByPath(prompt, propertyName);
    if (
      (Array.isArray(propValue) && propValue.length > 0) ||
      (propValue && typeof propValue === "object" && !Array.isArray(propValue) && Object.keys(propValue).length > 0)
    ) {
      optionKeys.push(propertyName);
    }
  }

  // Return after deduplication
  return Array.from(new Set(optionKeys));
}
