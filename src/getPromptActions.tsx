import React from "react";
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

export function getPromptActions(
  getFormattedDescription: () => string,
  actions?: string[]
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

  const actionItems: ActionItem[] = [
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
      name: "cerebras",
      displayName: "Call Cerebras",
      condition: true,
      action: (
        <Action
          title="Call Cerebras"
          icon={Icon.AddPerson}
          onAction={async () => {
            const description = getFormattedDescription();
            try {
              const startTime = Date.now();
              const toast = await showToast(Toast.Style.Animated, "Thinking...");
              const response = await chat(description);
              const endTime = Date.now();
              const duration = ((endTime - startTime) / 1000).toFixed(1);
              await Clipboard.copy(response);
              await Clipboard.paste(response);
              toast.style = Toast.Style.Success;
              toast.title = `Done (${duration}s)`;
              await showToast(toast);
              closeMainWindow();
            } catch (error) {
              console.error(error);
              await showToast(Toast.Style.Failure, "Error", String(error));
            }
          }}
        />
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

  // Load scripts and create script actions
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
        actionItems.push({
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
