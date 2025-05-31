import React from "react";
import {
  getPreferenceValues,
  Action,
  Icon,
  Clipboard,
  Toast,
  closeMainWindow,
  showToast,
  Navigation,
} from "@raycast/api";
import { runAppleScript } from "@raycast/utils";
import fs from "fs";
import defaultActionPreferenceStore from "../stores/default-action-preference-store";
import { ScriptInfo } from "../utils/script-utils";
import inputHistoryStore from "../stores/input-history-store";
import { PromptProps } from "../managers/prompt-manager";
import { SpecificReplacements } from "../utils/placeholder-formatter";
import { buildFormattedPromptContent, getIndentedPromptTitles } from "../utils/prompt-formatting-utils";
import {
  updateTemporaryDirectoryUsage,
  updateAnyTemporaryDirectoryUsage,
  removeTemporaryDirectory,
} from "../stores/temporary-directory-store";
import promptManager from "../managers/prompt-manager";
import path from "path";

interface Preferences {
  primaryAction: string;
  scriptsDirectory?: string;
  scriptsDirectory1?: string;
  scriptsDirectory2?: string;
}

type ActionWithPossibleProps = React.ReactElement<Action.Props & { shortcut?: string; onAction?: () => void }>;

interface ActionItem {
  name: string;
  displayName: string;
  condition: boolean;
  action: ActionWithPossibleProps;
}

/**
 * Generates a sorted list of Raycast Action elements based on the prompt definition,
 * global preferences, and available scripts. AI actions now trigger a deeplink.
 *
 * @param prompt The prompt object to generate actions for
 * @param baseReplacements Base replacements without clipboard
 * @param promptSpecificRootDir Root directory for file placeholder resolution
 * @param actions An optional array of action names specified in the prompt definition.
 * @param scripts An array of available script information.
 * @param navigation The Navigation object from useNavigation() hook.
 * @param onRefreshNeeded A callback function to be called when the prompt manager needs to refresh
 * @returns An array of React elements representing the sorted Raycast Actions.
 */
export function generatePromptActions(
  prompt: PromptProps,
  baseReplacements: Omit<SpecificReplacements, "clipboard">,
  promptSpecificRootDir: string | undefined,
  actions: string[] | undefined,
  scripts: ScriptInfo[],
  navigation: Navigation,
  onRefreshNeeded?: () => void,
) {
  const preferences = getPreferenceValues<Preferences>();
  const configuredActions =
    preferences.primaryAction
      ?.split(",")
      .map((action) => action.trim())
      .filter(Boolean) || [];
  const promptDefinedActions = actions || [];
  const finalActions = Array.from(new Set([...promptDefinedActions, ...configuredActions]));

  const wrapActionHandler = (originalHandler: (() => Promise<void>) | undefined | (() => void)) => {
    return async () => {
      // Save input to history if there's any input
      if (baseReplacements.input && baseReplacements.input.trim()) {
        inputHistoryStore.addToHistory(baseReplacements.input);
      }

      if (prompt.isTemporary) {
        if (prompt.temporaryDirSource) {
          updateTemporaryDirectoryUsage(prompt.temporaryDirSource);
        } else {
          updateAnyTemporaryDirectoryUsage();
        }
      }

      if (originalHandler) {
        if (originalHandler.constructor.name === "AsyncFunction") {
          await (originalHandler as () => Promise<void>)();
        } else {
          (originalHandler as () => void)();
        }
      }
    };
  };

  const getFinalContent = async (): Promise<string> => {
    const currentClipboard = (await Clipboard.readText()) ?? "";
    const finalReplacements: SpecificReplacements = {
      ...baseReplacements,
      clipboard: currentClipboard,
      now: new Date().toLocaleString(),
      promptTitles: getIndentedPromptTitles(),
    };
    return buildFormattedPromptContent(prompt, finalReplacements, promptSpecificRootDir);
  };

  const scriptActions: ActionItem[] = scripts.map(({ path: scriptPath, name: scriptName }) => ({
    name: `script_${scriptName}`,
    displayName: scriptName,
    condition: true,
    action: (
      <Action
        title={scriptName}
        icon={Icon.Terminal}
        onAction={wrapActionHandler(async () => {
          try {
            const finalContent = await getFinalContent();
            await Clipboard.copy(finalContent);
            await closeMainWindow({ clearRootSearch: true });
            const scriptContent = fs.readFileSync(scriptPath, "utf8");
            const args = scriptName.endsWith("ChatGPT") ? [finalContent] : [];
            await runAppleScript(scriptContent, args);
          } catch (error) {
            console.error(`Failed to execute script ${scriptName}:`, error);
            await showToast(Toast.Style.Failure, "Script Error", `Failed to run ${scriptName}: ${String(error)}`);
          }
        })}
      />
    ),
  }));

  const baseActionItems: ActionItem[] = [
    {
      name: "copyToClipboard",
      displayName: "Copy",
      condition: true,
      action: (
        <Action
          title="Copy"
          icon={Icon.Clipboard}
          shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
          onAction={wrapActionHandler(async () => {
            const finalContent = await getFinalContent();
            await Clipboard.copy(finalContent);
            await showToast(Toast.Style.Success, "Copied");
            await closeMainWindow({ clearRootSearch: true });
          })}
        />
      ),
    },
    {
      name: "copyOriginalPrompt",
      displayName: "Copy Prompt",
      condition: true,
      action: (
        <Action
          title="Copy Prompt"
          icon={Icon.Document}
          shortcut={{ modifiers: ["cmd", "shift"], key: "o" }}
          onAction={wrapActionHandler(async () => {
            const title = prompt.title || "";
            const originalContent = prompt.content || "";
            const formattedContent = title + "\n---\n" + originalContent;
            await Clipboard.copy(formattedContent);
            await showToast(Toast.Style.Success, "Copied Original Prompt");
            await closeMainWindow({ clearRootSearch: true });
          })}
        />
      ),
    },
    {
      name: "paste",
      displayName: "Paste",
      condition: true,
      action: (
        <Action
          title="Paste"
          icon={Icon.Document}
          shortcut={{ modifiers: ["cmd", "shift"], key: "v" }}
          onAction={wrapActionHandler(async () => {
            const finalContent = await getFinalContent();
            await Clipboard.copy(finalContent);
            await Clipboard.paste(finalContent);
            await showToast(Toast.Style.Success, "Pasted");
          })}
        />
      ),
    },
  ];

  const allActionItems: ActionItem[] = [...scriptActions, ...baseActionItems];

  if (prompt.isTemporary && prompt.temporaryDirSource) {
    const tempDirSourcePath = prompt.temporaryDirSource;
    allActionItems.push({
      name: `remove_temp_dir_source_${path.basename(tempDirSourcePath)}`,
      displayName: "Remove Temp Dir",
      condition: true,
      action: (
        <Action
          title="Remove Temp Dir"
          icon={Icon.Eject}
          style={Action.Style.Destructive}
          onAction={async () => {
            removeTemporaryDirectory(tempDirSourcePath);
            promptManager.reloadPrompts();
            if (onRefreshNeeded) {
              onRefreshNeeded();
            }
            await showToast(
              Toast.Style.Success,
              "Temporary Directory Removed",
              `Directory ${path.basename(tempDirSourcePath)} and its prompts have been unlisted.`,
            );
            navigation.pop();
          }}
        />
      ),
    });
  }

  const eligibleActions = allActionItems.filter((item) => item.condition);

  eligibleActions.sort((a, b) => {
    const getNameForSort = (name: string) => name.toLowerCase().replace(/^script_/, "");
    const nameA = getNameForSort(a.name);
    const nameB = getNameForSort(b.name);

    const indexA = finalActions.findIndex((name) => name.toLowerCase() === nameA);
    const indexB = finalActions.findIndex((name) => name.toLowerCase() === nameB);

    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;
    return a.displayName.localeCompare(b.displayName);
  });

  const defaultActionPreference = defaultActionPreferenceStore.getDefaultActionPreference();
  let defaultActionItem: ActionItem | undefined;
  if (defaultActionPreference) {
    const preferenceBaseName = defaultActionPreference.replace(/^(script_|call\s+)/, "");
    defaultActionItem = eligibleActions.find(
      (item) => item.name.toLowerCase().replace(/^script_/, "") === preferenceBaseName.toLowerCase(),
    );
  }

  const resultActions: React.ReactElement[] = [];
  const actionNames = new Set<string>();

  if (defaultActionItem) {
    resultActions.push(React.cloneElement(defaultActionItem.action, { key: defaultActionItem.name }));
    actionNames.add(defaultActionItem.name);
  }

  eligibleActions.forEach((item) => {
    if (!actionNames.has(item.name)) {
      resultActions.push(React.cloneElement(item.action, { key: item.name }));
      actionNames.add(item.name);
    }
  });

  if (resultActions.length === 0) {
    const copyAction = baseActionItems.find((a) => a.name === "copyToClipboard");
    if (copyAction) {
      resultActions.push(React.cloneElement(copyAction.action, { key: copyAction.name }));
    }
  }

  return resultActions;
}
