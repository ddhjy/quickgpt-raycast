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
import actionManager from "./actionManager";

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

export function getPromptActions(formattedDescription: string, actions?: string[]) {
  const preferences = getPreferenceValues<Preferences>();
  const createRaycastOpenInBrowser = (
    title: string | undefined,
    url: string,
    formattedDescription: string | number | Clipboard.Content
  ) => <Action.OpenInBrowser title={title} url={url} onOpen={() => Clipboard.copy(formattedDescription)} />;

  const action = [
    {
      name: "openURL",
      displayName: "Open URL",
      condition: preferences.openURL,
      action: createRaycastOpenInBrowser("Open URL", preferences.openURL ?? "", formattedDescription),
    },
    ...[
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
    ].map((script, index) => {
      return {
        name: `runScript${index}`,
        displayName: `Run ${path.basename(script ?? "", path.extname(script ?? ""))}`,
        condition: script,
        action: (
          <Action
            title={`Run ${path.basename(script ?? "", path.extname(script ?? ""))}`}
            key={`runScript${index + 1}`}
            icon={Icon.Terminal}
            onAction={() => {
              closeMainWindow();
              Clipboard.copy(formattedDescription);
              const myScript = fs.readFileSync(script ?? "", "utf8");
              runAppleScript(myScript);
            }}
          />
        ),
      };
    }),
    {
      name: "copyToClipboard",
      condition: true,
      displayName: "Copy",
      action: (
        <Action.CopyToClipboard
          title="Copy"
          content={formattedDescription}
          shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
        />
      ),
    },
    {
      name: "paste",
      condition: true,
      displayName: "Paste",
      action: (
        <Action
          title="Paste"
          icon={Icon.Document}
          onAction={() => {
            closeMainWindow();
            Clipboard.paste(formattedDescription);
          }}
        />
      ),
    },
  ];

  return (
    <>
      {action
        .sort((a, b) => {
          const lastSelectedAction = actionManager.getLastSelectedAction();
          console.log("zkdebug actions", actions, a.name, b.name);
          if (actions && actions.includes(a.displayName)) return -1;
          if (actions && actions.includes(b.displayName)) return 1;
          if (a.name === preferences.primaryAction) return -1;
          if (b.name === preferences.primaryAction) return 1;
          if (a.name === lastSelectedAction) return -1;
          if (b.name === lastSelectedAction) return 1;
          if (a.name === preferences.secondaryAction && b.name !== preferences.primaryAction) return -1;
          if (b.name === preferences.secondaryAction && a.name !== preferences.primaryAction) return 1;
          return 0;
        })
        .map((option, index) =>
          option.condition && option.action ? React.cloneElement(option.action, {
            key: index,
            onAction: () => {
              actionManager.setLastSelectedAction(option.name)
              if (option.action.props.onAction) {
                option.action.props.onAction();
              }
            }
          }) : null
        )
        .filter(Boolean)
      }
    </>
  );
}