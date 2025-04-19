import React, { useState, useEffect, useCallback, useRef } from "react";
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
import { AIService } from "../services/AIService";
import { ChatOptions, AIProvider } from "../services/types";
import { ScriptInfo } from "../utils/scriptUtils";

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

interface ChatViewProps {
  getFormattedDescription: () => string;
  options?: ChatOptions;
  providerName?: string;
  systemPrompt?: string;
}

function ChatResponseView({ getFormattedDescription, options, providerName, systemPrompt }: ChatViewProps) {
  const [response, setResponse] = useState<string>('');
  const [duration, setDuration] = useState<string>();
  const [isStreaming, setIsStreaming] = useState(false);
  const [model, setModel] = useState<string>();
  const startTimeRef = useRef<number>(0);
  const contentRef = useRef<string>('');

  // For throttling updates
  const updatingRef = useRef<boolean>(false);
  const updateTimerRef = useRef<NodeJS.Timeout | null>(null);

  const scheduleUpdate = useCallback(() => {
    if (!updatingRef.current) {
      // Mark as updating, will be cleared later
      updatingRef.current = true;
      updateTimerRef.current = setTimeout(() => {
        // Update state periodically
        setResponse(contentRef.current);
        const currentDuration = ((Date.now() - startTimeRef.current) / 1000).toFixed(1);
        setDuration(currentDuration);
        updatingRef.current = false;
      }, 500); // Update UI every 500ms, can be adjusted as needed
    }
  }, []);

  useEffect(() => {
    let toast: Toast;
    let isMounted = true;

    async function fetchResponse() {
      try {
        const description = getFormattedDescription();
        startTimeRef.current = Date.now();
        setIsStreaming(true);
        setResponse('');
        contentRef.current = '';

        toast = await showToast(Toast.Style.Animated, "Thinking...");

        const aiService = AIService.getInstance();
        if (providerName) {
          aiService.setCurrentProvider(providerName);
        }

        // Use streaming callback, but don't directly setState in the callback
        const result = await aiService.chat(
          description,
          {
            ...options,
            systemPrompt: systemPrompt || options?.systemPrompt,
            onStream: (text: string) => {
              if (!isMounted) return;
              // Only append new data to contentRef
              contentRef.current += text;
              // Use batch updates to reduce frequent UI updates
              scheduleUpdate();
            }
          }
        );

        if (!isMounted) {
          return;
        }

        // Set model information
        setModel(result.model);

        const endTime = Date.now();
        const durationSeconds = ((endTime - startTimeRef.current) / 1000).toFixed(1);
        setDuration(durationSeconds);
        setIsStreaming(false);

        // Ensure a final update after the stream ends (some streams may not be fully updated during timer intervals)
        setResponse(contentRef.current);

        if (toast) {
          toast.style = Toast.Style.Success;
          toast.title = `Done (${durationSeconds}s)`;
        }
      } catch (error) {
        if (!isMounted) return;
        console.error("[ChatResponseView] Error during fetchResponse:", error);
        setIsStreaming(false);
        await showToast(Toast.Style.Failure, "Error", String(error));
      }
    }

    fetchResponse();

    return () => {
      isMounted = false;
      if (toast) {
        toast.hide();
      }
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
      }
    };
  }, [getFormattedDescription, options, providerName, systemPrompt, scheduleUpdate]);

  return (
    <ChatResultView
      response={response}
      duration={duration || ''}
      isLoading={isStreaming}
      model={model}
    />
  );
}

export function generatePromptActions(
  getFormattedDescription: () => string,
  actions: string[] | undefined,
  scripts: ScriptInfo[],
  aiProviders: AIProvider[]
) {
  const preferences = getPreferenceValues<Preferences>();
  // Combine actions from prompt definition and global preferences
  const configuredActions =
    preferences.primaryAction?.split(",").map((action) => action.trim()).filter(Boolean) || [];

  const promptDefinedActions = actions || [];
  // Use Set to ensure uniqueness and maintain order (prompt actions first, then global)
  const finalActions = Array.from(new Set([...promptDefinedActions, ...configuredActions]));

  const createRaycastOpenInBrowser = (
    title: string | undefined,
    url: string,
    getFormattedDescription: () => string | number | Clipboard.Content
  ): ActionWithPossibleProps => (
    <Action.OpenInBrowser
      title={title}
      url={url}
      onOpen={() => Clipboard.copy(getFormattedDescription())}
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
          const description = getFormattedDescription();
          await Clipboard.copy(description);
          try {
            closeMainWindow();
            const scriptContent = fs.readFileSync(scriptPath, "utf8");
            await runAppleScript(scriptContent, scriptName.endsWith("ChatGPT") ? [description] : []);
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
          target={<ChatResponseView getFormattedDescription={getFormattedDescription} providerName={provider.name} />}
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
        preferences.openURL ?? "",
        getFormattedDescription
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
          onAction={() => {
            closeMainWindow();
            Clipboard.copy(getFormattedDescription());
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
          onAction={() => {
            closeMainWindow();
            const description = getFormattedDescription();
            Clipboard.copy(description);
            Clipboard.paste(description);
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
    const handleAction = () => {
      if (defaultAction.props.onAction && typeof defaultAction.props.onAction === 'function') {
        defaultAction.props.onAction();
      }
    };
    // Add the prioritized default action first
    resultActions.push(React.cloneElement(defaultAction, {
      key: defaultActionItem.name, // Use name as key
      title: `${defaultActionItem.displayName}`,
      onAction: handleAction,
    }));
    // Add other actions, excluding the default one
    resultActions = resultActions.concat(
      eligibleActions // Use eligibleActions here
        .filter((item) => item.name !== defaultActionItem?.name)
        .map((item) => React.cloneElement(item.action, { key: item.name, title: `${item.displayName}` }))
    );
  } else {
    // If no default action, just use the sorted eligible list
    const stripRunPrefix = (name: string) => name.replace(/^Run /, "");
    resultActions = eligibleActions.map((item) => { // Use eligibleActions here
      const originalAction = item.action;
      const originalTitle = originalAction.props.title || item.displayName;
      const newTitle = stripRunPrefix(originalTitle);
      // Ensure correct key prop for list rendering
      return React.cloneElement(originalAction, { key: item.name, title: newTitle });
    });
  }

  return resultActions; // Return the array of React elements
}