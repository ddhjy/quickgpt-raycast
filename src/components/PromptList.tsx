import { useState, useMemo, useEffect, useRef } from "react";
import {
    List,
    getPreferenceValues,
    showToast,
    Toast,
    clearSearchBar,
    useNavigation
} from "@raycast/api";
import { match } from "pinyin-pro";
import path from "path";
import { PromptProps } from "../managers/PromptManager";
import promptManager from "../managers/PromptManager";
import pinsManager from "../managers/PinsManager";
import { SpecificReplacements } from "../utils/placeholderFormatter";
import { MemoizedPromptListItem } from "./PromptListItem";
import { getIndentedPromptTitles } from "../utils/promptFormattingUtils";
import { AIService } from "../services/AIService";
import defaultActionPreferenceStore from "../stores/DefaultActionPreferenceStore";
import { getAvailableScripts, ScriptInfo } from "../utils/scriptUtils";
import { AIProvider } from "../services/types";

interface PromptListProps {
    prompts: PromptProps[];
    searchMode?: boolean;
    selectionText: string;
    currentApp: string;
    browserContent: string;
    allowedActions?: string[];
    initialScripts?: ScriptInfo[];
    initialAiProviders?: AIProvider[];
}

/**
 * Component for displaying a list of prompts.
 * Handles search, pinning, dynamic content replacement, and navigation.
 *
 * @param props The component props.
 * @param props.prompts The list of prompts to display.
 * @param props.searchMode Whether the list is in search mode (true) or input mode (false).
 * @param props.selectionText Current selected text content.
 * @param props.currentApp Name of the frontmost application.
 * @param props.browserContent Content fetched from the active browser tab.
 * @param props.allowedActions Optional list of allowed action names for the prompts.
 * @param props.initialScripts Optional initial list of scripts (avoids re-fetching).
 * @param props.initialAiProviders Optional initial list of AI providers (avoids re-fetching).
 */
export function PromptList({
    prompts,
    searchMode = false,
    selectionText,
    currentApp,
    browserContent,
    allowedActions,
    initialScripts,
    initialAiProviders
}: PromptListProps) {
    const [searchText, setSearchText] = useState<string>("");
    const [refreshKey, setRefreshKey] = useState(0);
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
    const { push } = useNavigation();

    const isMountedRef = useRef(false);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    const forceUpdate = () => setRefreshKey(prev => prev + 1);

    const handlePinToggle = (prompt: PromptProps) => {
        const isCurrentlyPinned = pinsManager.pinnedIdentifiers().includes(prompt.identifier);
        if (isCurrentlyPinned) {
            pinsManager.unpin(prompt.identifier);
        } else {
            pinsManager.pin(prompt.identifier);
        }

        forceUpdate();
    };

    const configuredRootDirs = [
        preferences.customPromptsDirectory1,
        preferences.customPromptsDirectory,
        preferences.customPromptsDirectory2,
        preferences.customPromptsDirectory3,
        preferences.customPromptsDirectory4
    ].filter((dir): dir is string => typeof dir === 'string' && dir.trim() !== '');

    const filteredPrompts = useMemo(() => {
        let result;
        const sourcePrompts = searchMode ? promptManager.getFilteredPrompts(() => true) : prompts;

        if (searchMode && searchText.trim().length > 0) {
            result = sourcePrompts.filter((prompt) => {
                const titleMatch = prompt.title.toLowerCase().includes(searchText.trim().toLowerCase());
                const pinyinMatch = !!match(prompt.title, searchText.trim(), { continuous: true });
                return titleMatch || pinyinMatch;
            });
        } else {
            result = prompts;
        }
        return result;
    }, [prompts, searchMode, searchText]);

    const displayPrompts = useMemo(() => {
        const pinnedOrder = pinsManager.pinnedIdentifiers();

        const pinnedPromptsMap = new Map<string, PromptProps>();
        const unpinnedPrompts: PromptProps[] = [];

        filteredPrompts.forEach(prompt => {
            if (pinnedOrder.includes(prompt.identifier)) {
                prompt.pinned = true;
                pinnedPromptsMap.set(prompt.identifier, prompt);
            } else {
                prompt.pinned = false;
                unpinnedPrompts.push(prompt);
            }
        });

        const sortedPinnedPrompts = pinnedOrder
            .map(id => pinnedPromptsMap.get(id))
            .filter((p): p is PromptProps => p !== undefined);

        const sorted = [...sortedPinnedPrompts, ...unpinnedPrompts];

        const sliced = sorted.slice(0, searchMode && searchText.trim().length > 0 ? 9 : undefined);
        return sliced;
    }, [filteredPrompts, searchMode, searchText, refreshKey]);

    useEffect(() => {
        if (searchMode && searchText.endsWith(" ") && searchText.trim().length > 0) {
            const promptsToShow = displayPrompts;

            clearSearchBar({ forceScrollToTop: true });

            setSearchText("");

            push(
                <PromptList
                    selectionText={selectionText}
                    currentApp={currentApp}
                    browserContent={browserContent}
                    allowedActions={allowedActions}
                    initialScripts={initialScripts}
                    initialAiProviders={initialAiProviders}
                    prompts={promptsToShow}
                    searchMode={false}
                />
            );
            return;
        }
    }, [searchMode, searchText, push, displayPrompts, selectionText, currentApp, browserContent, allowedActions, initialScripts, initialAiProviders]);

    const handleSearchTextChange = (text: string) => {
        setSearchText(text);
    };

    const activeSearchText = searchMode ? "" : searchText;

    const scripts = useMemo(() => initialScripts ?? getAvailableScripts(preferences.scriptsDirectory), [initialScripts, preferences.scriptsDirectory]);
    const aiProviders = useMemo(() => {
        const providers = initialAiProviders ?? aiService.getAllProviders();

        const preferredProvider = selectedAction ? selectedAction : "openai";

        return providers.sort((a: AIProvider, b: AIProvider) => {
            if (a.name.toLowerCase() === preferredProvider.toLowerCase()) return -1;
            if (b.name.toLowerCase() === preferredProvider.toLowerCase()) return 1;
            return a.name.localeCompare(b.name);
        });
    }, [initialAiProviders, selectedAction]);

    const replacements: Omit<SpecificReplacements, 'clipboard'> = {
        input: activeSearchText,
        selection: selectionText,
        currentApp: currentApp,
        browserContent: browserContent,
        promptTitles: getIndentedPromptTitles(),
    };

    const promptItems = displayPrompts.map((prompt, index) => {
        let promptSpecificRootDir: string | undefined = undefined;
        if (prompt.filePath) {
            let longestMatchLength = 0;
            for (const rootDir of configuredRootDirs) {
                const normalizedRootDir = path.normalize(rootDir);
                const normalizedPromptPath = path.normalize(prompt.filePath);

                const rootDirWithSeparator = normalizedRootDir.endsWith(path.sep) ? normalizedRootDir : normalizedRootDir + path.sep;

                if (normalizedPromptPath.startsWith(rootDirWithSeparator) || normalizedPromptPath === normalizedRootDir) {
                    if (normalizedRootDir.length > longestMatchLength) {
                        longestMatchLength = normalizedRootDir.length;
                        promptSpecificRootDir = rootDir;
                    }
                }
            }
        }

        return (
            <MemoizedPromptListItem
                key={`${prompt.identifier || prompt.title}-${index}-${refreshKey}`}
                prompt={prompt}
                index={index}
                replacements={{
                    selection: selectionText,
                    currentApp,
                    browserContent,
                    input: searchMode ? searchText : activeSearchText,
                }}
                searchMode={searchMode}
                promptSpecificRootDir={promptSpecificRootDir}
                allowedActions={allowedActions}
                onPinToggle={handlePinToggle}
                activeSearchText={activeSearchText}
                scripts={scripts}
                aiProviders={aiProviders}
                onRefreshNeeded={forceUpdate}
            />
        );
    }).filter(Boolean);

    return (
        <List
            isLoading={false}
            searchBarPlaceholder={searchMode ? "Search" : "Input"}
            onSearchTextChange={handleSearchTextChange}
            searchText={searchText}
            filtering={false}
            searchBarAccessory={
                searchMode ? (
                    <List.Dropdown
                        tooltip="Select preferred action"
                        storeValue={false}
                        value={selectedAction}
                        onChange={(newValue: string) => {
                            if (newValue === selectedAction) return;

                            if (newValue === "") {
                                setSelectedAction("");
                                defaultActionPreferenceStore.saveDefaultActionPreference("");
                                showToast({
                                    style: Toast.Style.Success,
                                    title: "Cleared preferred action",
                                });
                                return;
                            }

                            setSelectedAction(newValue);
                            defaultActionPreferenceStore.saveDefaultActionPreference(newValue);
                            showToast({
                                style: Toast.Style.Success,
                                title: "Set preferred action",
                                message: newValue,
                            });
                        }}
                    >
                        <List.Dropdown.Item key="" title="Off" value="" />
                        <List.Dropdown.Section title="Actions">
                            <List.Dropdown.Item key="copyToClipboard" title="Copy" value="copyToClipboard" />
                            <List.Dropdown.Item key="paste" title="Paste" value="paste" />
                        </List.Dropdown.Section>
                        <List.Dropdown.Section title="AI Providers">
                            {aiProviders.map((provider) => (
                                <List.Dropdown.Item
                                    key={provider.name.toLowerCase()}
                                    title={provider.name}
                                    value={provider.name.toLowerCase()}
                                />
                            ))}
                        </List.Dropdown.Section>
                        <List.Dropdown.Section title="Scripts">
                            {scripts.map(({ name }) => (
                                <List.Dropdown.Item
                                    key={`script_${name}`}
                                    title={name}
                                    value={`script_${name}`}
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