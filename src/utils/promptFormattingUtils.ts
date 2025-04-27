import { Icon, List } from "@raycast/api";
import { PromptProps } from "../managers/PromptManager";
import { SpecificReplacements, placeholderFormatter, resolvePlaceholders, getPropertyByPath } from "./placeholderFormatter";
import promptManager from "../managers/PromptManager";

/**
 * This file provides utility functions specifically related to formatting and processing
 * prompt content before it's displayed or sent to an AI.
 * Includes handling of prefix commands, resolving quick prompts from context,
 * building the final formatted content with placeholders, and generating UI elements like icons and indented titles.
 */

const IDENTIFIER_PREFIX = "quickgpt-";
const SUPPORTED_PREFIX_COMMANDS: { [key: string]: string } = {
    c: "简体中文作答",
    ne: "NO EXPLANATION",
    np: "Do not use plugins and data analysis",
    cot: "",
    ns: "Do not use tool and Web Search",
};
const DEFAULT_PREFIX_COMMANDS = ["c"];

const placeholderIcons: { [key: string]: Icon } = {
    input: Icon.TextInput,
    clipboard: Icon.Clipboard,
    selection: Icon.Text,
    currentApp: Icon.Window,
    browserContent: Icon.Globe,
    promptTitles: Icon.List
};

/**
 * Applies predefined prefix commands (like language instructions or behavioral directives)
 * to the beginning of the prompt content based on the `prefixCMD` property of a prompt.
 * Supports adding commands and negating default commands (e.g., `!c` to remove default Chinese response).
 * If `prefixCMD` includes "none", no prefixes are added.
 *
 * @param content The original prompt content string.
 * @param prefixCommands A comma-separated string of prefix command keys (e.g., "c,!ne").
 * @returns The content with the resolved prefix command lines prepended.
 */
export function applyPrefixCommandsToContent(content: string, prefixCommands: string | undefined): string {
    // If prefixCommands contains "none", return the original content
    if (prefixCommands?.includes("none")) {
        return content;
    }

    let activePrefixCommands = [...DEFAULT_PREFIX_COMMANDS];
    const prefixes = prefixCommands?.split(",");

    prefixes?.forEach((cmd) => {
        if (cmd.startsWith("!")) {
            activePrefixCommands = activePrefixCommands.filter((c) => c !== cmd.substring(1));
        } else {
            activePrefixCommands.push(cmd);
        }
    });

    activePrefixCommands = Array.from(new Set(activePrefixCommands));

    activePrefixCommands.reverse().forEach((cmd) => {
        content = `! ${SUPPORTED_PREFIX_COMMANDS[cmd]}\n` + content;
    });

    return content;
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
export function getQuickPrompt(selectionText: string, identifier?: string, filePath?: string): [PromptProps | undefined, string] {
    let foundPrompt;
    let cleanedText = selectionText;

    if (identifier) {
        foundPrompt = promptManager.findPrompt(
            (prompt) => `${IDENTIFIER_PREFIX}${prompt.identifier}` === identifier
        );
        if (foundPrompt && filePath) {
            foundPrompt.filePath = filePath;
        }
    } else {
        const targetIdentifierPrefix = `${IDENTIFIER_PREFIX}`;
        // 1. Remove leading whitespace from selectionText for checking
        const trimmedSelectionText = selectionText.trimStart();
        let identifierStartIndexInOriginal = -1; // Record the start index of the identifier in the original text

        // 2. Find the first matching prompt
        foundPrompt = promptManager.findPrompt((prompt) => {
            if (prompt.identifier) {
                const fullIdentifier = `${targetIdentifierPrefix}${prompt.identifier}`;
                // 3. Use the trimmed text for startsWith check
                if (trimmedSelectionText.startsWith(fullIdentifier)) {
                    // 4. If matched, record the start position in the *original* selectionText
                    //    Calculating leading whitespace length is more accurate than indexOf
                    const leadingWhitespaceLength = selectionText.length - trimmedSelectionText.length;
                    identifierStartIndexInOriginal = leadingWhitespaceLength; // Identifier starts right after whitespace
                    return true; // Stop searching once found
                }
            }
            return false;
        });

        // 5. If a matching prompt is found
        if (foundPrompt?.identifier && identifierStartIndexInOriginal !== -1) {
            const fullIdentifier = `${targetIdentifierPrefix}${foundPrompt.identifier}`;
            // Extract substring from the end of the identifier in the original text, then trim the result
            cleanedText = selectionText.substring(identifierStartIndexInOriginal + fullIdentifier.length).trim();
        } else {
            // If no match found, cleanedText remains the original selectionText
            cleanedText = selectionText;
        }
    }

    // Note: The return statement should be outside the if/else structure
    return [foundPrompt, cleanedText];
}

/**
 * Builds the final, fully formatted prompt content string.
 * 1. Merges prompt properties and standard replacements (standard ones take priority).
 * 2. Applies prefix commands (e.g., language directives) to the base content.
 * 3. Uses `placeholderFormatter` to substitute all placeholders, including {{p:promptProperty}} and {{file:...}}.
 *
 * @param prompt The PromptProps object containing the base content and configuration.
 * @param replacements An object containing the values for standard placeholders (clipboard, selection, etc.).
 * @param relativeRootDir The root directory needed by `placeholderFormatter` to resolve relative `{{file:...}}` paths.
 * @returns The final formatted content string ready to be used (e.g., sent to AI).
 */
export function buildFormattedPromptContent(
    prompt: PromptProps,
    replacements: SpecificReplacements,
    relativeRootDir?: string
): string {
    const currentContent = prompt.content || ""; // Ensure content is a string

    // Step 1: Merge prompt properties and standard replacements.
    // Standard replacements (like input, clipboard) should override prompt properties if names conflict.
    const mergedReplacements = {
        ...prompt, // Spread prompt properties first (lower priority)
        ...replacements, // Spread standard replacements second (higher priority)
        promptTitles: replacements.promptTitles || getIndentedPromptTitles(), // Ensure promptTitles is fresh
    };

    // Step 2: Apply prefix commands
    const processedContent = applyPrefixCommandsToContent(currentContent, prompt.prefixCMD);

    // Step 3: Call the unified placeholderFormatter with the merged replacements
    const formattedContent = placeholderFormatter(
        processedContent,
        mergedReplacements,
        relativeRootDir,
        { resolveFile: true }
    );

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
    replacements: Omit<SpecificReplacements, 'clipboard'>
): List.Item.Accessory[] {
    if (!content) return [];

    // Resolve placeholders *using only standard replacements* for icon generation
    const usedPlaceholders = resolvePlaceholders(content, replacements);

    // Remove debug log
    // console.log("usedPlaceholders", usedPlaceholders);

    const placeholderIconsArray: List.Item.Accessory[] = [];
    usedPlaceholders.forEach((placeholder) => {
        const icon = placeholderIcons[placeholder];
        if (icon) {
            placeholderIconsArray.push({ icon });
        }
    });

    return placeholderIconsArray;
}

/**
 * Generates a string containing a hierarchically indented list of all prompt titles.
 * Each title is followed by a short summary of its content (first 20 chars, excluding prefix commands).
 * Used for the `{{promptTitles}}` placeholder.
 *
 * @returns A newline-separated string of indented prompt titles and summaries.
 */
export function getIndentedPromptTitles(): string {
    const rootPrompts = promptManager.getRootPrompts();
    const result: string[] = [];

    function processPrompt(prompt: PromptProps, level: number = 0) {
        const indent = '  '.repeat(level);

        // Get content summary (first 20 characters)
        let contentSummary = '';
        if (prompt.content) {
            // Process content, apply prefix commands
            let processedContent = prompt.content;

            // Apply prefix commands
            processedContent = applyPrefixCommandsToContent(processedContent, prompt.prefixCMD);

            // Remove newlines and prefix command lines from content for better summary display
            const cleanContent = processedContent
                .replace(/^! .*\n/gm, '') // Remove prefix command lines
                .replace(/\n/g, ' ')      // Replace newlines with spaces
                .trim();

            contentSummary = cleanContent.length > 20
                ? cleanContent.substring(0, 20) + '...'
                : cleanContent;

            if (contentSummary) {
                contentSummary = ` - ${contentSummary}`;
            }
        }

        result.push(`${indent}${prompt.title}${contentSummary}`);

        if (prompt.subprompts && prompt.subprompts.length > 0) {
            prompt.subprompts.forEach(subprompt => {
                processPrompt(subprompt, level + 1);
            });
        }
    }

    rootPrompts.forEach(prompt => {
        processPrompt(prompt);
    });

    return result.join('\n');
}

/**
 * 扫描prompt.content，查找有效的{{option:propertyName}}占位符
 * 仅返回prompt对象中实际存在的且为非空数组的属性名
 * 
 * @param prompt 要检查的Prompt对象
 * @returns 有效的选项属性名数组
 */
export function findOptionPlaceholders(prompt: PromptProps): string[] {
    const optionKeys: string[] = [];
    if (!prompt.content) return optionKeys;

    // 简单的正则用于检测option占位符
    const regex = /{{option:([^}]+)}}/g;
    let match;

    while ((match = regex.exec(prompt.content)) !== null) {
        const propertyName = match[1].trim();
        // 检查prompt对象自身是否有这个属性，并且它是一个非空数组
        const propValue = getPropertyByPath(prompt, propertyName);
        if (Array.isArray(propValue) && propValue.length > 0) {
            optionKeys.push(propertyName);
        }
    }

    // 去重后返回
    return Array.from(new Set(optionKeys));
} 