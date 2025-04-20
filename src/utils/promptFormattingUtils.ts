import { Icon, List } from "@raycast/api";
import { PromptProps } from "../managers/PromptManager";
import { SpecificReplacements, placeholderFormatter, resolvePlaceholders } from "./placeholderFormatter";
import promptManager from "../managers/PromptManager";

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
 * Applies prefix commands to content.
 * @param content The original content.
 * @param prefixCommands The prefix commands.
 * @returns The processed content.
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
 * Gets the quick prompt.
 * @param selectionText The selected text.
 * @param identifier The target identifier.
 * @param filePath Optional file path associated with the call.
 * @returns A tuple containing the quick prompt (or undefined) and the cleaned selected text.
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
 * Builds the formatted prompt content with all placeholders replaced.
 * @param prompt The prompt object.
 * @param replacements The placeholder replacements.
 * @param relativeRootDir The root directory for resolving relative file paths.
 * @returns The formatted content string.
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
    const formattedContent = placeholderFormatter(processedContent, updatedReplacements, relativeRootDir);

    // Step 4: Remove the old {{file:filepath}} handling logic block
    // const filePlaceholderPattern = /{{file:([^}]+)}}/g;
    // formattedContent = formattedContent.replace(filePlaceholderPattern, (match, filePath) => { ... });

    return formattedContent;
}

/**
 * Gets placeholder icons based on content and replacements.
 * @param content The prompt content string.
 * @param replacements The placeholder replacements.
 * @returns An array of List.Item.Accessory representing the used placeholders.
 */
export function getPlaceholderIcons(
    content: string | undefined,
    replacements: SpecificReplacements
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

    return placeholderIconsArray;
}

/**
 * Gets prompt titles with hierarchical indentation and a content summary.
 * @returns A string containing the indented prompt titles and summaries.
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