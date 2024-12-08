import React, { useState, useEffect } from "react";
import {
  Action,
  Clipboard,
  Icon,
  Toast,
  closeMainWindow,
  getPreferenceValues,
  showToast,
} from "@raycast/api";
import { runAppleScript } from "@raycast/utils";
import fs from "fs";
import path from "path";
import lastActionStore from "./lastActionStore";
import { chat } from "./cerebras";
import { ResultView } from "./components/ResultView";

interface Preferences {
  openURL?: string;
  primaryAction: string;
  scriptsDirectory?: string;
}

interface ActionItem {
  name: string;
  displayName: string;
  condition: boolean;
  action: React.ReactElement;
}

interface PromptProps {
  filePath?: string;
}

export function getPromptActions(
  getFormattedDescription: () => string,
  actions?: string[],
  prompt?: PromptProps
) {
  const preferences = getPreferenceValues<Preferences>();

  const configuredActions =
    preferences.primaryAction?.split(",").map((action) => action.trim()) || [];
  const finalActions = [...(actions || []), ...configuredActions];
  const createRaycastOpenInBrowser = (
    title: string | undefined,
    url: string,
    getFormattedDescription: () => string | number | Clipboard.Content
  ) => (
    <Action.OpenInBrowser
      title={title}
      url={url}
      onOpen={() => Clipboard.copy(getFormattedDescription())}
    />
  );

  const scriptActions: ActionItem[] = [];
  if (preferences.scriptsDirectory) {
    try {
      const scriptsDir = preferences.scriptsDirectory;
      const scripts = fs
        .readdirSync(scriptsDir)
        .filter(
          (file) => file.endsWith(".applescript") || file.endsWith(".scpt")
        )
        .map((file) => path.join(scriptsDir, file));

      scripts.forEach((script) => {
        const scriptName = path.basename(script, path.extname(script));
        scriptActions.push({
          name: `script_${scriptName}`,
          displayName: scriptName,
          condition: true,
          action: (
            <Action
              title={`Run ${scriptName}`}
              icon={Icon.Terminal}
              onAction={async () => {
                const description = getFormattedDescription();
                await Clipboard.copy(description);

                try {
                  closeMainWindow();
                  const scriptContent = fs.readFileSync(script, "utf8");
                  await runAppleScript(scriptContent);
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
    {
      name: "chatgpt",
      displayName: "ChatGPT",
      condition: true,
      action: (
        <Action
          // eslint-disable-next-line @raycast/prefer-title-case
          title="ChatGPT"
          icon={Icon.Message}
          onAction={async () => {
            const description = getFormattedDescription();
            await Clipboard.copy(description);
            
            try {
              closeMainWindow();
              const scriptPath = path.join(__dirname, "assets/ChatGPT.applescript");
              const scriptContent = fs.readFileSync(scriptPath, "utf8");
              await runAppleScript(scriptContent, [description]);
            } catch (error) {
              console.error(`Failed to execute ChatGPT script: ${error}`);
              await showToast(Toast.Style.Failure, "Error", String(error));
            }
          }}
        />
      ),
    },
    ...scriptActions,
    {
      name: "cerebras",
      displayName: "Call Cerebras",
      condition: true,
      action: (
        <Action.Push
          title="Call Cerebras"
          icon={Icon.AddPerson}
          target={<CerebrasView getFormattedDescription={getFormattedDescription} />}
        />
      ),
    },
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
    {
      name: "editInVSCode",
      displayName: "Edit in VSCode",
      condition: Boolean(prompt?.filePath),
      action: (
        <Action
          // eslint-disable-next-line @raycast/prefer-title-case
          title="Edit in VSCode"
          icon={Icon.Code}
          shortcut={{ modifiers: ["cmd", "shift"], key: "e" }}
          onAction={async () => {
            try {
              if (!prompt?.filePath) {
                await showToast(Toast.Style.Failure, "Error", "File path not found");
                return;
              }
              
              closeMainWindow();
              await runAppleScript(`
                tell application "Visual Studio Code"
                  activate
                  open POSIX file "${prompt.filePath}"
                end tell
              `);
            } catch (error) {
              console.error("Failed to open VSCode:", error);
              await showToast(Toast.Style.Failure, "Error", String(error));
            }
          }}
        />
      ),
    },
  ];

  // Filter and sort actions
  const filteredActions = actionItems.filter(
    (option) => option.condition && option.action
  );

  filteredActions.sort((a, b) => {
    const lastSelectedAction = lastActionStore.getLastAction();
    const stripRunPrefix = (name: string) => name.replace(/^Run /, "");
    
    const indexA = finalActions.indexOf(stripRunPrefix(a.displayName));
    const indexB = finalActions.indexOf(stripRunPrefix(b.displayName));
    
    if (indexA !== -1 && indexB !== -1) {
      return indexA - indexB;
    }
    
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;
    
    if (a.name === lastSelectedAction) return -1;
    if (b.name === lastSelectedAction) return 1;
    return 0;
  });

  return (
    <>
      {filteredActions.map((option, index) => {
        const handleAction = () => {
          lastActionStore.setLastAction(option.name);
          if (option.action.props.onAction) {
            option.action.props.onAction();
          }
        };

        return React.cloneElement(option.action, {
          key: option.name || index,
          onAction: handleAction,
        });
      })}
    </>
  );
}

function CerebrasView({ getFormattedDescription }: { getFormattedDescription: () => string }) {
  const [response, setResponse] = useState<string>();
  const [duration, setDuration] = useState<string>();

  useEffect(() => {
    async function fetchResponse() {
      try {
        const description = getFormattedDescription();
        const startTime = Date.now();
        const toast = await showToast(Toast.Style.Animated, "Thinking...");
        const result = await chat(description);
        const endTime = Date.now();
        setDuration(((endTime - startTime) / 1000).toFixed(1));
        setResponse(result);
        
        toast.style = Toast.Style.Success;
        toast.title = `Done (${duration}s)`;
      } catch (error) {
        console.error(error);
        await showToast(Toast.Style.Failure, "Error", String(error));
      }
    }
    fetchResponse();
  }, []);

  return (
    <ResultView 
      response={response || ''}
      duration={duration || ''}
      isLoading={!response}
    />
  );
}
