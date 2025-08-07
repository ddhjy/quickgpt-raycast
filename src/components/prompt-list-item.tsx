import React, { useMemo, useState, useEffect } from "react";
import {
  List,
  ActionPanel,
  Icon,
  Action,
  Color,
  showToast,
  Toast,
  closeMainWindow,
  openExtensionPreferences,
  getPreferenceValues,
  Clipboard,
  Image,
  useNavigation,
  Application,
} from "@raycast/api";
import { runAppleScript } from "@raycast/utils";
import { PromptProps } from "../managers/prompt-manager";
import { SpecificReplacements } from "../utils/placeholder-formatter";
import path from "path";
import { generatePromptActions } from "./prompt-actions";
import { getPlaceholderIcons, findOptionPlaceholders } from "../utils/prompt-formatting-utils";
import { findUsedOptionPlaceholders } from "../utils/option-placeholder-utils";
import { ScriptInfo } from "../utils/script-utils";
import { placeholderFormatter } from "../utils/placeholder-formatter";
import { PromptList } from "./prompt-list";
import { PromptOptionsForm } from "./prompt-options-form";
import { TemporaryDirectoryManager } from "./temporary-directory-manager";
import {
  removeTemporaryDirectory,
  getActiveTemporaryDirectoriesWithExpiry,
  TemporaryDirectoryWithExpiry,
} from "../stores/temporary-directory-store";
import promptManager from "../managers/prompt-manager";
import inputHistoryStore from "../stores/input-history-store";

interface PromptListItemProps {
  prompt: PromptProps;
  index: number;
  replacements: Omit<SpecificReplacements, "clipboard">;
  searchMode?: boolean;
  promptSpecificRootDir?: string;
  allowedActions?: string[];
  onPinToggle: (prompt: PromptProps) => void;
  activeSearchText?: string;
  scripts: ScriptInfo[];
  onRefreshNeeded: () => void;
  addToHistory?: (input: string) => void;
  setCurrentInput?: (input: string) => void;
}

/**
 * Renders a single item in the prompt list.
 * Generates the appropriate UI and ActionPanel based on the prompt type (regular, folder, options, special).
 *
 * @param props The component props.
 * @param props.prompt The prompt data for this list item.
 * @param props.index The index of the item in the list.
 * @param props.replacements Base replacements without clipboard.
 * @param props.searchMode Indicates if the parent list is in search mode.
 * @param props.promptSpecificRootDir The specific root directory containing this prompt, if applicable.
 * @param props.allowedActions Optional list of allowed action names for this prompt.
 * @param props.onPinToggle Callback function to handle pinning/unpinning.
 * @param props.activeSearchText The current text in the search bar (if not in search mode).
 * @param props.scripts List of available scripts.
 * @param props.onRefreshNeeded Callback function to refresh the prompt list.
 */
export function PromptListItem({
  prompt,
  // index parameter not used, but kept for interface consistency
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  index,
  replacements,
  searchMode = false,
  promptSpecificRootDir,
  allowedActions,
  onPinToggle,
  scripts,
  onRefreshNeeded,
  addToHistory,
  setCurrentInput,
}: PromptListItemProps) {
  const navigation = useNavigation();
  const [temporaryDirs, setTemporaryDirs] = useState<TemporaryDirectoryWithExpiry[]>([]);
  const [refreshTimer, setRefreshTimer] = useState(0);

  useEffect(() => {
    setTemporaryDirs(getActiveTemporaryDirectoriesWithExpiry());

    const timer = setInterval(() => {
      setTemporaryDirs(getActiveTemporaryDirectoriesWithExpiry());
      setRefreshTimer((prev) => prev + 1);
    }, 1000);

    // Clean up timer when component unmounts
    return () => clearInterval(timer);
  }, []);

  const rawTitle = prompt.title || "";
  const mergedForTitle = {
    ...prompt,
    ...replacements,
    now: new Date().toLocaleString(),
  };
  const formattedTitleWithPlaceholders = placeholderFormatter(rawTitle, mergedForTitle, promptSpecificRootDir, {
    resolveFile: false,
  });

  // Apply placeholder formatting to the actual prompt title
  const formattedActualTitle = formattedTitleWithPlaceholders;

  // Initialize displayTitle with the formatted actual title
  let displayTitle = formattedActualTitle;

  // Apply special formatting only in searchMode and if the prompt has a path (is nested)
  if (searchMode && prompt.path) {
    const pathComponents = prompt.path.split(" / ");
    // pathComponents includes the final title, e.g., ["一级", "二级", "Prompt B"]
    const hierarchyDepth = pathComponents.length; // Total depth including the title

    if (hierarchyDepth > 1) {
      // Only add prefix if there's at least one parent directory
      const topLevelDirectory = pathComponents[0];
      let prefix = topLevelDirectory;

      // Add "..." if original depth was 3 or more (e.g., Top/Mid/Title)
      if (hierarchyDepth >= 3) {
        prefix += " ...";
      }

      // Combine prefix and the actual formatted title
      displayTitle = `${prefix} / ${formattedActualTitle}`;
    }
    // If hierarchyDepth is 1, it means no parent directory, so displayTitle remains formattedActualTitle
  } else {
    displayTitle = formattedTitleWithPlaceholders;
  }

  // Dynamic title and icon
  let displayIcon: string | Image.Asset = prompt.icon ?? "🔖";

  if (prompt.identifier === "manage-temporary-directory") {
    if (temporaryDirs.length > 0) {
      displayTitle = `Temporary Prompts Directory (${temporaryDirs.length})`;
      displayIcon = Icon.Folder;
    } else {
      displayTitle = "Add temporary directory";
      displayIcon = Icon.Plus;
    }
  }

  if (prompt.identifier === "open-custom-prompts-dir") {
    const preferences = getPreferenceValues<{
      customPromptsDirectory?: string;
      customPromptsDirectory1?: string;
      customPromptsDirectory2?: string;
      customPromptsDirectory3?: string;
      customPromptsDirectory4?: string;
    }>();

    const promptDirs = [
      preferences.customPromptsDirectory,
      preferences.customPromptsDirectory1,
      preferences.customPromptsDirectory2,
      preferences.customPromptsDirectory3,
      preferences.customPromptsDirectory4,
    ].filter(Boolean);

    if (promptDirs.length > 0) {
      displayTitle = `Prompts Directory (${promptDirs.length})`;
    }
    displayIcon = Icon.Folder;
  }

  // Handle Settings related options icons
  if (prompt.identifier === "open-scripts-dir") {
    displayIcon = Icon.Code;
  } else if (prompt.identifier === "open-preferences") {
    displayIcon = Icon.Gear;
  }

  // Memoize placeholder icons
  const placeholderIcons = useMemo(
    () => getPlaceholderIcons(prompt.content, replacements),
    [prompt.content, replacements],
  );

  // Memoize prompt actions
  const promptActions = useMemo(() => {
    if (prompt.identifier === "manage-temporary-directory") {
      return (
        <Action.Push
          title="Open"
          icon={Icon.List}
          target={<TemporaryDirectoryManager onRefreshNeeded={onRefreshNeeded} />}
        />
      );
    } else if (prompt.identifier === "open-custom-prompts-dir") {
      return handleCustomPromptsDirectoryActions();
    } else if (prompt.identifier === "open-scripts-dir") {
      const preferences = getPreferenceValues<{
        scriptsDirectory?: string;
        scriptsDirectory1?: string;
        scriptsDirectory2?: string;
      }>();

      const scriptDirs = [
        preferences.scriptsDirectory,
        preferences.scriptsDirectory1,
        preferences.scriptsDirectory2,
      ].filter(Boolean);

      if (scriptDirs.length === 0) {
        return (
          <Action
            title="Configure"
            icon={Icon.Gear}
            onAction={() => {
              openExtensionPreferences();
              closeMainWindow();
            }}
          />
        );
      } else if (scriptDirs.length === 1) {
        return (
          <Action
            title="Open"
            icon={Icon.Folder}
            onAction={async () => {
              await runAppleScript(`do shell script "open -a Cursor '${scriptDirs[0]}'"`);
              await closeMainWindow();
            }}
          />
        );
      } else {
        return (
          <>
            {scriptDirs.map((dir, index) => {
              const dirName = path.basename(dir as string);
              return (
                <Action
                  key={index}
                  title={`Open ${dirName}`}
                  icon={Icon.Folder}
                  onAction={async () => {
                    await runAppleScript(`do shell script "open -a Cursor '${dir}'"`);
                    await closeMainWindow();
                  }}
                />
              );
            })}
          </>
        );
      }
    } else if (prompt.identifier === "open-preferences") {
      return (
        <Action
          title="Open"
          icon={Icon.Gear}
          onAction={() => {
            openExtensionPreferences();
            closeMainWindow();
          }}
        />
      );
    } else if (prompt.subprompts) {
      // Actions for folder type prompts
      const folderActions: React.ReactElement[] = [];

      // 1. Open folder action (usually the primary action)
      folderActions.push(
        <Action.Push
          key="open-folder"
          title="Open"
          icon={prompt.icon ?? Icon.Folder} // Icon.FolderOpen would be more appropriate
          target={
            <PromptList
              prompts={prompt.subprompts}
              selectionText={replacements.selection ?? ""}
              currentApp={replacements.currentApp ?? ""}
              allApp={replacements.allApp ?? ""}
              browserContent={replacements.browserContent ?? ""}
              allowedActions={allowedActions || prompt.actions} // These are actions for sub-items
              initialScripts={scripts}
              externalOnRefreshNeeded={onRefreshNeeded} // Pass refresh callback
            />
          }
        />,
      );

      // 2. Add Pin/Unpin action for folders
      if (onPinToggle) {
        folderActions.push(
          <Action
            key="pin-folder"
            title={prompt.pinned ? "Unpin" : "Pin"}
            icon={Icon.Pin}
            onAction={() => {
              onPinToggle(prompt);
            }}
            shortcut={{ modifiers: ["cmd", "shift"], key: "p" }}
          />,
        );
      }

      // 3. Add "Edit with xxx" action for folders
      if (prompt.filePath) {
        const preferences = getPreferenceValues<{ customEditor: Application }>();
        const editorApp = preferences.customEditor;
        let editorDisplayName = editorApp.name;
        if (editorDisplayName.endsWith(".app")) {
          editorDisplayName = editorDisplayName.slice(0, -4);
        }

        folderActions.push(
          <Action
            key="edit-folder-with-editor"
            title={`Edit with ${editorDisplayName}`}
            shortcut={{ modifiers: ["cmd"], key: "e" }}
            icon={Icon.Pencil}
            onAction={async () => {
              await Clipboard.copy(prompt.title);

              try {
                let openCommand: string;
                const configDir = path.dirname(prompt.filePath!);
                if (editorApp.bundleId && editorApp.bundleId.trim() !== "") {
                  openCommand = `open -b '${editorApp.bundleId}' '${configDir}' '${prompt.filePath}'`;
                } else {
                  openCommand = `open -a '${editorApp.path}' '${configDir}' '${prompt.filePath}'`;
                }

                await runAppleScript(`do shell script "${openCommand}"`);
                await closeMainWindow();

                const fileName = path.basename(prompt.filePath!);
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
            }}
          />,
        );
      }

      // 4. If sourced from temporary directory, add action to remove source directory
      if (prompt.isTemporary && prompt.temporaryDirSource) {
        const tempDirSourcePath = prompt.temporaryDirSource; // Closure capture
        folderActions.push(
          <Action
            key={`remove-folder-temp-dir-${tempDirSourcePath}`}
            title="Remove Temp Dir"
            icon={Icon.Eject} // Or Icon.Trash
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
              // If the current view is this folder or its children, go back to the previous level
              navigation.pop();
            }}
          />,
        );
      }
      return <>{folderActions}</>; // Return wrapped in React Fragment
    } else {
      // 1. 首先，为所有 prompt 生成标准的 Action 列表
      const standardActions = generatePromptActions(
        prompt,
        replacements,
        promptSpecificRootDir,
        allowedActions || prompt.actions,
        scripts,
        navigation,
        onRefreshNeeded,
        onPinToggle,
      );

      // 转换为可变数组
      const finalActions = standardActions ? [...standardActions] : [];

      // 2. 检查是否存在需要配置的 options
      const usedOptionKeys = findUsedOptionPlaceholders(prompt, replacements);
      const directOptionKeys = findOptionPlaceholders(prompt);
      const allOptionKeys = [...new Set([...usedOptionKeys, ...directOptionKeys])];
      const hasOptions = allOptionKeys.length > 0 || (prompt.options && Object.keys(prompt.options).length > 0);

      // 3. 如果存在 options，则在 Action 列表的最前面添加 "Configure Options"
      if (hasOptions) {
        const configureOptionsAction = (
          <Action.Push
            key="configure-options"
            title="Configure Options"
            icon={Icon.Gear}
            target={
              <PromptOptionsForm
                prompt={prompt}
                optionKeys={allOptionKeys}
                baseReplacements={replacements}
                scripts={scripts}
              />
            }
          />
        );
        // 将 "Configure Options" 插入到列表的最前面
        finalActions.unshift(configureOptionsAction);
      }

      // 4. 返回最终的 Action 列表
      return <>{finalActions.length > 0 ? finalActions : null}</>;
    }
  }, [
    prompt,
    replacements,
    promptSpecificRootDir,
    allowedActions,
    scripts,
    navigation,
    onRefreshNeeded,
    temporaryDirs,
    refreshTimer,
  ]);

  // Create accessories to display remaining time
  const getAccessories = () => {
    // For settings-related options, don't display any accessory icons
    if (
      prompt.identifier === "manage-temporary-directory" ||
      prompt.identifier === "open-preferences" ||
      prompt.identifier === "open-custom-prompts-dir" ||
      prompt.identifier === "open-scripts-dir"
    ) {
      return [];
    }

    return [
      prompt.pinned ? { tag: { value: "PIN", color: Color.Blue } } : {},
      ...placeholderIcons.map((accessory: List.Item.Accessory, i: number, arr: List.Item.Accessory[]) =>
        i === arr.length - 1
          ? {
              ...accessory,
              tooltip:
                prompt.content ??
                prompt.subprompts?.map((subPrompt, subIndex) => `${subIndex + 1}. ${subPrompt.title} `).join("\n"),
            }
          : accessory,
      ),
      ...(placeholderIcons.length === 0
        ? [
            {
              icon: prompt.subprompts ? Icon.Folder : Icon.Paragraph,
              tooltip:
                prompt.content ??
                prompt.subprompts?.map((subPrompt, subIndex) => `${subIndex + 1}. ${subPrompt.title} `).join("\n"),
            },
          ]
        : []),
    ];
  };

  return (
    <List.Item
      key={prompt.identifier || prompt.title}
      icon={displayIcon}
      title={displayTitle.replace(/\n/g, " ")}
      accessories={getAccessories()}
      actions={
        <ActionPanel>
          {promptActions}
          {!searchMode && (
            <>
              {addToHistory && setCurrentInput && (
                <Action
                  title="Show Input History"
                  icon={Icon.Clock}
                  shortcut={{ modifiers: ["cmd"], key: "y" }}
                  onAction={() => {
                    const history = inputHistoryStore.getHistory();
                    navigation.push(
                      <List>
                        {history.map((item: string, index: number) => (
                          <List.Item
                            key={index}
                            title={item}
                            actions={
                              <ActionPanel>
                                <Action
                                  title="Use This Input"
                                  onAction={() => {
                                    navigation.pop();
                                    setCurrentInput(item);
                                  }}
                                />
                                <Action
                                  title="Delete"
                                  style={Action.Style.Destructive}
                                  onAction={() => {
                                    inputHistoryStore.removeFromHistory(item);
                                    // Refresh the list by re-creating it
                                    navigation.pop();
                                    navigation.push(
                                      <List>
                                        {inputHistoryStore
                                          .getHistory()
                                          .map((historyItem: string, historyIndex: number) => (
                                            <List.Item
                                              key={historyIndex}
                                              title={historyItem}
                                              actions={
                                                <ActionPanel>
                                                  <Action
                                                    title="Use This Input"
                                                    onAction={() => {
                                                      navigation.pop();
                                                      setCurrentInput(historyItem);
                                                    }}
                                                  />
                                                </ActionPanel>
                                              }
                                            />
                                          ))}
                                      </List>,
                                    );
                                  }}
                                />
                              </ActionPanel>
                            }
                          />
                        ))}
                      </List>,
                    );
                  }}
                />
              )}
              <Action
                title="Show Clipboard History"
                icon={Icon.CopyClipboard}
                shortcut={{ modifiers: ["cmd", "shift"], key: "y" }}
                onAction={async () => {
                  try {
                    // Read clipboard history (up to 6 items)
                    const clipboardHistory: { text: string; offset: number }[] = [];

                    for (let offset = 0; offset < 6; offset++) {
                      try {
                        const text = await Clipboard.readText({ offset });
                        if (text) {
                          clipboardHistory.push({ text, offset });
                        }
                      } catch {
                        // If reading fails, no more history available
                        break;
                      }
                    }

                    if (clipboardHistory.length === 0) {
                      await showToast({
                        style: Toast.Style.Failure,
                        title: "No clipboard history available",
                      });
                      return;
                    }

                    navigation.push(
                      <List>
                        <List.Section title="Clipboard History" subtitle={`${clipboardHistory.length} items`}>
                          {clipboardHistory.map((item, index) => (
                            <List.Item
                              key={index}
                              title={item.text.length > 100 ? item.text.substring(0, 100) + "..." : item.text}
                              accessories={[{ text: index === 0 ? "Current" : "" }]}
                              actions={
                                <ActionPanel>
                                  <Action
                                    title="Copy to Clipboard"
                                    icon={Icon.Clipboard}
                                    onAction={async () => {
                                      await Clipboard.copy(item.text);
                                      navigation.pop();
                                      await showToast({
                                        style: Toast.Style.Success,
                                        title: "Copied to clipboard",
                                      });
                                    }}
                                  />
                                  <Action.CopyToClipboard title="Copy Text" content={item.text} />
                                </ActionPanel>
                              }
                            />
                          ))}
                        </List.Section>
                      </List>,
                    );
                  } catch (error) {
                    console.error("Failed to read clipboard history:", error);
                    await showToast({
                      style: Toast.Style.Failure,
                      title: "Failed to read clipboard history",
                      message: String(error),
                    });
                  }
                }}
              />
            </>
          )}
          {prompt.identifier !== "manage-temporary-directory" && (
            <>
              <Action.CopyToClipboard
                title="Copy Identifier"
                content={`quickgpt-${prompt.identifier}`}
                icon={Icon.Document}
              />
              <Action.CopyToClipboard
                title="Copy Deeplink"
                content={`raycast://extensions/ddhjy2012/quickgpt/prompt-lab?arguments=${encodeURIComponent(
                  JSON.stringify({
                    target: `quickgpt-${prompt.identifier}`,
                    actions: prompt.actions?.join(","),
                  }),
                )}`}
                icon={Icon.Link}
              />
            </>
          )}
        </ActionPanel>
      }
    />
  );
}

// Use React.memo to prevent unnecessary re-renders
export const MemoizedPromptListItem = React.memo(PromptListItem);

function handleCustomPromptsDirectoryActions() {
  const preferences = getPreferenceValues<{
    customPromptsDirectory?: string;
    customPromptsDirectory1?: string;
    customPromptsDirectory2?: string;
    customPromptsDirectory3?: string;
    customPromptsDirectory4?: string;
  }>();

  // Create an array of all possible prompt directories
  const promptDirs = [
    preferences.customPromptsDirectory,
    preferences.customPromptsDirectory1,
    preferences.customPromptsDirectory2,
    preferences.customPromptsDirectory3,
    preferences.customPromptsDirectory4,
  ].filter(Boolean);

  if (promptDirs.length === 0) {
    return (
      <Action
        title="Configure"
        icon={Icon.Gear}
        onAction={() => {
          openExtensionPreferences();
          closeMainWindow();
        }}
      />
    );
  } else if (promptDirs.length === 1) {
    // If there's only one directory, open it directly
    return (
      <Action
        title="Open"
        icon={Icon.Folder}
        onAction={async () => {
          try {
            await runAppleScript(`do shell script "open -a Cursor '${promptDirs[0]}'"`);
            closeMainWindow();
          } catch (error) {
            console.error("Failed to open prompt directory:", error);
            await showToast(Toast.Style.Failure, "Error opening directory");
          }
        }}
      />
    );
  } else {
    // If there are multiple directories, provide actions for each
    return (
      <>
        {promptDirs.map((dir, index) => {
          const dirName = path.basename(dir as string);
          return (
            <Action
              key={index}
              title={`Open ${dirName}`}
              icon={Icon.Folder}
              onAction={async () => {
                try {
                  await runAppleScript(`do shell script "open -a Cursor '${dir}'"`);
                  closeMainWindow();
                } catch (error) {
                  console.error(`Failed to open prompt directory ${dir}:`, error);
                  await showToast(Toast.Style.Failure, "Error opening directory");
                }
              }}
            />
          );
        })}
      </>
    );
  }
}
