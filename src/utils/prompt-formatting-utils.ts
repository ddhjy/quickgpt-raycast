import { randomUUID } from "node:crypto";
import type { PromptProps } from "../managers/prompt-manager";
import { SpecificReplacements, placeholderFormatter } from "./placeholder-formatter";
import promptManager from "../managers/prompt-manager";
import { readScreenText } from "./screen-text";

const IDENTIFIER_PREFIX = "quickgpt-";

/**
 * Wraps content with the `{{key}}` placeholders named by the prompt's
 * comma-separated `prefix` and `suffix` properties, one per line.
 */
export function wrapWithPrefixAndSuffix(prompt: PromptProps): string {
  const toPlaceholders = (keysList: string | undefined) =>
    Array.from(new Set((keysList ?? "").split(",").map((key) => key.trim())))
      .filter((key) => key.length > 0)
      .map((key) => `{{${key}}}`)
      .join("\n");

  const prefix = toPlaceholders(prompt.prefix);
  const suffix = toPlaceholders(prompt.suffix);
  return (prefix ? `${prefix}\n` : "") + (prompt.content || "") + (suffix ? `\n${suffix}` : "");
}

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

export async function buildFormattedPromptContent(
  prompt: PromptProps,
  replacements: SpecificReplacements,
  relativeRootDir?: string,
  readers: { screenText?: () => Promise<string>; clipboard?: () => Promise<string> } = {},
): Promise<string> {
  const contentWithPlaceholders = wrapWithPrefixAndSuffix(prompt);

  const mergedReplacements = {
    ...prompt,
    ...replacements,
    promptTitles: replacements.promptTitles || getIndentedPromptTitles(),
    prompts: replacements.prompts || getIndentedPromptsWithContent(),
  };

  const clipboardMarker = readers.clipboard && replacements.clipboard === undefined ? randomUUID() : undefined;
  if (clipboardMarker) mergedReplacements.clipboard = clipboardMarker;
  let clipboardError: Error | undefined;
  const format = async (screenText: string | Error) => {
    const render = () =>
      placeholderFormatter(contentWithPlaceholders, mergedReplacements, relativeRootDir, {
        resolveFile: true,
        screenText,
        clipboardError,
      });
    const content = render();
    if (!clipboardMarker || !readers.clipboard || !content.includes(clipboardMarker)) return content;
    try {
      mergedReplacements.clipboard = await readers.clipboard();
    } catch (error) {
      mergedReplacements.clipboard = "";
      clipboardError = error instanceof Error ? error : new Error(String(error));
    }
    return render();
  };

  // Let the existing formatter select fallback branches and expand nested prompt properties.
  // Insert captured text after formatting so braces, file directives, and dollar signs stay literal.
  const marker = randomUUID();
  const content = await format(marker);
  if (!content.includes(marker)) return content;

  let screenText: string;
  try {
    screenText =
      typeof mergedReplacements.screenText === "string"
        ? mergedReplacements.screenText
        : await (readers.screenText ?? readScreenText)();
  } catch (error) {
    return format(error instanceof Error ? error : new Error(String(error)));
  }
  return screenText.trim()
    ? content.replaceAll(marker, () => screenText)
    : format(new Error("No visible text was available through macOS Accessibility."));
}

export function getIndentedPromptTitles(): string {
  const rootPrompts = promptManager.getRootPrompts();
  const result: string[] = [];

  function processPrompt(prompt: PromptProps, level: number = 0) {
    const indent = "  ".repeat(level);

    let contentSummary = "";
    if (prompt.content) {
      const cleanContent = wrapWithPrefixAndSuffix(prompt)
        .replace(/{{.*?}}\n/g, "")
        .replace(/\n/g, " ")
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
