import { useState, useMemo, useEffect, useRef } from "react";
import { List, showToast, Toast, clearSearchBar, useNavigation } from "@raycast/api";
import { match } from "pinyin-pro";
import path from "path";
import { PromptProps } from "../managers/prompt-manager";
import promptManager from "../managers/prompt-manager";
import pinsManager from "../managers/pins-manager";
import { MemoizedPromptListItem } from "./prompt-list-item";
import defaultActionPreferenceStore from "../stores/default-action-preference-store";
import { getAvailableScripts, ScriptInfo } from "../utils/script-utils";
import { useInputHistory } from "../hooks/use-input-history";
import configurationManager from "../managers/configuration-manager";

/**
 * Normalizes text for search by removing all spaces and punctuation,
 * keeping only Unicode letters and numbers, and converting to lowercase.
 * This enables flexible matching that ignores formatting differences.
 *
 * @param text The text to normalize
 * @returns The normalized text
 */
const normalizeTextForSearch = (text: string): string => {
  // Remove all non-letter and non-number Unicode characters, then convert to lowercase
  return text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
};

interface PromptListProps {
  prompts: PromptProps[];
  searchMode?: boolean;
  selectionText: string;
  currentApp: string;
  allApp?: string;
  browserContent: string;
  diff?: string;
  allowedActions?: string[];
  initialScripts?: ScriptInfo[];
  externalOnRefreshNeeded?: () => void;
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
 * @param props.externalOnRefreshNeeded Optional callback from parent to trigger a full refresh.
 */
export function PromptList({
  prompts: initialPrompts,
  searchMode = false,
  selectionText,
  currentApp,
  allApp = "",
  browserContent,
  diff,
  allowedActions,
  initialScripts,
  externalOnRefreshNeeded,
}: PromptListProps) {
  // Replace original searchText state with input history hook
  const { currentInput, setCurrentInput, resetHistory, addToHistory } = useInputHistory("");
  const searchText = currentInput;
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedAction, setSelectedAction] = useState<string>(
    () => defaultActionPreferenceStore.getDefaultActionPreference() || "",
  );
  const { push } = useNavigation();

  const isMountedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const forceUpdate = () => setRefreshKey((prev) => prev + 1);
  const effectiveOnRefreshNeeded = externalOnRefreshNeeded || forceUpdate;

  // Function to get display text for "Last Used" option
  const getLastUsedActionDisplay = () => {
    const mostFrequentAction = defaultActionPreferenceStore.getLastExecutedAction();
    if (!mostFrequentAction || mostFrequentAction === "" || mostFrequentAction === "lastUsed") return "Last Used";

    // Only scripts are recorded in Last Used now
    if (mostFrequentAction.startsWith("script_")) {
      const scriptName = mostFrequentAction.replace("script_", "");
      return `Last: ${scriptName}`;
    }
    return "Last Used";
  };

  const handlePinToggle = (prompt: PromptProps) => {
    const isCurrentlyPinned = pinsManager.pinnedIdentifiers().includes(prompt.identifier);
    if (isCurrentlyPinned) {
      pinsManager.unpin(prompt.identifier);
    } else {
      pinsManager.pin(prompt.identifier);
    }

    forceUpdate();
  };

  const configuredRootDirs = configurationManager.getDirectories("prompts");

  const filteredPrompts = useMemo(() => {
    let result;
    const sourcePrompts = searchMode ? promptManager.getFilteredPrompts(() => true) : initialPrompts;

    if (searchMode && searchText.trim().length > 0) {
      const trimmedSearchText = searchText.trim();
      // Normalize the search text for flexible matching
      const normalizedSearchText = normalizeTextForSearch(trimmedSearchText);

      result = sourcePrompts.filter((prompt) => {
        // Normalize the title to match against the normalized search text
        const normalizedTitle = normalizeTextForSearch(prompt.title);
        const titleMatch = normalizedTitle.includes(normalizedSearchText);

        // Keep the original pinyin matching logic with the original text
        const pinyinMatch = !!match(prompt.title, trimmedSearchText, { continuous: true });

        return titleMatch || pinyinMatch;
      });
    } else {
      result = initialPrompts;
    }
    return result;
  }, [initialPrompts, searchMode, searchText]);

  const displayPrompts = useMemo(() => {
    const pinnedOrder = pinsManager.pinnedIdentifiers();

    let sorted: PromptProps[];

    if (searchMode && searchText.trim().length > 0) {
      const pinnedPromptsMap = new Map<string, PromptProps>();
      const unpinnedPrompts: PromptProps[] = [];

      filteredPrompts.forEach((prompt) => {
        if (pinnedOrder.includes(prompt.identifier)) {
          prompt.pinned = true;
          pinnedPromptsMap.set(prompt.identifier, prompt);
        } else {
          prompt.pinned = false;
          unpinnedPrompts.push(prompt);
        }
      });

      const sortedPinnedPrompts = pinnedOrder
        .map((id) => pinnedPromptsMap.get(id))
        .filter((p): p is PromptProps => p !== undefined);

      sorted = [...sortedPinnedPrompts, ...unpinnedPrompts];
    } else {
      const pinnedPromptsMap = new Map<string, PromptProps>();
      const unpinnedPrompts: PromptProps[] = [];

      filteredPrompts.forEach((prompt) => {
        if (pinnedOrder.includes(prompt.identifier)) {
          prompt.pinned = true;
          pinnedPromptsMap.set(prompt.identifier, prompt);
        } else {
          prompt.pinned = false;
          unpinnedPrompts.push(prompt);
        }
      });

      const sortedPinnedPrompts = pinnedOrder
        .map((id) => pinnedPromptsMap.get(id))
        .filter((p): p is PromptProps => p !== undefined);

      sorted = [...sortedPinnedPrompts, ...unpinnedPrompts];
    }

    const sliced = sorted.slice(0, searchMode && searchText.trim().length > 0 ? 9 : undefined);
    return sliced;
  }, [filteredPrompts, searchMode, searchText, refreshKey]);

  useEffect(() => {
    if (searchMode && searchText.endsWith(" ") && searchText.trim().length > 0) {
      const promptsToShow = displayPrompts;

      clearSearchBar({ forceScrollToTop: true });

      setCurrentInput("");

      push(
        <PromptList
          selectionText={selectionText}
          currentApp={currentApp}
          allApp={allApp}
          browserContent={browserContent}
          diff={diff}
          allowedActions={allowedActions}
          initialScripts={initialScripts}
          prompts={promptsToShow}
          searchMode={false}
          externalOnRefreshNeeded={externalOnRefreshNeeded}
        />,
      );
      return;
    }
  }, [
    searchMode,
    searchText,
    push,
    displayPrompts,
    selectionText,
    currentApp,
    allApp,
    browserContent,
    allowedActions,
    initialScripts,
    externalOnRefreshNeeded,
  ]);

  const handleSearchTextChange = (text: string) => {
    setCurrentInput(text);
  };

  const activeSearchText = searchMode ? "" : searchText;

  const scripts = useMemo(
    () => initialScripts ?? getAvailableScripts(configurationManager.getDirectories("scripts")),
    [initialScripts],
  );

  const promptItems = displayPrompts
    .map((prompt, index) => {
      let promptSpecificRootDir: string | undefined = undefined;

      if (prompt.isTemporary && prompt.temporaryDirSource) {
        promptSpecificRootDir = prompt.temporaryDirSource;
      } else if (prompt.filePath) {
        let longestMatchLength = 0;
        for (const rootDir of configuredRootDirs) {
          const normalizedRootDir = path.normalize(rootDir);
          const normalizedPromptPath = path.normalize(prompt.filePath);

          const rootDirWithSeparator = normalizedRootDir.endsWith(path.sep)
            ? normalizedRootDir
            : normalizedRootDir + path.sep;

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
            allApp,
            browserContent,
            input: searchMode ? "" : activeSearchText,
            diff,
          }}
          searchMode={searchMode}
          promptSpecificRootDir={promptSpecificRootDir}
          allowedActions={allowedActions}
          onPinToggle={handlePinToggle}
          activeSearchText={activeSearchText}
          scripts={scripts}
          onRefreshNeeded={effectiveOnRefreshNeeded}
          addToHistory={addToHistory}
          setCurrentInput={setCurrentInput}
        />
      );
    })
    .filter(Boolean);

  return (
    <List
      isLoading={false}
      searchBarPlaceholder={searchMode ? "Search" : "Input"}
      onSearchTextChange={handleSearchTextChange}
      searchText={searchText}
      filtering={false}
      onSelectionChange={() => {
        // Reset history navigation when user uses arrow keys to select list items
        if (!searchMode) {
          resetHistory();
        }
      }}
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
                message: newValue === "lastUsed" ? getLastUsedActionDisplay() : newValue,
              });
              forceUpdate();
            }}
          >
            <List.Dropdown.Item key="" title="Off" value="" />
            <List.Dropdown.Item key="lastUsed" title={getLastUsedActionDisplay()} value="lastUsed" />
            <List.Dropdown.Section title="Actions">
              <List.Dropdown.Item key="copyToClipboard" title="Copy" value="copyToClipboard" />
              <List.Dropdown.Item key="paste" title="Paste" value="paste" />
            </List.Dropdown.Section>
            {scripts.length > 0 && (
              <List.Dropdown.Section title="Scripts">
                {scripts.map(({ name }) => (
                  <List.Dropdown.Item key={`script_${name}`} title={name} value={`script_${name}`} />
                ))}
              </List.Dropdown.Section>
            )}
          </List.Dropdown>
        ) : null
      }
    >
      {promptItems}
    </List>
  );
}
