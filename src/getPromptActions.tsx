import React from "react";
import {
  Action,
  Clipboard,
  Icon,
  closeMainWindow,
  getPreferenceValues,
} from "@raycast/api";
import { runAppleScript } from "@raycast/utils";
import fs from "fs";
import path from "path";
import lastActionStore from "./lastActionStore";

interface Preferences {
  openURL?: string;
  primaryAction: string;
  secondaryAction: string;
  runScript1?: string;
  runScript2?: string;
  runScript3?: string;
  runScript4?: string;
  runScript5?: string;
  runScript6?: string;
  runScript7?: string;
  runScript8?: string;
  runScript9?: string;
}

interface ActionItem {
  name: string;
  displayName: string;
  condition: boolean | undefined;
  action: React.ReactElement;
}

export function getPromptActions(
  getFormattedDescription: () => string,
  actions?: string[]
): React.ReactNode[] {
  const preferences = getPreferenceValues<Preferences>();

  const createOpenInBrowserAction = (
    title: string | undefined,
    url: string,
    description: () => string
  ) => (
    <Action.OpenInBrowser
      title={title}
      url={url}
      onOpen={() => Clipboard.copy(description())}
    />
  );

  const scriptPaths = [
    path.join(__dirname, "assets/ChatGPT.applescript"),
    preferences.runScript1,
    preferences.runScript2,
    preferences.runScript3,
    preferences.runScript4,
    preferences.runScript5,
    preferences.runScript6,
    preferences.runScript7,
    preferences.runScript8,
    preferences.runScript9,
  ];

  const actionItems: ActionItem[] = [
    {
      name: "openURL",
      displayName: "Open URL",
      condition: !!preferences.openURL,
      action: createOpenInBrowserAction(
        "Open URL",
        preferences.openURL || "",
        getFormattedDescription
      ),
    },
    ...scriptPaths.map((script, index) => ({
      name: `runScript${index + 1}`,
      displayName: `Run ${path.basename(script || "", path.extname(script || ""))}`,
      condition: !!script,
      action: (
        <Action
          title={`Run ${path.basename(script || "", path.extname(script || ""))}`}
          icon={Icon.Terminal}
          onAction={() => {
            closeMainWindow();
            Clipboard.copy(getFormattedDescription());
            if (script) {
              const scriptContent = fs.readFileSync(script, "utf8");
              runAppleScript(scriptContent);
            }
          }}
        />
      ),
    })),
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

  // 筛选并排序操作项
  const sortedActions = actionItems
    .filter(item => item.condition && item.action)
    .sort((a, b) => {
      const lastAction = lastActionStore.getLastAction();
      if (actions && actions.includes(a.displayName)) return -1;
      if (actions && actions.includes(b.displayName)) return 1;
      if (a.name === preferences.primaryAction) return -1;
      if (b.name === preferences.primaryAction) return 1;
      if (a.name === lastAction) return -1;
      if (b.name === lastAction) return 1;
      if (a.name === preferences.secondaryAction && b.name !== preferences.primaryAction) return -1;
      if (b.name === preferences.secondaryAction && a.name !== preferences.primaryAction) return 1;
      return 0;
    })
    .map((item, index) =>
      React.cloneElement(item.action, {
        key: index,
        onAction: () => {
          lastActionStore.setLastAction(item.name);
          const originalOnAction = item.action.props.onAction;
          if (originalOnAction) {
            originalOnAction();
          }
        },
      })
    )
    .filter(Boolean);

  return sortedActions;
}