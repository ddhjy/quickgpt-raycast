import { useState } from "react";
import {
    List,
    getPreferenceValues,
    showToast,
    Toast,
    clearSearchBar
} from "@raycast/api";
import { match } from "pinyin-pro";
import path from "path";
import { PromptProps } from "../managers/PromptManager";
import promptManager from "../managers/PromptManager";
import pinsManager from "../managers/PinsManager";
import { SpecificReplacements, placeholderFormatter } from "../utils/placeholderFormatter";
import { PromptListItem } from "./PromptListItem";
import { getIndentedPromptTitles } from "../utils/promptFormattingUtils";
import { AIService } from "../services/AIService";
import defaultActionPreferenceStore from "../stores/DefaultActionPreferenceStore";
import { getAvailableScripts } from "../utils/scriptUtils";

interface PromptListProps {
    prompts: PromptProps[];
    searchMode?: boolean;
    clipboardText: string;
    selectionText: string;
    currentApp: string;
    browserContent: string;
    allowedActions?: string[];
}

export function PromptList({
    prompts,
    searchMode = false,
    clipboardText,
    selectionText,
    currentApp,
    browserContent,
    allowedActions,
}: PromptListProps) {
    const [searchText, setSearchText] = useState<string>("");
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [forceUpdateCounter, setForceUpdateCounter] = useState(0);
    const preferences = getPreferenceValues<{
        customPromptsDirectory?: string;
        customPromptsDirectory1?: string;
        customPromptsDirectory2?: string;
        customPromptsDirectory3?: string;
        customPromptsDirectory4?: string;
        scriptsDirectory?: string;
    }>();
    const aiService = AIService.getInstance();
    const [selectedAction, setSelectedAction] = useState<string>(() => defaultActionPreferenceStore.getDefaultActionPreference() || "");

    // 强制更新组件的函数
    const forceUpdate = () => setForceUpdateCounter((prev: number) => prev + 1);

    // 处理Pin/Unpin操作的回调
    const handlePinToggle = (prompt: PromptProps) => {
        prompt.pinned = !prompt.pinned;
        prompt.pinned
            ? pinsManager.pin(prompt.identifier)
            : pinsManager.unpin(prompt.identifier);
        forceUpdate();
    };

    // Get all configured, non-empty custom prompt directories
    const configuredRootDirs = [
        preferences.customPromptsDirectory1,
        preferences.customPromptsDirectory,
        preferences.customPromptsDirectory2,
        preferences.customPromptsDirectory3,
        preferences.customPromptsDirectory4
    ].filter((dir): dir is string => typeof dir === 'string' && dir.trim() !== '');

    // Filter prompts only in search mode
    let filteredPrompts = prompts;
    if (searchMode && searchText.length > 0) {
        filteredPrompts = promptManager.getFilteredPrompts((prompt) => {
            return (
                prompt.title.toLowerCase().includes(searchText.trim().toLowerCase()) ||
                !!match(prompt.title, searchText.trim(), { continuous: true })
            );
        });
    }

    if (searchMode && searchText.endsWith(" ")) {
        clearSearchBar({ forceScrollToTop: true });
        return (
            <PromptList
                searchMode={false}
                prompts={filteredPrompts}
                clipboardText={clipboardText}
                selectionText={selectionText}
                currentApp={currentApp}
                browserContent={browserContent}
                allowedActions={allowedActions}
            />
        );
    }

    const activeSearchText = searchMode ? "" : searchText;

    const replacements: SpecificReplacements = {
        input: activeSearchText,
        clipboard: clipboardText,
        selection: selectionText,
        currentApp: currentApp,
        browserContent: browserContent,
        promptTitles: getIndentedPromptTitles(),
    };

    // 排序并切片提示列表
    const displayPrompts = filteredPrompts
        .sort((a, b) => Number(b.pinned) - Number(a.pinned))
        .slice(0, searchMode && searchText.trim().length > 0 ? 5 : undefined);

    // 为每个提示找到特定的根目录
    const promptItems = displayPrompts.map((prompt, index) => {
        // Determine the specific root directory for *this* prompt
        let promptSpecificRootDir: string | undefined = undefined;
        if (prompt.filePath) {
            let longestMatchLength = 0;
            for (const rootDir of configuredRootDirs) {
                // Normalize to ensure consistent path comparison
                const normalizedRootDir = path.normalize(rootDir);
                const normalizedPromptPath = path.normalize(prompt.filePath);

                // Check if the prompt path starts with the root directory path
                // Add path.sep to avoid matching '/path/to/rootABC' with '/path/to/root'
                const rootDirWithSeparator = normalizedRootDir.endsWith(path.sep) ? normalizedRootDir : normalizedRootDir + path.sep;

                if (normalizedPromptPath.startsWith(rootDirWithSeparator) || normalizedPromptPath === normalizedRootDir) {
                    if (normalizedRootDir.length > longestMatchLength) {
                        longestMatchLength = normalizedRootDir.length;
                        promptSpecificRootDir = rootDir; // Store the original, non-normalized path from preferences
                    }
                }
            }
        }

        // 排除不匹配搜索条件的提示
        if (
            searchMode &&
            activeSearchText &&
            prompt.title === placeholderFormatter(prompt.title || "", replacements) &&
            !prompt.title.toLowerCase().includes(activeSearchText.toLowerCase()) &&
            !match(prompt.title, activeSearchText, { continuous: true })
        ) {
            return null;
        }

        return (
            <PromptListItem
                key={`${prompt.identifier || prompt.title}-${index}`}
                prompt={prompt}
                index={index}
                replacements={replacements}
                searchMode={searchMode}
                promptSpecificRootDir={promptSpecificRootDir}
                allowedActions={allowedActions}
                onPinToggle={handlePinToggle}
                activeSearchText={activeSearchText}
            />
        );
    }).filter(Boolean); // 过滤空项

    // 获取可用脚本
    const getScripts = () => {
        return getAvailableScripts(preferences.scriptsDirectory);
    };

    return (
        <List
            searchBarPlaceholder={searchMode ? "Search" : "Input"}
            onSearchTextChange={setSearchText}
            filtering={false}
            searchBarAccessory={
                searchMode ? (
                    <List.Dropdown
                        tooltip="Select preferred action"
                        value={selectedAction}
                        onChange={(newValue: string) => {
                            if (newValue === selectedAction) return;

                            // When selecting the default item (value is empty), directly clear the setting
                            if (newValue === "") {
                                setSelectedAction("");
                                defaultActionPreferenceStore.saveDefaultActionPreference("");
                                console.log("Cleared preferred action");
                                showToast({
                                    style: Toast.Style.Success,
                                    title: "Cleared preferred action",
                                });
                                return;
                            }

                            setSelectedAction(newValue);
                            defaultActionPreferenceStore.saveDefaultActionPreference(newValue);
                            console.log(`Set preferred action: ${newValue}`);
                            showToast({
                                style: Toast.Style.Success,
                                title: "Set preferred action",
                                message: newValue,
                            });
                        }}
                    >
                        <List.Dropdown.Item key="default" title="Default" value="" />
                        <List.Dropdown.Section title="Execute Scripts">
                            {getScripts().map((script) => (
                                <List.Dropdown.Item
                                    key={script.path}
                                    title={script.name}
                                    value={`script_${script.name}`}
                                />
                            ))}
                        </List.Dropdown.Section>
                        <List.Dropdown.Section title="AI Providers">
                            {aiService.getAllProviders().map((provider) => (
                                <List.Dropdown.Item
                                    key={provider.name}
                                    title={`${provider.name}`}
                                    value={`call ${provider.name.toLowerCase()}`}
                                />
                            ))}
                        </List.Dropdown.Section>
                    </List.Dropdown>
                ) : null
            }
        >
            {promptItems}
        </List>
    );
} 