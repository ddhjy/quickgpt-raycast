import { useState, useMemo, useEffect, useRef } from "react";
import { List, showToast, Toast, clearSearchBar, useNavigation, Icon } from "@raycast/api";
import { match } from "pinyin-pro";
import path from "path";
import { PromptProps } from "../managers/prompt-manager";
import pinsManager from "../managers/pins-manager";
import { MemoizedPromptListItem } from "./prompt-list-item";
import defaultActionPreferenceStore from "../stores/default-action-preference-store";
import { getAvailableScripts, ScriptInfo } from "../utils/script-utils";
import { useInputHistory } from "../hooks/use-input-history";
import configurationManager from "../managers/configuration-manager";

const normalizeTextForSearch = (text: string): string => {
  const lowerText = text.toLowerCase();
  const leadingSpecialMatch = lowerText.match(/^[^\p{L}\p{N}]+/u);
  const leadingSpecial = leadingSpecialMatch ? leadingSpecialMatch[0] : "";
  const normalizedBody = lowerText.replace(/[^\p{L}\p{N}]/gu, "");
  return leadingSpecial + normalizedBody;
};

const getAllDescendants = (prompts: PromptProps[]): PromptProps[] => {
  let results: PromptProps[] = [];
  prompts.forEach((prompt) => {
    results.push(prompt);
    if (prompt.subprompts) {
      results = results.concat(getAllDescendants(prompt.subprompts));
    }
  });
  return results;
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
  placeholderArgs?: Record<string, unknown>;
  currentPath?: string;
}

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
  placeholderArgs = {},
  currentPath = "",
}: PromptListProps) {
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

  const getLastUsedActionDisplay = () => {
    const mostFrequentAction = defaultActionPreferenceStore.getLastExecutedAction();
    if (!mostFrequentAction || mostFrequentAction === "" || mostFrequentAction === "lastUsed") return "Last Used";

    if (mostFrequentAction.startsWith("script_")) {
      const scriptName = mostFrequentAction.replace("script_", "").replace(/^Raycast\s+/, "");
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
    const sourcePrompts = searchMode ? getAllDescendants(initialPrompts) : initialPrompts;

    if (searchMode && searchText.trim().length > 0) {
      const trimmedSearchText = searchText.trim();
      const normalizedSearchText = normalizeTextForSearch(trimmedSearchText);

      result = sourcePrompts.filter((prompt) => {
        const normalizedTitle = normalizeTextForSearch(prompt.title);
        const titleMatch = normalizedTitle.includes(normalizedSearchText);
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
          placeholderArgs={placeholderArgs}
          currentPath={currentPath}
        />,
      );
      return;
    }

    if (searchText === " ") {
      setCurrentInput("");

      push(
        <PromptList
          prompts={initialPrompts}
          searchMode={!searchMode}
          selectionText={selectionText}
          currentApp={currentApp}
          allApp={allApp}
          browserContent={browserContent}
          diff={diff}
          allowedActions={allowedActions}
          initialScripts={initialScripts}
          externalOnRefreshNeeded={externalOnRefreshNeeded}
          placeholderArgs={placeholderArgs}
          currentPath={currentPath}
        />,
      );
      return;
    }
  }, [
    searchMode,
    searchText,
    push,
    displayPrompts,
    initialPrompts,
    selectionText,
    currentApp,
    allApp,
    browserContent,
    diff,
    allowedActions,
    initialScripts,
    externalOnRefreshNeeded,
    placeholderArgs,
    currentPath,
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
            ...placeholderArgs,
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
          currentPath={currentPath}
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
              <>
                {scripts.some(({ name }) => /^Raycast\s+/.test(name)) && (
                  <List.Dropdown.Section title="Raycast Scripts">
                    {scripts
                      .filter(({ name }) => /^Raycast\s+/.test(name))
                      .map(({ name }) => (
                        <List.Dropdown.Item
                          key={`script_${name}`}
                          title={name.replace(/^Raycast\s+/, "")}
                          value={`script_${name}`}
                          icon={Icon.RaycastLogoPos}
                        />
                      ))}
                  </List.Dropdown.Section>
                )}
                {scripts.some(({ name }) => !/^Raycast\s+/.test(name)) && (
                  <List.Dropdown.Section title="Scripts">
                    {scripts
                      .filter(({ name }) => !/^Raycast\s+/.test(name))
                      .map(({ name }) => (
                        <List.Dropdown.Item key={`script_${name}`} title={name} value={`script_${name}`} />
                      ))}
                  </List.Dropdown.Section>
                )}
              </>
            )}
          </List.Dropdown>
        ) : null
      }
    >
      {promptItems}
    </List>
  );
}
