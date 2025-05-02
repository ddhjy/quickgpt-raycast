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
  getSelectedFinderItems,
  Image,
} from "@raycast/api";
import { runAppleScript } from "@raycast/utils";
import { PromptProps } from "../managers/PromptManager";
import { SpecificReplacements } from "../utils/placeholderFormatter";
import path from "path";
import { generatePromptActions } from "./PromptActions";
import { getPlaceholderIcons, findOptionPlaceholders } from "../utils/promptFormattingUtils";
import { ScriptInfo } from "../utils/scriptUtils";
import { placeholderFormatter } from "../utils/placeholderFormatter";
import { PromptList } from "./PromptList";
import { PromptOptionsForm } from "./PromptOptionsForm";
import {
  addTemporaryDirectory,
  removeTemporaryDirectory,
  removeAllTemporaryDirectories,
  getActiveTemporaryDirectoriesWithExpiry,
  TemporaryDirectoryWithExpiry,
} from "../stores/TemporaryPromptDirectoryStore";
import promptManager from "../managers/PromptManager";
import fs from "fs";

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
}: PromptListItemProps) {
  // Use temporary directory list with expiration time information
  const [temporaryDirs, setTemporaryDirs] = useState<TemporaryDirectoryWithExpiry[]>([]);
  const [refreshTimer, setRefreshTimer] = useState(0);

  // Update directory information every second to refresh remaining time
  useEffect(() => {
    // Initial loading
    setTemporaryDirs(getActiveTemporaryDirectoriesWithExpiry());

    // Set timer to update every second
    const timer = setInterval(() => {
      setTemporaryDirs(getActiveTemporaryDirectoriesWithExpiry());
      setRefreshTimer((prev) => prev + 1);
    }, 1000);

    // Clean up timer when component unmounts
    return () => clearInterval(timer);
  }, []);

  // Format title (clipboard placeholder won't resolve here)
  const rawTitle = prompt.title || "";
  // Merge prompt properties with standard replacements for title formatting
  const mergedForTitle = {
    ...prompt, // Include prompt properties
    ...replacements, // Include standard replacements (input, selection, etc.)
    now: new Date().toLocaleString(), // Ensure 'now' is available
  };
  // Apply placeholder formatting to the title
  const formattedTitleWithPlaceholders = placeholderFormatter(
    rawTitle,
    mergedForTitle, // Pass the merged object
    promptSpecificRootDir,
    { resolveFile: false },
  );

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
  let displayIcon: string | Image.Asset = prompt.icon ?? "";

  if (prompt.identifier === "manage-temporary-directory") {
    if (temporaryDirs.length > 0) {
      displayTitle = `Manage temporary directory (${temporaryDirs.length})`;
      displayIcon = Icon.Folder;
    } else {
      displayTitle = "Add temporary directory";
      displayIcon = Icon.Plus;
    }
  }

  // Memoize placeholder icons
  const placeholderIcons = useMemo(
    () => getPlaceholderIcons(prompt.content, replacements),
    [prompt.content, replacements],
  );

  // Memoize prompt actions
  const promptActions = useMemo(() => {
    if (prompt.identifier === "manage-temporary-directory") {
      const handleAdd = async () => {
        try {
          const selectedItems = await getSelectedFinderItems();
          if (selectedItems.length === 0) {
            await showToast({
              title: "Error",
              message: "Please select a directory in Finder",
              style: Toast.Style.Failure,
            });
            return;
          }

          const selectedPath = selectedItems[0].path;
          const stats = fs.statSync(selectedPath);
          if (!stats.isDirectory()) {
            await showToast({
              title: "Error",
              message: "Please select a directory instead of a file",
              style: Toast.Style.Failure,
            });
            return;
          }

          addTemporaryDirectory(selectedPath);
          promptManager.reloadPrompts();
          onRefreshNeeded();
        } catch (error) {
          console.error("Failed to add temporary directory:", error);
          await showToast({
            title: "Error",
            message: `Failed to add temporary directory: ${error}`,
            style: Toast.Style.Failure,
          });
        }
      };

      if (temporaryDirs.length > 0) {
        const removeActions = temporaryDirs.map((dir) => (
          <Action
            key={dir.path}
            title={`Remove: ${path.basename(dir.path)}`}
            icon={Icon.Trash}
            onAction={() => {
              removeTemporaryDirectory(dir.path);
              promptManager.reloadPrompts();
              onRefreshNeeded();
            }}
          />
        ));

        return (
          <>
            <Action title="Add Temporary Directory" icon={Icon.Plus} onAction={handleAdd} />
            {removeActions}
            {temporaryDirs.length > 1 && (
              <Action
                title="Remove All Temporary Directories"
                icon={Icon.Trash}
                style={Action.Style.Destructive}
                onAction={() => {
                  removeAllTemporaryDirectories();
                  promptManager.reloadPrompts();
                  onRefreshNeeded();
                }}
              />
            )}
          </>
        );
      } else {
        return <Action title="Add Selected Directory" icon={Icon.Plus} onAction={handleAdd} />;
      }
    } else if (prompt.identifier === "open-custom-prompts-dir") {
      return handleCustomPromptsDirectoryActions();
    } else if (prompt.identifier === "open-scripts-dir") {
      return (
        <Action
          title="Open"
          icon={Icon.Folder}
          onAction={async () => {
            const preferences = getPreferenceValues();
            if (preferences.scriptsDirectory) {
              await runAppleScript(`do shell script "open -a Cursor '${preferences.scriptsDirectory}'"`);
              await closeMainWindow();
            } else {
              await showToast({
                title: "Error",
                message: "Scripts directory not configured",
                style: Toast.Style.Failure,
              });
            }
          }}
        />
      );
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
      // Action for folder prompts
      return (
        <Action.Push
          title="Open"
          icon={prompt.icon ?? "🔖"}
          target={
            <PromptList
              prompts={prompt.subprompts}
              // Provide default empty strings for potentially undefined replacements
              selectionText={replacements.selection ?? ""}
              currentApp={replacements.currentApp ?? ""}
              browserContent={replacements.browserContent ?? ""}
              allowedActions={allowedActions || prompt.actions}
              initialScripts={scripts}
            />
          }
        />
      );
    } else {
      // Default actions for regular prompts
      const optionKeys = findOptionPlaceholders(prompt);
      if (optionKeys.length > 0) {
        // Action for prompts with option placeholders (needs options form)
        return (
          <Action.Push
            title="Configure Options"
            icon={Icon.Gear}
            target={
              <PromptOptionsForm
                prompt={prompt}
                optionKeys={optionKeys}
                baseReplacements={replacements}
                scripts={scripts}
              />
            }
          />
        );
      } else if (prompt.options && Object.keys(prompt.options).length > 0) {
        // Action for prompts defined with options object (needs options form)
        return (
          <Action.Push
            title="Configure Options"
            icon={Icon.Gear}
            target={<PromptOptionsForm prompt={prompt} baseReplacements={replacements} scripts={scripts} />}
          />
        );
      } else {
        // Generate standard actions
        // Wrap the result in a fragment
        const generated = generatePromptActions(
          prompt,
          replacements,
          promptSpecificRootDir,
          allowedActions || prompt.actions,
          scripts,
        );
        // Ensure generated is always an array before wrapping in ActionPanel
        // If generatePromptActions can return a single element, handle that case.
        // Assuming it always returns an array or null/undefined based on previous structure:
        return generated ? <>{generated}</> : null;
      }
    }
  }, [
    prompt,
    replacements,
    promptSpecificRootDir,
    allowedActions,
    scripts,
    onRefreshNeeded,
    temporaryDirs,
    refreshTimer,
  ]);

  // Create accessories to display remaining time
  const getAccessories = () => {
    if (prompt.identifier === "manage-temporary-directory" && temporaryDirs.length > 0) {
      return temporaryDirs.map((dir) => ({
        tag: {
          value: `${path.basename(dir.path)}: ${dir.remainingText}`,
          color: dir.remainingMs < 3600000 ? Color.Red : Color.SecondaryText, // Less than 1 hour shows red
        },
      }));
    }

    if (prompt.identifier === "manage-temporary-directory") {
      return [];
    }

    return [
      prompt.pinned ? { tag: { value: "PIN", color: Color.SecondaryText } } : {},
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
          {prompt.identifier !== "manage-temporary-directory" && (
            <>
              <Action
                title={prompt.pinned ? "Unpin" : "Pin"}
                icon={Icon.Pin}
                onAction={() => onPinToggle(prompt)}
                shortcut={{ modifiers: ["cmd", "shift"], key: "p" }}
              />
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
                    filePath: prompt.filePath,
                  }),
                )}`}
                icon={Icon.Link}
              />
              {prompt.filePath && (
                <Action
                  title="Edit with Cursor"
                  icon={Icon.Code}
                  onAction={async () => {
                    if (!prompt.filePath) return;
                    await Clipboard.copy(prompt.title);
                    const configDir = path.dirname(prompt.filePath);
                    await runAppleScript(`do shell script "open -a Cursor '${configDir}' '${prompt.filePath}'"`);
                    await closeMainWindow();
                    await showToast({
                      title: "Copied title",
                      message: prompt.title,
                      style: Toast.Style.Success,
                    });
                  }}
                />
              )}
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
