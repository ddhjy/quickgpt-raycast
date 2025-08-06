import React from "react";
import {
  getPreferenceValues,
  Action,
  ActionPanel,
  Icon,
  Clipboard,
  Toast,
  closeMainWindow,
  showToast,
  Navigation,
  Application,
} from "@raycast/api";
import { runAppleScript } from "@raycast/utils";
import fs from "fs";
import defaultActionPreferenceStore from "../stores/default-action-preference-store";
import { ScriptInfo } from "../utils/script-utils";
import inputHistoryStore from "../stores/input-history-store";
import { PromptProps } from "../managers/prompt-manager";
import { SpecificReplacements } from "../utils/placeholder-formatter";
import { buildFormattedPromptContent, getIndentedPromptTitles } from "../utils/prompt-formatting-utils";
import { generateGitLink } from "../utils/git-utils";
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
  customEditor: Application;
}

type ActionWithPossibleProps = React.ReactElement<Action.Props & { shortcut?: string; onAction?: () => void }> & React.ReactNode;

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
 * @param onPinToggle A callback function to handle pinning/unpinning prompts
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
  onPinToggle?: (prompt: PromptProps) => void,
) {
  const preferences = getPreferenceValues<Preferences>();
  const configuredActions =
    preferences.primaryAction
      ?.split(",")
      .map((action) => action.trim())
      .filter(Boolean) || [];
  const promptDefinedActions = actions || [];
  const finalActions = Array.from(new Set([...promptDefinedActions, ...configuredActions]));

  const wrapActionHandler = (originalHandler: (() => Promise<void>) | undefined | (() => void), actionName?: string) => {
    return async () => {
      // Only record script actions in Last Used (exclude basic actions like Copy, Paste)
      if (actionName && actionName !== "lastUsed" && actionName.startsWith("script_")) {
        defaultActionPreferenceStore.saveLastExecutedAction(actionName);
      }

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
            const scriptContent = fs.readFileSync(scriptPath, "utf8");
            const args = scriptName.endsWith("ChatGPT") ? [finalContent] : [];
            await runAppleScript(scriptContent, args);
            await closeMainWindow({ clearRootSearch: true });
          } catch (error) {
            console.error(`Failed to execute script ${scriptName}:`, error);
            await showToast(Toast.Style.Failure, "Script Error", `Failed to run ${scriptName}: ${String(error)}`);
          }
        }, `script_${scriptName}`)}
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
          }, "copyToClipboard")}
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
          }, "copyOriginalPrompt")}
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
          }, "paste")}
        />
      ),
    },
    {
      name: "sharePrompt",
      displayName: "Share Prompt",
      condition: !!prompt.filePath,
      action: (
        <Action
          title="Share Prompt"
          icon={Icon.Link}
          shortcut={{ modifiers: ["cmd", "shift"], key: "s" }}
          onAction={wrapActionHandler(async () => {
            if (!prompt.filePath) {
              await showToast(Toast.Style.Failure, "Cannot share this prompt", "It is not a file-based prompt.");
              return;
            }
            const gitLink = await generateGitLink(prompt.filePath);

            if (gitLink) {
              const markdownLink = `[Shared Prompt: ${prompt.title}](${gitLink})`;
              await Clipboard.copy(markdownLink);
              await showToast(Toast.Style.Success, "Copied Share Link", "Markdown link copied to clipboard.");
              await closeMainWindow({ clearRootSearch: true });
            } else {
              await showToast(
                Toast.Style.Failure,
                "Could Not Generate Git Link",
                "File is not in a Git repository with a remote 'origin'."
              );
            }
          }, "sharePrompt")}
        />
      ),
    },
    {
      name: "editWithEditor",
      displayName: "Edit with Editor",
      condition: !!prompt.filePath,
      action: (() => {
        const editorApp = preferences.customEditor;
        let editorDisplayName = editorApp.name;
        if (editorDisplayName.endsWith(".app")) {
          editorDisplayName = editorDisplayName.slice(0, -4);
        }

        return (
          <Action
            title={`Edit with ${editorDisplayName}`}
            shortcut={{ modifiers: ["cmd"], key: "e" }}
            icon={Icon.Pencil}
            onAction={wrapActionHandler(async () => {
              if (!prompt.filePath) return;

              await Clipboard.copy(prompt.title);

              try {
                let openCommand: string;
                const configDir = path.dirname(prompt.filePath);
                if (editorApp.bundleId && editorApp.bundleId.trim() !== "") {
                  openCommand = `open -b '${editorApp.bundleId}' '${configDir}' '${prompt.filePath}'`;
                } else {
                  openCommand = `open -a '${editorApp.path}' '${configDir}' '${prompt.filePath}'`;
                }

                await runAppleScript(`do shell script "${openCommand}"`);
                await closeMainWindow();

                const fileName = path.basename(prompt.filePath);
                await showToast({
                  title: "Opening File",
                  message: `Opening ${fileName} with ${editorDisplayName}`,
                  style: Toast.Style.Success,
                });
              } catch (error) {
                console.error("Failed to open editor:", error);
                await showToast({
                  title: "Error Opening Editor",
                  message: `Failed to open with ${editorDisplayName}. Error: ${String(error)}`,
                  style: Toast.Style.Failure,
                });
              }
            }, "editWithEditor")}
          />
        );
      })(),
    },
    {
      name: "pin",
      displayName: "Pin",
      condition: prompt.identifier !== "manage-temporary-directory" && !!onPinToggle,
      action: (
        <Action
          title={prompt.pinned ? "Unpin" : "Pin"}
          icon={Icon.Pin}
          onAction={wrapActionHandler(() => {
            if (onPinToggle) {
              onPinToggle(prompt);
            }
          }, "pin")}
          shortcut={{ modifiers: ["cmd", "shift"], key: "p" }}
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

    // 首先按类型排序：脚本操作优先于基础操作
    const isScriptA = a.name.startsWith("script_");
    const isScriptB = b.name.startsWith("script_");

    if (isScriptA && !isScriptB) return -1;
    if (!isScriptA && isScriptB) return 1;

    // 同类型内部按照 finalActions 中的顺序排序
    const indexA = finalActions.findIndex((name) => name.toLowerCase() === nameA);
    const indexB = finalActions.findIndex((name) => name.toLowerCase() === nameB);

    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;
    return a.displayName.localeCompare(b.displayName);
  });

  const defaultActionPreference = defaultActionPreferenceStore.getDefaultActionPreference();
  let defaultActionItem: ActionItem | undefined;

  if (defaultActionPreference === "lastUsed") {
    // Get the last actually executed action
    const lastExecutedAction = defaultActionPreferenceStore.getLastExecutedAction();
    if (lastExecutedAction) {
      const preferenceBaseName = lastExecutedAction.replace(/^(script_|call\s+)/, "");
      defaultActionItem = eligibleActions.find(
        (item) => item.name.toLowerCase().replace(/^script_/, "") === preferenceBaseName.toLowerCase(),
      );
    }
  } else if (defaultActionPreference) {
    const preferenceBaseName = defaultActionPreference.replace(/^(script_|call\s+)/, "");
    defaultActionItem = eligibleActions.find(
      (item) => item.name.toLowerCase().replace(/^script_/, "") === preferenceBaseName.toLowerCase(),
    );
  }

  const resultActions: React.ReactElement[] = [];
  const actionNames = new Set<string>();

  // Separate actions into groups
  const pinnedActionsGroup: ActionItem[] = [];
  const scriptActionsGroup: ActionItem[] = [];
  const baseActionsGroup: ActionItem[] = [];
  const otherActionsGroup: ActionItem[] = [];

  // Add default action to pinned group (highest priority)
  if (defaultActionItem) {
    pinnedActionsGroup.push(defaultActionItem);
    actionNames.add(defaultActionItem.name);
  }

  // Add actions specified in finalActions to pinned group (in order)
  finalActions.forEach((actionName) => {
    const matchingAction = eligibleActions.find((item) => {
      const itemName = item.name.toLowerCase().replace(/^script_/, "");
      return itemName === actionName.toLowerCase();
    });

    if (matchingAction && !actionNames.has(matchingAction.name)) {
      pinnedActionsGroup.push(matchingAction);
      actionNames.add(matchingAction.name);
    }
  });

  // Categorize remaining actions
  eligibleActions.forEach((item) => {
    if (!actionNames.has(item.name)) {
      if (item.name.startsWith("script_")) {
        scriptActionsGroup.push(item);
      } else if (["copyToClipboard", "copyOriginalPrompt", "paste", "sharePrompt", "editWithEditor", "pin"].includes(item.name)) {
        baseActionsGroup.push(item);
      } else {
        otherActionsGroup.push(item);
      }
      actionNames.add(item.name);
    }
  });

  // Create sections for grouped display
  // Pinned actions group (always show if exists, but only create section if multiple actions)
  if (pinnedActionsGroup.length > 0) {
    if (pinnedActionsGroup.length === 1) {
      // Single pinned action, don't create section
      resultActions.push(React.cloneElement(pinnedActionsGroup[0].action, { key: pinnedActionsGroup[0].name }));
    } else {
      // Multiple pinned actions, create section
      resultActions.push(
        <ActionPanel.Section key="pinned-actions" title="Pinned Actions">
          {pinnedActionsGroup.map((item) =>
            React.cloneElement(item.action, { key: item.name })
          ) as any /* eslint-disable-line @typescript-eslint/no-explicit-any */}
        </ActionPanel.Section>
      );
    }
  }

  if (scriptActionsGroup.length > 0) {
    if (scriptActionsGroup.length === 1) {
      // Single script action, don't create section
      resultActions.push(React.cloneElement(scriptActionsGroup[0].action, { key: scriptActionsGroup[0].name }));
    } else {
      // Multiple script actions, create section
      resultActions.push(
        <ActionPanel.Section key="script-actions" title="Script Actions">
          {scriptActionsGroup.map((item) =>
            React.cloneElement(item.action, { key: item.name })
          ) as any /* eslint-disable-line @typescript-eslint/no-explicit-any */}
        </ActionPanel.Section>
      );
    }
  }

  if (baseActionsGroup.length > 0) {
    if (pinnedActionsGroup.length === 0 && scriptActionsGroup.length === 0 && baseActionsGroup.length <= 2) {
      // No pinned actions, no scripts, and few base actions, don't create section
      baseActionsGroup.forEach((item) => {
        resultActions.push(React.cloneElement(item.action, { key: item.name }));
      });
    } else {
      // Create section for base actions
      resultActions.push(
        <ActionPanel.Section key="base-actions" title="Basic Actions">
          {baseActionsGroup.map((item) =>
            React.cloneElement(item.action, { key: item.name })
          ) as any /* eslint-disable-line @typescript-eslint/no-explicit-any */}
        </ActionPanel.Section>
      );
    }
  }

  if (otherActionsGroup.length > 0) {
    if (pinnedActionsGroup.length === 0 && scriptActionsGroup.length === 0 && baseActionsGroup.length === 0) {
      // Only other actions, don't create section
      otherActionsGroup.forEach((item) => {
        resultActions.push(React.cloneElement(item.action, { key: item.name }));
      });
    } else {
      // Create section for other actions
      resultActions.push(
        <ActionPanel.Section key="other-actions" title="Other Actions">
          {otherActionsGroup.map((item) =>
            React.cloneElement(item.action, { key: item.name })
          ) as any /* eslint-disable-line @typescript-eslint/no-explicit-any */}
        </ActionPanel.Section>
      );
    }
  }

  // Fallback: if no actions were added, add the default copy action
  if (resultActions.length === 0) {
    const copyAction = baseActionItems.find((a) => a.name === "copyToClipboard");
    if (copyAction) {
      resultActions.push(React.cloneElement(copyAction.action, { key: copyAction.name }));
    }
  }

  return resultActions;
}
