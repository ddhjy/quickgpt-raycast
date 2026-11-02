import React, { useMemo } from "react";
import { List, ActionPanel, Icon, Action, Color, Image, useNavigation } from "@raycast/api";
import type { PromptProps } from "../managers/prompt-manager";
import {
  createRemoveTempDirAction,
  editPromptInEditor,
  generatePromptActions,
  getEditActionTitle,
} from "./prompt-actions";
import { getPlaceholderIcons } from "../utils/prompt-formatting-utils";
import { findUsedOptionPlaceholders } from "../utils/option-placeholder-utils";
import { ScriptInfo } from "../utils/script-utils";
import { placeholderFormatter } from "../utils/placeholder-formatter";
import { PromptList, type PromptContext } from "./prompt-list";
import { PromptOptionsForm } from "./prompt-options-form";
import { InputHistoryList, showClipboardHistory } from "./history-actions";
import { resolveSettingsItem } from "./settings-items";

interface PromptListItemProps {
  prompt: PromptProps;
  replacements: PromptContext;
  searchMode?: boolean;
  promptSpecificRootDir?: string;
  allowedActions?: string[];
  onPinToggle: (prompt: PromptProps) => void;
  scripts: ScriptInfo[];
  onRefreshNeeded: () => void;
  setCurrentInput: (input: string) => void;
  currentPath?: string;
}

/**
 * In search results a prompt is shown with the folder it lives in, relative
 * to the folder being browsed: `Folder / Title`, or `Folder ... / Title` when
 * intermediate folders are left out.
 */
function withFolderPrefix(title: string, promptPath: string, currentPath: string): string {
  const pathComponents = promptPath.split(" / ");
  const currentPathComponents = currentPath.split(" / ").filter((component) => component);

  let sharedDepth = 0;
  while (
    sharedDepth < currentPathComponents.length &&
    sharedDepth < pathComponents.length &&
    pathComponents[sharedDepth] === currentPathComponents[sharedDepth]
  ) {
    sharedDepth++;
  }

  const relativeComponents = pathComponents.slice(sharedDepth);
  if (relativeComponents.length <= 1) {
    return title;
  }

  const prefix = relativeComponents[0] + (relativeComponents.length >= 3 ? " ..." : "");
  return `${prefix} / ${title}`;
}

export function PromptListItem({
  prompt,
  replacements,
  searchMode = false,
  promptSpecificRootDir,
  allowedActions,
  onPinToggle,
  scripts,
  onRefreshNeeded,
  setCurrentInput,
  currentPath = "",
}: PromptListItemProps) {
  const navigation = useNavigation();
  const settingsItem = resolveSettingsItem(prompt.identifier, onRefreshNeeded);
  const isSettingsItem = settingsItem !== undefined;

  const formattedTitle = placeholderFormatter(
    prompt.title || "",
    { ...prompt, ...replacements, now: new Date().toLocaleString() },
    promptSpecificRootDir,
    { resolveFile: false },
  );
  const displayTitle =
    settingsItem?.title ??
    (searchMode && prompt.path ? withFolderPrefix(formattedTitle, prompt.path, currentPath) : formattedTitle);
  const displayIcon: string | Image.Asset = settingsItem?.icon ?? prompt.icon ?? "🔖";

  const placeholderIcons = useMemo(
    () => getPlaceholderIcons(prompt.content, replacements),
    [prompt.content, replacements],
  );

  const promptActions = useMemo(() => {
    if (isSettingsItem) {
      return null;
    }

    if (prompt.subprompts) {
      // Typed input belongs to the list it was typed in; everything else carries into the folder.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { input, clipboard, ...folderContext } = replacements;

      return (
        <>
          <Action.Push
            title="Open"
            icon={prompt.icon ?? Icon.Folder}
            target={
              <PromptList
                prompts={prompt.subprompts}
                context={folderContext}
                allowedActions={allowedActions || prompt.actions}
                initialScripts={scripts}
                externalOnRefreshNeeded={onRefreshNeeded}
                currentPath={currentPath ? `${currentPath} / ${prompt.title}` : prompt.title}
              />
            }
          />
          <Action
            title={prompt.pinned ? "Unpin" : "Pin"}
            icon={Icon.Pin}
            onAction={() => onPinToggle(prompt)}
            shortcut={{ modifiers: ["cmd", "shift"], key: "p" }}
          />
          {prompt.filePath && (
            <Action
              title={getEditActionTitle()}
              shortcut={{ modifiers: ["cmd"], key: "e" }}
              icon={Icon.Pencil}
              onAction={() => editPromptInEditor(prompt)}
            />
          )}
          {prompt.isTemporary &&
            prompt.temporaryDirSource &&
            createRemoveTempDirAction(prompt.temporaryDirSource, navigation, onRefreshNeeded)}
        </>
      );
    }

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

    const optionKeys = findUsedOptionPlaceholders(prompt, replacements);
    const hasOptions = optionKeys.length > 0 || (prompt.options && Object.keys(prompt.options).length > 0);

    return (
      <>
        {hasOptions && (
          <Action.Push
            title="Configure Options"
            icon={Icon.Gear}
            target={
              <PromptOptionsForm
                prompt={prompt}
                optionKeys={optionKeys}
                baseReplacements={replacements}
                promptSpecificRootDir={promptSpecificRootDir}
                scripts={scripts}
              />
            }
          />
        )}
        {standardActions}
      </>
    );
  }, [
    prompt,
    replacements,
    promptSpecificRootDir,
    allowedActions,
    scripts,
    navigation,
    onRefreshNeeded,
    onPinToggle,
    currentPath,
    isSettingsItem,
  ]);

  const getAccessories = (): List.Item.Accessory[] => {
    if (settingsItem) {
      return settingsItem.directoryCount !== undefined ? [{ text: String(settingsItem.directoryCount) }] : [];
    }

    const tooltip = prompt.subprompts
      ? prompt.subprompts.map((subPrompt, subIndex) => `${subIndex + 1}. ${subPrompt.title}`).join("\n")
      : prompt.content;
    const contentAccessories: List.Item.Accessory[] =
      placeholderIcons.length > 0
        ? placeholderIcons.map((accessory, index) =>
            index === placeholderIcons.length - 1 ? { ...accessory, tooltip } : accessory,
          )
        : [{ icon: prompt.subprompts ? Icon.Folder : Icon.Paragraph, tooltip }];

    return [prompt.pinned ? { tag: { value: "PIN", color: Color.Blue } } : {}, ...contentAccessories];
  };

  return (
    <List.Item
      key={prompt.identifier || prompt.title}
      icon={displayIcon}
      title={displayTitle.replace(/\n/g, " ")}
      accessories={getAccessories()}
      actions={
        <ActionPanel>
          {settingsItem ? settingsItem.action : promptActions}
          {!searchMode && (
            <>
              <Action.Push
                title="Show Input History"
                icon={Icon.Clock}
                shortcut={{ modifiers: ["cmd"], key: "y" }}
                target={<InputHistoryList onSelect={setCurrentInput} />}
              />
              <Action
                title="Show Clipboard History"
                icon={Icon.CopyClipboard}
                shortcut={{ modifiers: ["cmd", "shift"], key: "y" }}
                onAction={() => showClipboardHistory(navigation)}
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

export const MemoizedPromptListItem = React.memo(PromptListItem);
