import React, { useMemo } from "react";
import {
    List,
    ActionPanel,
    Icon,
    Action,
    Color,
    showToast,
    Toast,
    closeMainWindow,
    openExtensionPreferences,
    getPreferenceValues,
    Clipboard,
} from "@raycast/api";
import { runAppleScript } from "@raycast/utils";
import { PromptProps } from "../managers/PromptManager";
import { SpecificReplacements } from "../utils/placeholderFormatter";
import path from "path";
import { generatePromptActions } from "./PromptActions";
import { getPlaceholderIcons } from "../utils/promptFormattingUtils";
import { ScriptInfo } from "../utils/scriptUtils";
import { AIProvider } from "../services/types";
import { placeholderFormatter } from "../utils/placeholderFormatter";
import { PromptList } from "./PromptList";
import { PromptOptionsForm } from "./PromptOptionsForm";

interface PromptListItemProps {
    prompt: PromptProps;
    index: number;
    replacements: Omit<SpecificReplacements, 'clipboard'>;
    searchMode?: boolean;
    promptSpecificRootDir?: string;
    allowedActions?: string[];
    onPinToggle: (prompt: PromptProps) => void;
    activeSearchText?: string;
    scripts: ScriptInfo[];
    aiProviders: AIProvider[];
}

/**
 * Renders a single item in the prompt list.
 * Generates the appropriate UI and ActionPanel based on the prompt type (regular, folder, options, special).
 *
 * @param props The component props.
 * @param props.prompt The prompt data for this list item.
 * @param props.index The index of the item in the list.
 * @param props.replacements Base replacements without clipboard.
 * @param props.searchMode Indicates if the parent list is in search mode.
 * @param props.promptSpecificRootDir The specific root directory containing this prompt, if applicable.
 * @param props.allowedActions Optional list of allowed action names for this prompt.
 * @param props.onPinToggle Callback function to handle pinning/unpinning.
 * @param props.activeSearchText The current text in the search bar (if not in search mode).
 * @param props.scripts List of available scripts.
 * @param props.aiProviders List of available AI providers.
 */
export function PromptListItem({
    prompt,
    index,
    replacements,
    searchMode = false,
    promptSpecificRootDir,
    allowedActions,
    onPinToggle,
    scripts,
    aiProviders
}: PromptListItemProps) {
    // Format title (clipboard placeholder won't resolve here)
    const rawTitle = prompt.title || "";
    // Merge prompt properties with standard replacements for title formatting
    const mergedForTitle = {
        ...prompt, // Include prompt properties
        ...replacements, // Include standard replacements (input, selection, etc.)
        now: new Date().toLocaleString() // Ensure 'now' is available
    };
    // Apply placeholder formatting to the title
    const formattedTitleWithPlaceholders = placeholderFormatter(
        rawTitle,
        mergedForTitle, // Pass the merged object
        promptSpecificRootDir,
        { resolveFile: false }
    );
    const formattedTitle = searchMode && prompt.path
        ? `${prompt.path.replace(rawTitle, '')}${formattedTitleWithPlaceholders}`.trim()
        : formattedTitleWithPlaceholders;

    // Memoize placeholder icons
    const placeholderIcons = useMemo(() => getPlaceholderIcons(prompt.content, replacements), [prompt.content, replacements]);

    // Memoize prompt actions
    const promptActions = useMemo(() => {
        // Determine the actions to generate based on context
        if (prompt.identifier === "open-custom-prompts-dir") {
            return handleCustomPromptsDirectoryActions();
        } else if (prompt.identifier === "open-scripts-dir") {
            return (
                <Action
                    title="Open"
                    icon={Icon.Folder}
                    onAction={async () => {
                        const preferences = getPreferenceValues();
                        if (preferences.scriptsDirectory) {
                            await runAppleScript(`do shell script "open -a Cursor '${preferences.scriptsDirectory}'"`);
                            await closeMainWindow();
                        } else {
                            await showToast({
                                title: "Error",
                                message: "Scripts directory not configured",
                                style: Toast.Style.Failure
                            });
                        }
                    }}
                />
            );
        } else if (prompt.identifier === "open-preferences") {
            return (
                <Action
                    title="Open"
                    icon={Icon.Gear}
                    onAction={() => {
                        openExtensionPreferences();
                        closeMainWindow();
                    }}
                />
            );
        } else if (prompt.subprompts) {
            return (
                <Action.Push
                    title="Open"
                    icon={prompt.icon ?? "🔖"}
                    target={
                        <PromptList
                            searchMode={false}
                            prompts={prompt.subprompts}
                            selectionText={replacements.selection as string}
                            currentApp={replacements.currentApp as string}
                            browserContent={replacements.browserContent as string}
                            allowedActions={allowedActions}
                            initialScripts={scripts}
                            initialAiProviders={aiProviders}
                        />
                    }
                />
            );
        } else {
            // Generate actions for regular prompts or those with options
            return (
                <>
                    {prompt.options && Object.keys(prompt.options).length > 0 ? (
                        <Action.Push
                            title="Select Options"
                            icon={Icon.Gear}
                            target={
                                <PromptOptionsForm
                                    prompt={prompt}
                                    baseReplacements={replacements}
                                    promptSpecificRootDir={promptSpecificRootDir}
                                    scripts={scripts}
                                    aiProviders={aiProviders}
                                />
                            }
                        />
                    ) : (
                        // Pass necessary data to generatePromptActions
                        generatePromptActions(
                            prompt,
                            replacements,
                            promptSpecificRootDir,
                            allowedActions || prompt.actions,
                            scripts,
                            aiProviders
                        )
                    )}
                </>
            );
        }
    }, [
        prompt,
        replacements,
        promptSpecificRootDir,
        allowedActions,
        scripts,
        aiProviders
    ]);

    return (
        <List.Item
            key={index}
            title={formattedTitle.replace(/\n/g, " ")}
            icon={prompt.icon ?? "🔖"}
            accessories={[
                prompt.pinned
                    ? { tag: { value: "PIN", color: Color.SecondaryText } }
                    : {},
                ...placeholderIcons.map((accessory: List.Item.Accessory, i: number, arr: List.Item.Accessory[]) =>
                    i === arr.length - 1
                        ? {
                            ...accessory,
                            tooltip: prompt.content ?? prompt.subprompts
                                ?.map((subPrompt, subIndex) => `${subIndex + 1}. ${subPrompt.title} `)
                                .join("\n")
                        }
                        : accessory
                ),
                ...(placeholderIcons.length === 0
                    ? [{
                        icon: prompt.subprompts ? Icon.Folder : Icon.Paragraph,
                        tooltip: prompt.content ?? prompt.subprompts
                            ?.map((subPrompt, subIndex) => `${subIndex + 1}. ${subPrompt.title} `)
                            .join("\n")
                    }]
                    : [])
            ]}
            actions={
                <ActionPanel>
                    {promptActions}
                    <Action
                        title={prompt.pinned ? "Unpin" : "Pin"}
                        icon={Icon.Pin}
                        onAction={() => onPinToggle(prompt)}
                        shortcut={{ modifiers: ["cmd", "shift"], key: "p" }}
                    />
                    <>
                        <Action.CopyToClipboard
                            title="Copy Identifier"
                            content={`quickgpt-${prompt.identifier}`}
                            icon={Icon.Document}
                        />
                        <Action.CopyToClipboard
                            title="Copy Deeplink"
                            content={`raycast://extensions/ddhjy2012/quickgpt/prompt-lab?arguments=${encodeURIComponent(
                                JSON.stringify({
                                    target: `quickgpt-${prompt.identifier}`,
                                    actions: prompt.actions?.join(','),
                                    filePath: prompt.filePath
                                })
                            )}`}
                            icon={Icon.Link}
                        />
                        {prompt.filePath && (
                            <Action
                                title="Edit with Cursor"
                                icon={Icon.Code}
                                onAction={async () => {
                                    if (!prompt.filePath) return;
                                    await Clipboard.copy(prompt.title);
                                    const configDir = path.dirname(prompt.filePath);
                                    await runAppleScript(`do shell script "open -a Cursor '${configDir}' '${prompt.filePath}'"`);
                                    await closeMainWindow();
                                    await showToast({
                                        title: "复制标题",
                                        message: prompt.title,
                                        style: Toast.Style.Success,
                                    });
                                }}
                            />
                        )}
                    </>
                </ActionPanel>
            }
        />
    );
}

// Use React.memo to prevent unnecessary re-renders
export const MemoizedPromptListItem = React.memo(PromptListItem);

function handleCustomPromptsDirectoryActions() {
    const preferences = getPreferenceValues<{
        customPromptsDirectory?: string;
        customPromptsDirectory1?: string;
        customPromptsDirectory2?: string;
        customPromptsDirectory3?: string;
        customPromptsDirectory4?: string;
    }>();

    // Create an array of all possible prompt directories
    const promptDirs = [
        preferences.customPromptsDirectory,
        preferences.customPromptsDirectory1,
        preferences.customPromptsDirectory2,
        preferences.customPromptsDirectory3,
        preferences.customPromptsDirectory4
    ].filter(Boolean);

    if (promptDirs.length === 0) {
        return (
            <Action
                title="Configure"
                icon={Icon.Gear}
                onAction={() => {
                    openExtensionPreferences();
                    closeMainWindow();
                }}
            />
        );
    } else if (promptDirs.length === 1) {
        // If there's only one directory, open it directly
        return (
            <Action
                title="Open"
                icon={Icon.Folder}
                onAction={async () => {
                    try {
                        await runAppleScript(`do shell script "open -a Cursor '${promptDirs[0]}'"`);
                        closeMainWindow();
                    } catch (error) {
                        console.error("Failed to open prompt directory:", error);
                        await showToast(Toast.Style.Failure, "Error opening directory");
                    }
                }}
            />
        );
    } else {
        // If there are multiple directories, provide actions for each
        return (
            <>
                {promptDirs.map((dir, index) => {
                    const dirName = path.basename(dir as string);
                    return (
                        <Action
                            key={index}
                            title={`Open ${dirName}`}
                            icon={Icon.Folder}
                            onAction={async () => {
                                try {
                                    await runAppleScript(`do shell script "open -a Cursor '${dir}'"`);
                                    closeMainWindow();
                                } catch (error) {
                                    console.error(`Failed to open prompt directory ${dir}:`, error);
                                    await showToast(Toast.Style.Failure, "Error opening directory");
                                }
                            }}
                        />
                    );
                })}
            </>
        );
    }
}