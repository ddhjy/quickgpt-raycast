import {
    List,
    ActionPanel,
    Action as RaycastAction,
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

interface PromptListItemProps {
    prompt: PromptProps;
    index: number;
    replacements: SpecificReplacements;
    searchMode?: boolean;
    promptSpecificRootDir?: string;
    allowedActions?: string[];
    onPinToggle: (prompt: PromptProps) => void;
    activeSearchText?: string;
}

export function PromptListItem({
    prompt,
    index,
    replacements,
    searchMode = false,
    promptSpecificRootDir,
    allowedActions,
    onPinToggle,
}: PromptListItemProps) {
    // Lazy generation of formatted content, passing the determined specific root directory
    const getFormattedContent = () => buildFormattedPromptContent(prompt, replacements, promptSpecificRootDir);

    // Format title
    const title = prompt.title || "";
    const formattedTitle = searchMode && prompt.path
        ? `${prompt.path.replace(title, '')}${title}`.trim()
        : title;

    return (
        <List.Item
            key={index}
            title={formattedTitle.replace(/\n/g, " ")}
            icon={prompt.icon ?? "🔖"}
            accessories={[
                prompt.pinned
                    ? { tag: { value: "PIN", color: Color.SecondaryText } }
                    : {},
                ...getPlaceholderIcons(prompt.content, replacements).map((accessory: List.Item.Accessory, i: number, arr: List.Item.Accessory[]) =>
                    i === arr.length - 1
                        ? {
                            ...accessory,
                            tooltip: prompt.content ?? prompt.subprompts
                                ?.map((subPrompt, subIndex) => `${subIndex + 1}. ${subPrompt.title} `)
                                .join("\n")
                        }
                        : accessory
                ),
                ...(getPlaceholderIcons(prompt.content, replacements).length === 0
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
                    {prompt.identifier === "open-custom-prompts-dir" ? (
                        // 打开自定义提示目录的操作
                        handleCustomPromptsDirectoryActions()
                    ) : prompt.identifier === "open-scripts-dir" ? (
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
                    ) : prompt.identifier === "open-preferences" ? (
                        <Action
                            title="Open"
                            icon={Icon.Gear}
                            onAction={() => {
                                openExtensionPreferences();
                                closeMainWindow();
                            }}
                        />
                    ) : prompt.subprompts ? (
                        <RaycastAction.Push
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
                                />
                            }
                        />
                    ) : (
                        <>
                            {prompt.options && Object.keys(prompt.options).length > 0 ? (
                                <RaycastAction.Push
                                    title="Select Options"
                                    icon={Icon.Gear}
                                    target={
                                        <PromptOptionsForm
                                            prompt={prompt}
                                            getFormattedContent={getFormattedContent}
                                        />
                                    }
                                />
                            ) : (
                                generatePromptActions(
                                    getFormattedContent,
                                    allowedActions || prompt.actions,
                                )
                            )}
                        </>
                    )}
                    <Action
                        title={prompt.pinned ? "Unpin" : "Pin"}
                        icon={Icon.Pin}
                        onAction={() => onPinToggle(prompt)}
                        shortcut={{ modifiers: ["cmd", "shift"], key: "p" }}
                    />
                    <>
                        <RaycastAction.CopyToClipboard
                            title="Copy Identifier"
                            content={`quickgpt-${prompt.identifier}`}
                            icon={Icon.Document}
                        />
                        <RaycastAction.CopyToClipboard
                            title="Copy Deeplink"
                            content={`raycast://extensions/ddhjy2012/quickgpt/prompt-lab?arguments=${encodeURIComponent(
                                JSON.stringify({
                                    target: `quickgpt-${prompt.identifier}`,
                                    activateOCR: "false",
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

// 辅助函数，处理自定义提示目录操作
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

    // 有配置的目录显示打开选项
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

    // 如果没有配置任何目录，显示错误操作
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

// 这个import必须放在文件底部以避免循环依赖
import { getPreferenceValues } from "@raycast/api";
import { PromptList } from "./PromptList";
import { PromptOptionsForm } from "./PromptOptionsForm";