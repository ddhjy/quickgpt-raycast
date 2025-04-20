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
} from "@raycast/api";
import { runAppleScript } from "@raycast/utils";
import { PromptProps } from "../managers/PromptManager";
import { SpecificReplacements } from "../utils/placeholderFormatter";
import path from "path";
import { Clipboard } from "@raycast/api";
import { generatePromptActions } from "./PromptActions";
import { buildFormattedPromptContent, getPlaceholderIcons } from "../utils/promptFormattingUtils";
import { ScriptInfo } from "../utils/scriptUtils";
import { AIProvider } from "../services/types";
import { placeholderFormatter } from "../utils/placeholderFormatter";

interface PromptListItemProps {
    prompt: PromptProps;
    index: number;
    replacements: SpecificReplacements;
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
 * @param props.replacements Placeholders and their resolved values.
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
    // Lazy generation of formatted content, passing the determined specific root directory
    /**
     * Lazily builds and returns the formatted content of the prompt,
     * applying replacements and prefix commands.
     *
     * @returns The formatted prompt content as a string.
     */
    const getFormattedContent = () => buildFormattedPromptContent(prompt, replacements, promptSpecificRootDir);

    // Format title
    const rawTitle = prompt.title || "";
    // Apply placeholder formatting to the title
    const formattedTitleWithPlaceholders = placeholderFormatter(
        rawTitle,
        replacements,
        promptSpecificRootDir
    );
    // Combine with search mode path logic
    const formattedTitle = searchMode && prompt.path
        ? `${prompt.path.replace(rawTitle, '')}${formattedTitleWithPlaceholders}`.trim() // Use rawTitle for path replace, formatted for display
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
                            clipboardText={replacements.clipboard as string}
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
                                    getFormattedContent={getFormattedContent}
                                    scripts={scripts}
                                    aiProviders={aiProviders}
                                />
                            }
                        />
                    ) : (
                        // Pass scripts and providers to generatePromptActions
                        generatePromptActions(
                            getFormattedContent,
                            allowedActions || prompt.actions,
                            scripts,
                            aiProviders
                        )
                    )}
                </>
            );
        }
    }, [
        prompt.identifier,
        prompt.subprompts,
        prompt.icon,
        prompt.options,
        prompt.actions,
        replacements.clipboard,
        replacements.selection,
        replacements.currentApp,
        replacements.browserContent,
        allowedActions,
        scripts,
        aiProviders,
        getFormattedContent
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
                                    await runAppleScript(`do shell script "open -a Cursor '${configDir}'"`);
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

// Helper function to handle custom prompts directory actions
/**
 * Generates appropriate Action(s) for opening configured custom prompt directories.
 * If multiple directories are configured, it provides an Action for each.
 * If only one is configured, it provides a single direct Action.
 *
 * @returns A single React Action element or an array of Action elements.
 */
function handleCustomPromptsDirectoryActions() {
    const preferences = getPreferenceValues<{
        customPromptsDirectory?: string;
        customPromptsDirectory1?: string;
        customPromptsDirectory2?: string;
        customPromptsDirectory3?: string;
        customPromptsDirectory4?: string;
    }>();

    const dirConfigs = [
        { dir: preferences.customPromptsDirectory1, label: "Custom Prompts 1" },
        { dir: preferences.customPromptsDirectory, label: "Custom Prompts" },
        { dir: preferences.customPromptsDirectory2, label: "Custom Prompts 2" },
        { dir: preferences.customPromptsDirectory3, label: "Custom Prompts 3" },
        { dir: preferences.customPromptsDirectory4, label: "Custom Prompts 4" }
    ];

    // Display open options for configured directories
    const actions = dirConfigs
        .filter(({ dir }) => dir && dir.trim() !== '')
        .map(({ dir, label }) => (
            <Action
                key={label}
                title={`Open ${label}`}
                icon={Icon.Folder}
                onAction={async () => {
                    await runAppleScript(`do shell script "open -a Cursor '${dir}'"`);
                    await closeMainWindow();
                }}
            />
        ));

    // If no directories are configured, display an error action
    if (actions.length === 0) {
        return (
            <Action
                title="Open"
                icon={Icon.Folder}
                onAction={async () => {
                    await showToast({
                        title: "Error",
                        message: "No custom prompts directories configured",
                        style: Toast.Style.Failure
                    });
                }}
            />
        );
    }

    return <>{actions}</>;
}

/**
 * A memoized version of the PromptListItem component for performance optimization.
 * Prevents unnecessary re-renders when props remain the same.
 */
export const MemoizedPromptListItem = React.memo(PromptListItem);

// This import must be at the bottom of the file to avoid circular dependencies
import { getPreferenceValues } from "@raycast/api";
import { PromptList } from "./PromptList";
import { PromptOptionsForm } from "./PromptOptionsForm";