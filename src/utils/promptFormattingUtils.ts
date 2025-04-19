import fs from "fs";
import path from "path";
import { Icon, List } from "@raycast/api";
import { PromptProps } from "../managers/PromptManager";
import { SpecificReplacements, placeholderFormatter, resolvePlaceholders } from "./placeholderFormatter";
import promptManager from "../managers/PromptManager";
import { readDirectoryContentsSync } from "./fileSystemUtils";

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
 * Apply prefix commands to content
 * @param content Original content
 * @param prefixCommands Prefix commands
 * @returns Processed content
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
 * Get quick prompt
 * @param selectionText Selected text
 * @param identifier Target identifier
 * @returns Quick prompt and cleaned selected text
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
 * Build the formatted prompt content with all placeholders replaced
 */
export function buildFormattedPromptContent(
    prompt: PromptProps,
    replacements: SpecificReplacements,
    relativeRootDir?: string
): string {
    const currentContent = prompt.content; // Work on a copy

    // Step 2: Apply prefix commands
    const processedContent = currentContent
        ? applyPrefixCommandsToContent(currentContent, prompt.prefixCMD)
        : undefined;

    // Step 3: Update replacements (e.g., promptTitles)
    const updatedReplacements = {
        ...replacements,
        promptTitles: replacements.promptTitles || getIndentedPromptTitles(),
    };

    // Step 4: Format standard placeholders using placeholderFormatter
    let formattedContent = placeholderFormatter(processedContent || "", updatedReplacements);

    // Step 5: Handle {{file:filepath}} placeholders (relative to specified root or absolute)
    const filePlaceholderPattern = /{{file:([^}]+)}}/g;
    formattedContent = formattedContent.replace(filePlaceholderPattern, (match, filePath) => {
        const trimmedPath = filePath.trim();
        let absoluteTargetPath: string;

        if (path.isAbsolute(trimmedPath)) {
            absoluteTargetPath = trimmedPath;
        } else {
            if (!relativeRootDir) {
                console.error(`Error: Relative path "${trimmedPath}" provided, but no custom prompt directory is configured as the root.`);
                return `[Error: Root directory not configured for relative path: ${trimmedPath}]`;
            }
            absoluteTargetPath = path.resolve(relativeRootDir, trimmedPath);
            if (!absoluteTargetPath.startsWith(relativeRootDir)) {
                console.error(`Error: Relative path traversal detected. Attempted access outside of root directory ${relativeRootDir}. Path: ${trimmedPath}`);
                return `[Error: Path traversal detected for: ${trimmedPath}]`;
            }
        }

        try {
            // Check if path exists and is a file or directory
            const stats = fs.statSync(absoluteTargetPath);

            if (stats.isFile()) {
                // Read file content
                return fs.readFileSync(absoluteTargetPath, 'utf-8');
            } else if (stats.isDirectory()) {
                // Read directory contents using the sync helper function
                // Pass the directory name itself as the initial basePath for clarity
                return readDirectoryContentsSync(absoluteTargetPath, path.basename(absoluteTargetPath));
            } else {
                // Handle other types like symbolic links, sockets, etc. if needed
                console.warn(`Warning: Path is neither a file nor a directory: ${absoluteTargetPath}`);
                return `[Unsupported path type: ${trimmedPath}]`;
            }
        } catch (error) {
            // Handle errors like permission denied or file/dir not found
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                console.warn(`Warning: File or directory not found for placeholder: ${absoluteTargetPath}`);
                return `[Path not found: ${trimmedPath}]`;
            } else if ((error as NodeJS.ErrnoException).code === 'EACCES') {
                console.error(`Error: Permission denied for path: ${absoluteTargetPath}`, error);
                return `[Permission denied: ${trimmedPath}]`;
            } else {
                console.error(`Error accessing path specified in placeholder: ${absoluteTargetPath}`, error);
                return `[Error accessing path: ${trimmedPath}]`;
            }
        }
    });

    return formattedContent;
}

/**
 * Get placeholder icons based on content and replacements
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
 * Get prompt titles with hierarchical indentation and content summary
 * @returns Prompt titles with hierarchical indentation and content summary
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