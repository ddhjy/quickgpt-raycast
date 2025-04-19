import { useState, useMemo, useEffect, useRef } from "react";
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
import { MemoizedPromptListItem } from "./PromptListItem";
import { getIndentedPromptTitles } from "../utils/promptFormattingUtils";
import { AIService } from "../services/AIService";
import defaultActionPreferenceStore from "../stores/DefaultActionPreferenceStore";
import { getAvailableScripts, ScriptInfo } from "../utils/scriptUtils";
import { AIProvider } from "../services/types";

interface PromptListProps {
    prompts: PromptProps[];
    searchMode?: boolean;
    clipboardText: string;
    selectionText: string;
    currentApp: string;
    browserContent: string;
    allowedActions?: string[];
    initialScripts?: ScriptInfo[];
    initialAiProviders?: AIProvider[];
}

export function PromptList({
    prompts,
    searchMode = false,
    clipboardText,
    selectionText,
    currentApp,
    browserContent,
    allowedActions,
    initialScripts,
    initialAiProviders
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

    const isMountedRef = useRef(false);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    // Function to force component update
    const forceUpdate = () => setForceUpdateCounter((prev: number) => prev + 1);

    // Callback to handle Pin/Unpin operations
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
    const filteredPrompts = useMemo(() => {
        let result;
        if (searchMode && searchText.length > 0) {
            result = promptManager.getFilteredPrompts((prompt) => {
                return (
                    prompt.title.toLowerCase().includes(searchText.trim().toLowerCase()) ||
                    !!match(prompt.title, searchText.trim(), { continuous: true })
                );
            });
        } else {
            result = prompts; // Return original prompts if not searching
        }
        return result;
    }, [prompts, searchMode, searchText]);

    // Effect to handle clearing search when space is entered in search mode
    useEffect(() => {
        if (searchMode && searchText.endsWith(" ")) {
            clearSearchBar({ forceScrollToTop: true });
            setSearchText(""); // Clear the search text instead of returning early
        }
    }, [searchMode, searchText]);

    const handleSearchTextChange = (text: string) => {
        setSearchText(text);
    };

    const activeSearchText = searchMode ? "" : searchText;

    // OPTIMIZATION 1: Calculate scripts and providers once using useMemo
    // Use initial values if provided (for nested lists), otherwise calculate them.
    const scripts = useMemo(() => initialScripts ?? getAvailableScripts(preferences.scriptsDirectory), [initialScripts, preferences.scriptsDirectory]);
    const aiProviders = useMemo(() => initialAiProviders ?? aiService.getAllProviders(), [initialAiProviders, aiService]);

    const replacements: SpecificReplacements = {
        input: activeSearchText,
        clipboard: clipboardText,
        selection: selectionText,
        currentApp: currentApp,
        browserContent: browserContent,
        promptTitles: getIndentedPromptTitles(),
    };

    // Sort and slice the prompt list
    const displayPrompts = useMemo(() => {
        const sorted = filteredPrompts.sort((a, b) => Number(b.pinned) - Number(a.pinned));
        const sliced = sorted.slice(0, searchMode && searchText.trim().length > 0 ? 5 : undefined);
        return sliced;
    }, [filteredPrompts, searchMode, searchText]);

    // Find the specific root directory for each prompt
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

        // Exclude prompts that do not match the search criteria
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
            <MemoizedPromptListItem
                // OPTIMIZATION 2: Use identifier/title + index for key (temporary fix for duplicate keys)
                key={`${prompt.identifier || prompt.title}-${index}`}
                prompt={prompt}
                index={index}
                replacements={replacements}
                searchMode={searchMode}
                promptSpecificRootDir={promptSpecificRootDir}
                allowedActions={allowedActions}
                onPinToggle={handlePinToggle}
                activeSearchText={activeSearchText}
                // OPTIMIZATION 1 (continued): Pass memoized scripts and providers down
                scripts={scripts}
                aiProviders={aiProviders}
            />
        );
    }).filter(Boolean); // Filter out null items

    return (
        <List
            searchBarPlaceholder={searchMode ? "Search" : "Input"}
            onSearchTextChange={handleSearchTextChange}
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
                        <List.Dropdown.Item key="default" title="Default" value="" />
                        <List.Dropdown.Section title="Execute Scripts">
                            {scripts.map((script) => (
                                <List.Dropdown.Item
                                    key={script.path}
                                    title={script.name}
                                    value={`script_${script.name}`}
                                />
                            ))}
                        </List.Dropdown.Section>
                        <List.Dropdown.Section title="AI Providers">
                            {aiProviders.map((provider) => (
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