import React from "react";
import {
  Action,
  ActionPanel,
  Icon,
  Clipboard,
  Toast,
  closeMainWindow,
  open,
  showToast,
  Navigation,
} from "@raycast/api";
import { runAppleScript } from "@raycast/utils";
import fs from "fs";
import defaultActionPreferenceStore from "../stores/default-action-preference-store";
import { ScriptInfo } from "../utils/script-utils";
import inputHistoryStore from "../stores/input-history-store";
import type { PromptProps } from "../managers/prompt-manager";
import { SpecificReplacements, extractFinderSelectionPaths } from "../utils/placeholder-formatter";
import { buildFormattedPromptContent } from "../utils/prompt-formatting-utils";
import { generateGitLink } from "../utils/git-utils";
import { getEditorDisplayName, normalizeEditorApp, openPromptFileWithEditor } from "../utils/editor-launcher";
import {
  updateTemporaryDirectoryUsage,
  updateAnyTemporaryDirectoryUsage,
  removeTemporaryDirectory,
  getActiveTemporaryDirectories,
  restoreTemporaryDirectories,
} from "../stores/temporary-directory-store";
import promptUsageStore from "../stores/prompt-usage-store";
import promptManager from "../managers/prompt-manager";
import path from "path";
import configurationManager from "../managers/configuration-manager";
import { runPromptActionWithTracking } from "../utils/prompt-usage-utils";
import { writeContentToFile } from "../utils/file-clipboard-utils";
import { buildClaudeNewChatUrl } from "../utils/claude-deeplink";
import { showPromptMap } from "../utils/prompt-map-launcher";
import { promptMapNodeKey } from "../utils/prompt-map-model";
import { runAppleScriptDetached, runAppleScriptFile, runAppleScriptFileDetached } from "../utils/applescript-runner";

interface ActionItem {
  name: string;
  displayName: string;
  condition: boolean;
  action: React.ReactElement;
}

function getConfiguredEditor() {
  const editorApp = normalizeEditorApp(configurationManager.getPreference("customEditor"));
  return { editorApp, editorDisplayName: getEditorDisplayName(editorApp) };
}

export function getEditActionTitle(): string {
  return `Edit with ${getConfiguredEditor().editorDisplayName}`;
}

/** Opens the prompt's source file in the configured editor, at its definition when the editor supports it. */
export async function editPromptInEditor(prompt: PromptProps): Promise<void> {
  if (!prompt.filePath) return;

  const { editorApp, editorDisplayName } = getConfiguredEditor();
  try {
    const { openedAtLine } = await openPromptFileWithEditor(editorApp, prompt.filePath, prompt.lineNumber);
    if (!openedAtLine) {
      // No line jump possible: copy the title so the prompt can be
      // searched manually in the editor.
      await Clipboard.copy(prompt.title);
    }
    await closeMainWindow();

    await showToast({
      title: openedAtLine ? "Opened at prompt definition" : "Opened — title copied",
      style: Toast.Style.Success,
    });
  } catch (error) {
    console.error("Failed to open editor:", error);
    await showToast({
      title: `Couldn't open ${editorDisplayName}`,
      message: String(error),
      style: Toast.Style.Failure,
    });
  }
}

/** Unlists a temporary directory, restoring it when the prompt reload fails. */
export function createRemoveTempDirAction(
  tempDirSourcePath: string,
  navigation: Navigation,
  onRefreshNeeded?: () => void,
): React.ReactElement {
  return (
    <Action
      key={`remove-temp-dir-${tempDirSourcePath}`}
      title="Remove Temp Dir"
      icon={Icon.Eject}
      style={Action.Style.Destructive}
      onAction={async () => {
        const removedDirectory = getActiveTemporaryDirectories().find(
          (directory) => directory.path === tempDirSourcePath,
        );
        let reloaded = false;
        removeTemporaryDirectory(tempDirSourcePath);
        try {
          await promptManager.reloadPrompts();
          reloaded = true;
          onRefreshNeeded?.();
          await showToast(
            Toast.Style.Success,
            "Directory removed",
            `${path.basename(tempDirSourcePath)} prompts are no longer available`,
          );
          navigation.pop();
        } catch (error) {
          if (removedDirectory && !reloaded) {
            restoreTemporaryDirectories([removedDirectory]);
          }
          await showToast({
            style: Toast.Style.Failure,
            title: "Couldn't refresh prompts",
            message: String(error),
          });
        }
      }}
    />
  );
}

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
  const primaryAction = configurationManager.getPreference("primaryAction") as string;
  const configuredActions =
    primaryAction
      ?.split(",")
      .map((action) => action.trim())
      .filter(Boolean) || [];
  const promptDefinedActions = actions || [];
  const finalActions = Array.from(new Set([...promptDefinedActions, ...configuredActions]));

  const wrapActionHandler = (originalHandler: () => void | boolean | Promise<void | boolean>, actionName: string) => {
    return async () => {
      if (actionName.startsWith("script_")) {
        await defaultActionPreferenceStore.saveLastExecutedAction(actionName);
      }

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

      await runPromptActionWithTracking(prompt, actionName, originalHandler, (usedPrompt, usedAction, usedAt) =>
        promptUsageStore.recordUsage(usedPrompt, usedAction, usedAt),
      );
    };
  };

  const resolveCopyFileNamePrefix = (): string => {
    const selectionPaths = extractFinderSelectionPaths(baseReplacements.selection);
    if (selectionPaths.length > 0) {
      const firstPath = selectionPaths[0];
      try {
        const stats = fs.statSync(firstPath);
        if (stats.isDirectory()) return path.basename(firstPath);
        if (stats.isFile()) return path.basename(firstPath, path.extname(firstPath));
      } catch {
        // ignore
      }
    }
    return prompt.title || "prompt";
  };

  const getFinalContent = async (): Promise<string> => {
    const currentClipboard = (await Clipboard.readText()) ?? "";
    const finalReplacements: SpecificReplacements = {
      ...baseReplacements,
      clipboard: currentClipboard,
      now: new Date().toLocaleString(),
    };
    return buildFormattedPromptContent(prompt, finalReplacements, promptSpecificRootDir);
  };

  const scriptActions: ActionItem[] = scripts.map(({ path: scriptPath, name: scriptName }) => ({
    name: `script_${scriptName}`,
    displayName: scriptName,
    condition: true,
    action: (
      <Action
        title={scriptName.replace(/^Raycast\s+/, "")}
        icon={scriptName.startsWith("Raycast") ? Icon.RaycastLogoPos : Icon.Terminal}
        onAction={wrapActionHandler(async () => {
          try {
            const finalContent = await getFinalContent();
            await Clipboard.copy(finalContent);
            const args = scriptName.endsWith("ChatGPT") ? [finalContent] : [];
            const isCompiledScript = path.extname(scriptPath).toLowerCase() === ".scpt";
            const runDetached = scriptName === "Notion Chat";

            if (isCompiledScript) {
              await (runDetached ? runAppleScriptFileDetached : runAppleScriptFile)(scriptPath, args);
            } else {
              const scriptContent = fs.readFileSync(scriptPath, "utf8");
              await (runDetached ? runAppleScriptDetached : runAppleScript)(scriptContent, args);
            }

            // Scripts that drive Raycast itself need its window to stay open.
            if (runDetached || !scriptName.includes("Raycast")) {
              await closeMainWindow({ clearRootSearch: true });
            }
          } catch (error) {
            console.error(`Failed to execute script ${scriptName}:`, error);
            await showToast(Toast.Style.Failure, `${scriptName} failed`, String(error));
            return false;
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
            await showToast(Toast.Style.Success, "Copied to clipboard");
            await closeMainWindow({ clearRootSearch: true });
          }, "copyToClipboard")}
        />
      ),
    },
    {
      name: "copyAsFile",
      displayName: "Copy as File",
      condition: true,
      action: (
        <Action
          title="Copy as File"
          icon={Icon.NewDocument}
          shortcut={{ modifiers: ["cmd", "shift"], key: "f" }}
          onAction={wrapActionHandler(async () => {
            try {
              const finalContent = await getFinalContent();
              const filePath = writeContentToFile(finalContent, resolveCopyFileNamePrefix());
              await Clipboard.copy({ file: filePath });
              await showToast(Toast.Style.Success, "Copied as file", path.basename(filePath));
              await closeMainWindow({ clearRootSearch: true });
            } catch (error) {
              console.error("Failed to copy as file:", error);
              await showToast(Toast.Style.Failure, "Copy as file failed", String(error));
              return false;
            }
          }, "copyAsFile")}
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
            await showToast(Toast.Style.Success, "Pasted to app");
          }, "paste")}
        />
      ),
    },
    {
      name: "openInClaude",
      displayName: "Open in Claude",
      condition: true,
      action: (
        <Action
          title="Open in Claude"
          icon={Icon.SpeechBubble}
          shortcut={{ modifiers: ["cmd", "shift"], key: "l" }}
          onAction={wrapActionHandler(async () => {
            try {
              const finalContent = await getFinalContent();
              await Clipboard.copy(finalContent);
              await open(buildClaudeNewChatUrl(finalContent));
              await closeMainWindow({ clearRootSearch: true });
            } catch (error) {
              console.error("Failed to open Claude:", error);
              await showToast(Toast.Style.Failure, "Couldn't open Claude", "Is Claude Desktop installed?");
              return false;
            }
          }, "openInClaude")}
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
              await showToast(Toast.Style.Failure, "Can't share this prompt", "Only file-based prompts can be shared");
              return;
            }
            const gitLink = await generateGitLink(prompt.filePath);

            if (gitLink) {
              const markdownLink = `[Prompt: ${prompt.title}](${gitLink})`;
              await Clipboard.copy(markdownLink);
              await showToast(Toast.Style.Success, "Share link copied");
              await closeMainWindow({ clearRootSearch: true });
            } else {
              await showToast(
                Toast.Style.Failure,
                "Can't generate share link",
                "This file isn't in a Git repo with a remote origin",
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
      action: (
        <Action
          title={getEditActionTitle()}
          shortcut={{ modifiers: ["cmd"], key: "e" }}
          icon={Icon.Pencil}
          onAction={wrapActionHandler(() => editPromptInEditor(prompt), "editWithEditor")}
        />
      ),
    },
    {
      name: "openInPromptMap",
      displayName: "Open in Prompt Map",
      // Settings prompts are not part of the library Prompt Map shows.
      condition: !!prompt.filePath && !promptManager.isSystemPromptFile(prompt.filePath),
      action: (
        <Action
          title="Open in Prompt Map"
          icon={Icon.Network}
          shortcut={{ modifiers: ["cmd", "shift"], key: "m" }}
          onAction={wrapActionHandler(async () => {
            if (!prompt.filePath) return;
            await showPromptMap(promptMapNodeKey(prompt.filePath, prompt.sourceIndexPath ?? []));
          }, "openInPromptMap")}
        />
      ),
    },
    {
      name: "pin",
      displayName: "Pin",
      condition: !!onPinToggle,
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
    allActionItems.push({
      name: `remove_temp_dir_source_${path.basename(prompt.temporaryDirSource)}`,
      displayName: "Remove Temp Dir",
      condition: true,
      action: createRemoveTempDirAction(prompt.temporaryDirSource, navigation, onRefreshNeeded),
    });
  }

  const eligibleActions = allActionItems.filter((item) => item.condition);
  const normalizeName = (name: string) => name.toLowerCase().replace(/^script_/, "");

  eligibleActions.sort((a, b) => {
    const isScriptA = a.name.startsWith("script_");
    const isScriptB = b.name.startsWith("script_");

    if (isScriptA && !isScriptB) return -1;
    if (!isScriptA && isScriptB) return 1;

    const indexA = finalActions.findIndex((name) => name.toLowerCase() === normalizeName(a.name));
    const indexB = finalActions.findIndex((name) => name.toLowerCase() === normalizeName(b.name));

    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;
    return a.displayName.localeCompare(b.displayName);
  });

  const findAction = (name: string) => eligibleActions.find((item) => normalizeName(item.name) === name.toLowerCase());

  const defaultActionPreference = defaultActionPreferenceStore.getDefaultActionPreference();
  const preferredActionName =
    defaultActionPreference === "lastUsed"
      ? defaultActionPreferenceStore.getLastExecutedAction()
      : defaultActionPreference;
  const defaultActionItem = preferredActionName
    ? findAction(preferredActionName.replace(/^(script_|call\s+)/, ""))
    : undefined;

  const pinnedGroup: ActionItem[] = [];
  const pinnedNames = new Set<string>();
  const pinAction = (item: ActionItem | undefined) => {
    if (item && !pinnedNames.has(item.name)) {
      pinnedGroup.push(item);
      pinnedNames.add(item.name);
    }
  };

  // Prompt-defined actions take precedence over the user's global Preferred action,
  // and global Actions fill in the remaining pinned actions after it.
  promptDefinedActions.forEach((name) => pinAction(findAction(name)));
  pinAction(defaultActionItem);
  configuredActions.forEach((name) => pinAction(findAction(name)));

  const baseActionNames = new Set(baseActionItems.map((item) => item.name));
  const remainingActions = eligibleActions.filter((item) => !pinnedNames.has(item.name));
  const scriptGroup = remainingActions.filter((item) => item.name.startsWith("script_"));
  const baseGroup = remainingActions.filter((item) => baseActionNames.has(item.name));
  const otherGroup = remainingActions.filter(
    (item) => !item.name.startsWith("script_") && !baseActionNames.has(item.name),
  );

  // A group is shown without a section header when the header would only add noise.
  const renderGroup = (key: string, title: string, items: ActionItem[], flat: boolean): React.ReactElement[] => {
    const elements = items.map((item) => React.cloneElement(item.action, { key: item.name }));
    if (elements.length === 0 || flat) {
      return elements;
    }
    return [
      <ActionPanel.Section key={key} title={title}>
        {elements as any /* eslint-disable-line @typescript-eslint/no-explicit-any */}
      </ActionPanel.Section>,
    ];
  };

  const hasLeadingGroups = pinnedGroup.length > 0 || scriptGroup.length > 0;

  return [
    ...renderGroup("pinned-actions", "Pinned Actions", pinnedGroup, pinnedGroup.length === 1),
    ...renderGroup("script-actions", "Script Actions", scriptGroup, scriptGroup.length === 1),
    ...renderGroup("base-actions", "Basic Actions", baseGroup, !hasLeadingGroups && baseGroup.length <= 2),
    ...renderGroup("other-actions", "Other Actions", otherGroup, !hasLeadingGroups && baseGroup.length === 0),
  ];
}
