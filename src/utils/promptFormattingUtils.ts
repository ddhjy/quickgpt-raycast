import { Icon, List } from "@raycast/api";
import { PromptProps } from "../managers/PromptManager";
import { SpecificReplacements, placeholderFormatter, resolvePlaceholders } from "./placeholderFormatter";
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
        foundPrompt = promptManager.findPrompt(
            (prompt) =>
                !!prompt.identifier && selectionText.includes(`${IDENTIFIER_PREFIX}${prompt.identifier}`)
        );
        if (foundPrompt?.identifier) {
            cleanedText = selectionText
                .split(`${IDENTIFIER_PREFIX}${foundPrompt.identifier}`)
                .slice(1)
                .join("")
                .trim();
        }
    }

    return [foundPrompt, cleanedText];
}

/**
 * Builds the final, fully formatted prompt content string.
 * 1. Applies prefix commands (e.g., language directives) to the base content.
 * 2. Ensures dynamic placeholders like `promptTitles` are up-to-date.
 * 3. Uses `placeholderFormatter` to substitute all standard and file/directory placeholders.
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

    // Step 1: Apply prefix commands (Changed order based on description)
    const processedContent = applyPrefixCommandsToContent(currentContent, prompt.prefixCMD);

    // Step 2: Update dynamic replacements like promptTitles (if necessary)
    const updatedReplacements = {
        ...replacements,
        promptTitles: replacements.promptTitles || getIndentedPromptTitles(),
    };

    // Step 3: Call the unified placeholderFormatter, passing relativeRootDir
    const formattedContent = placeholderFormatter(processedContent, updatedReplacements, relativeRootDir, { resolveFile: true });

    // Step 4: Remove the old {{file:filepath}} handling logic block
    // const filePlaceholderPattern = /{{file:([^}]+)}}/g;
    // formattedContent = formattedContent.replace(filePlaceholderPattern, (match, filePath) => { ... });

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

    // Resolve placeholders *excluding* clipboard for icon generation
    const usedPlaceholders = resolvePlaceholders(content, replacements);

    console.log("usedPlaceholders", usedPlaceholders);

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