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
import { ChatOptions } from "../services/types";
import { getAvailableScripts } from "../utils/scriptUtils";

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

        if (!isMounted) return;

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
        console.error(error);
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
  actions?: string[],
) {
  const preferences = getPreferenceValues<Preferences>();
  const configuredActions =
    preferences.primaryAction?.split(",").map((action) => action.trim()) || [];
  const finalActions = [...(actions || []), ...configuredActions];

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

  const scriptActions: ActionItem[] = [];
  if (preferences.scriptsDirectory) {
    try {
      // Use utility function to get all available scripts
      const scripts = getAvailableScripts(preferences.scriptsDirectory);

      // Create an Action for each script
      scripts.forEach(({ path: scriptPath, name: scriptName }) => {
        scriptActions.push({
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
        });
      });
    } catch (error) {
      console.error("Failed to read scripts directory:", error);
    }
  }

  const actionItems: ActionItem[] = [
    ...scriptActions,
    ...(() => {
      const aiService = AIService.getInstance();
      return aiService.getProviderNames().map(providerName => {
        const displayName = `${providerName}`;
        return {
          name: providerName.toLowerCase(),
          displayName,
          condition: true,
          action: (
            <Action.Push
              title={displayName}
              icon={Icon.Network}
              target={<ChatResponseView getFormattedDescription={getFormattedDescription} providerName={providerName} />}
            />
          ),
        } as ActionItem;
      });
    })(),
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

  const filteredActions = actionItems.filter(
    (option) => option.condition && option.action
  );


  const lastSelectedAction = defaultActionPreferenceStore.getDefaultActionPreference();
  filteredActions.sort((a, b) => {
    const stripRunPrefix = (name: string) => name.replace(/^Run /, "");

    // Prioritize recently selected actions
    if (a.name === lastSelectedAction && b.name !== lastSelectedAction) return -1;
    if (b.name === lastSelectedAction && a.name !== lastSelectedAction) return 1;

    const indexA = finalActions.indexOf(stripRunPrefix(a.displayName));
    const indexB = finalActions.indexOf(stripRunPrefix(b.displayName));

    if (indexA !== -1 && indexB !== -1) {
      return indexA - indexB;
    }

    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;

    // Check if the action has a shortcut
    // Access props safely after updating the type
    const hasShortcutA = Boolean(a.action.props.shortcut);
    const hasShortcutB = Boolean(b.action.props.shortcut);

    // Only consider lastSelectedAction if both actions don't have shortcuts
    if (!hasShortcutA && !hasShortcutB) {
      if (a.name === lastSelectedAction) return -1;
      if (b.name === lastSelectedAction) return 1;
    }

    return a.displayName.localeCompare(b.displayName); // Add alphabetical order as final fallback sorting
  });

  return (
    <>
      {filteredActions.map((option, index) => {
        // Define handleAction using the props from the typed element
        const handleAction = () => {
          if (option.action.props.onAction) {
            option.action.props.onAction();
          }
        };

        // Clone the element, the types should now match
        return React.cloneElement(option.action, {
          key: option.name || index,
          onAction: handleAction, // Pass the new handler
        });
      })}
    </>
  );
}