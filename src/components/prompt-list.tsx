import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { List, showToast, Toast, clearSearchBar, useNavigation, Icon } from "@raycast/api";
import path from "path";
import type { PromptProps } from "../managers/prompt-manager";
import pinsManager from "../managers/pins-manager";
import { MemoizedPromptListItem } from "./prompt-list-item";
import defaultActionPreferenceStore from "../stores/default-action-preference-store";
import { getCachedScripts, refreshScripts, ScriptInfo } from "../utils/script-utils";
import configurationManager from "../managers/configuration-manager";
import { createPromptSearchIndex, getAllDescendants, searchPromptIndex } from "../utils/prompt-search";
import type { SpecificReplacements } from "../utils/placeholder-formatter";

const SEARCH_RESULT_LIMIT = 9;

/**
 * Placeholder values captured when the command launched (selection, frontmost
 * app, browser content, ...) plus any custom launch arguments. The clipboard is
 * read when an action runs, and typed input is added per list.
 */
export type PromptContext = Omit<SpecificReplacements, "clipboard"> & Record<string, unknown>;

function areScriptsEqual(left: ScriptInfo[], right: ScriptInfo[]): boolean {
  return (
    left.length === right.length &&
    left.every((script, index) => script.path === right[index].path && script.name === right[index].name)
  );
}

/**
 * Directory that relative `{{file:...}}` paths of a prompt resolve against:
 * its temporary directory, or the innermost configured prompts directory
 * containing its file.
 */
function resolvePromptRootDir(prompt: PromptProps, configuredRootDirs: string[]): string | undefined {
  if (prompt.isTemporary && prompt.temporaryDirSource) {
    return prompt.temporaryDirSource;
  }
  if (!prompt.filePath) {
    return undefined;
  }

  const normalizedPromptPath = path.normalize(prompt.filePath);
  let rootDir: string | undefined;
  let longestMatchLength = 0;

  for (const candidate of configuredRootDirs) {
    const normalizedCandidate = path.normalize(candidate);
    const candidateWithSeparator = normalizedCandidate.endsWith(path.sep)
      ? normalizedCandidate
      : normalizedCandidate + path.sep;
    const containsPrompt =
      normalizedPromptPath.startsWith(candidateWithSeparator) || normalizedPromptPath === normalizedCandidate;

    if (containsPrompt && normalizedCandidate.length > longestMatchLength) {
      longestMatchLength = normalizedCandidate.length;
      rootDir = candidate;
    }
  }

  return rootDir;
}

interface PromptListProps {
  prompts: PromptProps[];
  searchMode?: boolean;
  context: PromptContext;
  allowedActions?: string[];
  initialScripts?: ScriptInfo[];
  externalOnRefreshNeeded?: () => void;
  currentPath?: string;
  isLoading?: boolean;
}

export function PromptList({
  prompts: initialPrompts,
  searchMode = false,
  context,
  allowedActions,
  initialScripts,
  externalOnRefreshNeeded,
  currentPath = "",
  isLoading = false,
}: PromptListProps) {
  const [searchText, setSearchText] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const scriptDirectories = useMemo(() => configurationManager.getDirectories("scripts"), []);
  // Cached scripts are available on the first render, so the preferred action is
  // already correct if the user presses Enter before the directory scan finishes.
  const [scanState, setScanState] = useState<{ scripts: ScriptInfo[]; resolved: boolean }>(() => {
    const cachedScripts = scriptDirectories.length > 0 && !initialScripts ? getCachedScripts(scriptDirectories) : [];
    return {
      scripts: cachedScripts ?? [],
      resolved: scriptDirectories.length === 0 || (cachedScripts?.length ?? 0) > 0,
    };
  });
  const [selectedAction, setSelectedAction] = useState<string>(
    () => defaultActionPreferenceStore.getDefaultActionPreference() || "",
  );
  const selectedActionRef = useRef(selectedAction);
  selectedActionRef.current = selectedAction;
  const { push } = useNavigation();

  const forceUpdate = useCallback(() => setRefreshKey((prev) => prev + 1), []);
  const effectiveOnRefreshNeeded = externalOnRefreshNeeded || forceUpdate;

  useEffect(() => {
    let cancelled = false;

    // The dropdown renders the cached preference right away, so hydration only has to
    // correct the selection when LocalStorage disagrees with the synchronous cache.
    defaultActionPreferenceStore
      .hydrate()
      .then(() => {
        const hydratedAction = defaultActionPreferenceStore.getDefaultActionPreference() || "";
        if (cancelled || hydratedAction === selectedActionRef.current) {
          return;
        }

        setSelectedAction(hydratedAction);
        forceUpdate();
      })
      .catch((error) => {
        console.error("Failed to hydrate default action preference:", error);
      });

    return () => {
      cancelled = true;
    };
  }, [forceUpdate]);

  useEffect(() => {
    if (initialScripts || scriptDirectories.length === 0) {
      return;
    }

    let cancelled = false;

    refreshScripts(scriptDirectories)
      .catch((error) => {
        console.error("Failed to refresh available scripts:", error);
        return undefined;
      })
      .then((nextScripts) => {
        if (cancelled) {
          return;
        }
        setScanState((current) => ({
          scripts: !nextScripts || areScriptsEqual(current.scripts, nextScripts) ? current.scripts : nextScripts,
          resolved: true,
        }));
      });

    return () => {
      cancelled = true;
    };
  }, [initialScripts, scriptDirectories]);

  const scripts = initialScripts ?? scanState.scripts;
  const hasResolvedScripts = initialScripts !== undefined || scanState.resolved;

  const getLastUsedActionDisplay = () => {
    const mostFrequentAction = defaultActionPreferenceStore.getLastExecutedAction();
    if (mostFrequentAction?.startsWith("script_")) {
      return `Last: ${mostFrequentAction.replace("script_", "").replace(/^Raycast\s+/, "")}`;
    }
    return "Last Used";
  };

  const handlePinToggle = useCallback(
    (prompt: PromptProps) => {
      if (pinsManager.pinnedIdentifiers().includes(prompt.identifier)) {
        pinsManager.unpin(prompt.identifier);
      } else {
        pinsManager.pin(prompt.identifier);
      }

      forceUpdate();
    },
    [forceUpdate],
  );

  const configuredRootDirs = configurationManager.getDirectories("prompts");
  const sourcePrompts = useMemo(
    () => (searchMode ? getAllDescendants(initialPrompts) : initialPrompts),
    [initialPrompts, searchMode],
  );
  const hasActiveSearch = searchMode && searchText.trim().length > 0;
  // Preparing Pinyin readings is only worth it once the user actually searches.
  const searchIndex = useMemo(
    () => (hasActiveSearch ? createPromptSearchIndex(sourcePrompts) : undefined),
    [hasActiveSearch, sourcePrompts],
  );

  const sourcePromptKeys = useMemo(() => {
    return new Map(
      sourcePrompts.map((prompt, sourceIndex) => [
        prompt,
        `${prompt.identifier || prompt.title}:${prompt.filePath ?? ""}:${prompt.path ?? ""}:${sourceIndex}`,
      ]),
    );
  }, [sourcePrompts]);

  const displayPrompts = useMemo(() => {
    const filteredPrompts = searchIndex ? searchPromptIndex(searchIndex, searchText) : initialPrompts;
    const pinnedOrder = pinsManager.pinnedIdentifiers();
    const pinnedIdentifiers = new Set(pinnedOrder);
    const pinnedPromptsMap = new Map<string, PromptProps>();
    const unpinnedPrompts: PromptProps[] = [];

    filteredPrompts.forEach((prompt) => {
      prompt.pinned = pinnedIdentifiers.has(prompt.identifier);
      if (prompt.pinned) {
        pinnedPromptsMap.set(prompt.identifier, prompt);
      } else {
        unpinnedPrompts.push(prompt);
      }
    });

    const sortedPinnedPrompts = pinnedOrder
      .map((id) => pinnedPromptsMap.get(id))
      .filter((prompt): prompt is PromptProps => prompt !== undefined);
    const sorted = [...sortedPinnedPrompts, ...unpinnedPrompts];

    return searchIndex ? sorted.slice(0, SEARCH_RESULT_LIMIT) : sorted;
  }, [initialPrompts, searchIndex, searchText, refreshKey]);

  useEffect(() => {
    const pushList = (prompts: PromptProps[], nextSearchMode: boolean) =>
      push(
        <PromptList
          prompts={prompts}
          searchMode={nextSearchMode}
          context={context}
          allowedActions={allowedActions}
          initialScripts={initialScripts}
          externalOnRefreshNeeded={externalOnRefreshNeeded}
          currentPath={currentPath}
        />,
      );

    // A trailing space after a query opens the matches as a list to type input into.
    if (searchMode && searchText.endsWith(" ") && searchText.trim().length > 0) {
      clearSearchBar({ forceScrollToTop: true });
      setSearchText("");
      pushList(displayPrompts, false);
      return;
    }

    // A lone space switches the current list between searching and typing input.
    if (searchText === " ") {
      setSearchText("");
      pushList(initialPrompts, !searchMode);
    }
  }, [
    searchMode,
    searchText,
    push,
    displayPrompts,
    initialPrompts,
    context,
    allowedActions,
    initialScripts,
    externalOnRefreshNeeded,
    currentPath,
  ]);

  // Launch arguments in the context override typed input, matching deeplinks that pre-fill it.
  const itemReplacements = useMemo<PromptContext>(
    () => ({ input: searchMode ? "" : searchText, ...context }),
    [context, searchMode, searchText],
  );

  const selectedScriptName = selectedAction.startsWith("script_") ? selectedAction.replace(/^script_/, "") : "";
  const isSelectedScriptAvailable = selectedScriptName
    ? scripts.some(({ name }) => name === selectedScriptName)
    : false;
  const shouldShowSelectedScriptPlaceholder = selectedScriptName !== "" && !isSelectedScriptAvailable;
  const isWaitingForSelectedScript = selectedScriptName !== "" && !hasResolvedScripts;
  const isRaycastScript = ({ name }: ScriptInfo) => /^Raycast\s+/.test(name);
  const raycastScripts = scripts.filter(isRaycastScript);
  const otherScripts = scripts.filter((script) => !isRaycastScript(script));

  return (
    <List
      isLoading={isLoading || isWaitingForSelectedScript}
      searchBarPlaceholder={searchMode ? "Search prompts…" : "Type to fill prompt…"}
      onSearchTextChange={setSearchText}
      searchText={searchText}
      filtering={false}
      searchBarAccessory={
        searchMode ? (
          <List.Dropdown
            id="preferred-action"
            tooltip="Select preferred action"
            storeValue={false}
            value={selectedAction}
            onChange={async (newValue: string) => {
              if (newValue === selectedAction) return;

              if (newValue === "" && selectedScriptName && !hasResolvedScripts) {
                return;
              }

              setSelectedAction(newValue);
              await defaultActionPreferenceStore.saveDefaultActionPreference(newValue);
              showToast({
                style: Toast.Style.Success,
                title: newValue === "" ? "Preferred action cleared" : "Preferred action set",
                message: newValue === "" ? undefined : newValue === "lastUsed" ? getLastUsedActionDisplay() : newValue,
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
            {shouldShowSelectedScriptPlaceholder && (
              <List.Dropdown.Section title={hasResolvedScripts ? "Unavailable Script" : "Restoring Selection"}>
                <List.Dropdown.Item
                  key={selectedAction}
                  title={selectedScriptName.replace(/^Raycast\s+/, "")}
                  value={selectedAction}
                  {...(selectedScriptName.startsWith("Raycast") ? { icon: Icon.RaycastLogoPos } : {})}
                />
              </List.Dropdown.Section>
            )}
            {raycastScripts.length > 0 && (
              <List.Dropdown.Section title="Raycast Scripts">
                {raycastScripts.map(({ name }) => (
                  <List.Dropdown.Item
                    key={`script_${name}`}
                    title={name.replace(/^Raycast\s+/, "")}
                    value={`script_${name}`}
                    icon={Icon.RaycastLogoPos}
                  />
                ))}
              </List.Dropdown.Section>
            )}
            {otherScripts.length > 0 && (
              <List.Dropdown.Section title="Scripts">
                {otherScripts.map(({ name }) => (
                  <List.Dropdown.Item key={`script_${name}`} title={name} value={`script_${name}`} />
                ))}
              </List.Dropdown.Section>
            )}
          </List.Dropdown>
        ) : null
      }
    >
      {displayPrompts.map((prompt) => (
        <MemoizedPromptListItem
          key={`${sourcePromptKeys.get(prompt) ?? prompt.identifier ?? prompt.title}:${refreshKey}`}
          prompt={prompt}
          replacements={itemReplacements}
          searchMode={searchMode}
          promptSpecificRootDir={resolvePromptRootDir(prompt, configuredRootDirs)}
          allowedActions={allowedActions}
          onPinToggle={handlePinToggle}
          scripts={scripts}
          onRefreshNeeded={effectiveOnRefreshNeeded}
          setCurrentInput={setSearchText}
          currentPath={currentPath}
        />
      ))}
    </List>
  );
}
