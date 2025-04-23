import React from "react";
import {
  getPreferenceValues,
  Action,
  Icon,
  Clipboard,
  Toast,
  closeMainWindow,
  showToast,
} from "@raycast/api";
import { runAppleScript } from "@raycast/utils";
import fs from "fs";
import defaultActionPreferenceStore from "../stores/DefaultActionPreferenceStore";
import { ChatResultView } from "./ResultView";
import { ChatOptions, AIProvider } from "../services/types";
import { ScriptInfo } from "../utils/scriptUtils";
import { PromptProps } from "../managers/PromptManager";
import { SpecificReplacements } from "../utils/placeholderFormatter";
import { buildFormattedPromptContent, getIndentedPromptTitles } from "../utils/promptFormattingUtils";

interface Preferences {
  openURL?: string;
  primaryAction: string;
  scriptsDirectory?: string;
}

// Define a more specific type for Action props we might access
// Adjust this based on the actual props you need to access (shortcut, onAction, etc.)
// Using Action.Props might be sufficient if all actions derive from it.
type ActionWithPossibleProps = React.ReactElement<Action.Props & { shortcut?: string; onAction?: () => void }>;

interface ActionItem {
  name: string;
  displayName: string;
  condition: boolean;
  action: ActionWithPossibleProps; // Use the more specific type
}

/**
 * Generates a sorted list of Raycast Action elements based on the prompt definition,
 * global preferences, available scripts, and AI providers.
 *
 * @param prompt The prompt object to generate actions for
 * @param baseReplacements Base replacements without clipboard
 * @param promptSpecificRootDir Root directory for file placeholder resolution
 * @param actions An optional array of action names specified in the prompt definition.
 * @param scripts An array of available script information.
 * @param aiProviders An array of available AI providers.
 * @param options Optional chat options for AI provider actions.
 * @param systemPrompt Optional system prompt for AI provider actions.
 * @returns An array of React elements representing the sorted Raycast Actions.
 */
export function generatePromptActions(
  prompt: PromptProps,
  baseReplacements: Omit<SpecificReplacements, 'clipboard'>,
  promptSpecificRootDir: string | undefined,
  actions: string[] | undefined,
  scripts: ScriptInfo[],
  aiProviders: AIProvider[],
  options?: ChatOptions,
  systemPrompt?: string
) {
  const preferences = getPreferenceValues<Preferences>();
  // Combine actions from prompt definition and global preferences
  const configuredActions =
    preferences.primaryAction?.split(",").map((action) => action.trim()).filter(Boolean) || [];

  const promptDefinedActions = actions || [];
  // Use Set to ensure uniqueness and maintain order (prompt actions first, then global)
  const finalActions = Array.from(new Set([...promptDefinedActions, ...configuredActions]));

  // Helper function to get final content with clipboard
  const getFinalContent = async (): Promise<string> => {
    const currentClipboard = await Clipboard.readText() ?? "";
    const finalReplacements: SpecificReplacements = {
      ...baseReplacements,
      clipboard: currentClipboard,
      now: new Date().toLocaleString(),
      promptTitles: getIndentedPromptTitles()
    };
    return buildFormattedPromptContent(prompt, finalReplacements, promptSpecificRootDir);
  };

  /**
   * Creates a configured Action.OpenInBrowser component.
   * Copies the formatted description to the clipboard when the URL is opened.
   *
   * @param title The title for the action.
   * @param url The URL to open.
   * @returns A React element for the Action.OpenInBrowser.
   */
  const createRaycastOpenInBrowser = (
    title: string | undefined,
    url: string
  ): ActionWithPossibleProps => (
    <Action.OpenInBrowser
      title={title}
      url={url}
      onOpen={async () => {
        const finalContent = await getFinalContent();
        await Clipboard.copy(finalContent);
      }}
    />
  );

  // Use the passed-in scripts directly
  const scriptActions: ActionItem[] = scripts.map(({ path: scriptPath, name: scriptName }) => ({
    name: `script_${scriptName}`,
    displayName: scriptName,
    condition: true,
    action: (
      <Action
        title={scriptName}
        icon={Icon.Terminal}
        onAction={async () => {
          try {
            const finalContent = await getFinalContent();
            await Clipboard.copy(finalContent);
            closeMainWindow();
            const scriptContent = fs.readFileSync(scriptPath, "utf8");
            await runAppleScript(scriptContent, scriptName.endsWith("ChatGPT") ? [finalContent] : []);
          } catch (error) {
            console.error(`Failed to execute script: ${error}`);
            await showToast(Toast.Style.Failure, "Error", String(error));
          }
        }}
      />
    ),
  }));

  // Use the passed-in aiProviders directly
  const providerActions: ActionItem[] = aiProviders.map(provider => {
    const displayName = `${provider.name}`;
    return {
      name: provider.name.toLowerCase(),
      displayName,
      condition: true,
      action: (
        <Action.Push
          title={displayName}
          icon={Icon.Network}
          target={
            <ChatResultView
              prompt={prompt}
              baseReplacements={baseReplacements}
              promptSpecificRootDir={promptSpecificRootDir}
              providerName={provider.name}
              options={options}
              systemPrompt={systemPrompt}
            />
          }
        />
      ),
    } as ActionItem;
  });

  // Define all possible base actions
  const baseActionItems: ActionItem[] = [
    {
      name: "openURL",
      displayName: "Open URL",
      condition: Boolean(preferences.openURL),
      action: createRaycastOpenInBrowser(
        "Open URL",
        preferences.openURL ?? ""
      ),
    },
    {
      name: "copyToClipboard",
      displayName: "Copy",
      condition: true,
      action: (
        <Action
          title="Copy"
          icon={Icon.Clipboard}
          shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
          onAction={async () => {
            closeMainWindow();
            const finalContent = await getFinalContent();
            Clipboard.copy(finalContent);
          }}
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
          onAction={async () => {
            closeMainWindow();
            const finalContent = await getFinalContent();
            await Clipboard.copy(finalContent);
            await Clipboard.paste(finalContent);
          }}
        />
      ),
    },
  ];

  // Combine all potential actions
  const allActionItems: ActionItem[] = [
    ...scriptActions,
    ...providerActions,
    ...baseActionItems
  ];

  // Filter actions based ONLY on their condition first
  const eligibleActions = allActionItems.filter((item) => item.condition);

  // Now, sort eligibleActions. Use finalActions for priority sorting.
  eligibleActions.sort((a, b) => {
    const getNameForSort = (name: string) => name.toLowerCase().replace(/^script_/, '');
    const nameA = getNameForSort(a.name);
    const nameB = getNameForSort(b.name);

    const indexA = finalActions.findIndex(name => name.toLowerCase() === nameA);
    const indexB = finalActions.findIndex(name => name.toLowerCase() === nameB);

    // Both are in finalActions: sort by their index in finalActions
    if (indexA !== -1 && indexB !== -1) {
      return indexA - indexB;
    }
    // Only A is in finalActions: A comes first
    if (indexA !== -1) {
      return -1;
    }
    // Only B is in finalActions: B comes first
    if (indexB !== -1) {
      return 1;
    }
    // Neither is in finalActions: sort alphabetically by display name
    return a.displayName.localeCompare(b.displayName);
  });

  // Find and prioritize the default action from the sorted eligible list
  const defaultActionPreference = defaultActionPreferenceStore.getDefaultActionPreference();
  let defaultActionItem: ActionItem | undefined;
  if (defaultActionPreference) {
    const preferenceBaseName = defaultActionPreference.replace(/^(script_|call\s+)/, '');
    // Find based on the eligible and sorted list
    defaultActionItem = eligibleActions.find((item) =>
      item.name.toLowerCase().replace(/^script_/, '') === preferenceBaseName.toLowerCase()
    );
  }

  // Prepare the final list of action elements based on the sorted eligible list
  let resultActions: React.ReactElement[] = [];

  if (defaultActionItem) {
    const defaultAction = defaultActionItem.action;
    // The original onAction from the definition above is already async
    const handleAction = defaultAction.props.onAction;
    resultActions.push(React.cloneElement(defaultAction, {
      key: defaultActionItem.name, // Use name as key
      title: `${defaultActionItem.displayName}`,
      onAction: handleAction, // Use the async handler directly
    }));
    // Add other actions, excluding the default one
    resultActions = resultActions.concat(
      eligibleActions // Use eligibleActions here
        .filter((item) => item.name !== defaultActionItem?.name)
        .map((item) => React.cloneElement(item.action, { key: item.name, title: `${item.displayName}` }))
    );
  } else {
    // If no default action, just use the sorted eligible list
    resultActions = eligibleActions.map((item) =>
      React.cloneElement(item.action, { key: item.name, title: `${item.displayName}` })
    );
  }

  return resultActions;
}