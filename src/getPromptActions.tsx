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
import { chat } from "./cerebras";
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

export function getPromptActions(getFormattedDescription: () => string, actions?: string[]) {
  const preferences = getPreferenceValues<Preferences>();
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

  const action = [
    {
      name: "openURL",
      displayName: "Open URL",
      condition: preferences.openURL,
      action: createRaycastOpenInBrowser("Open URL", preferences.openURL ?? "", getFormattedDescription),
    },
    {
      name: "cerebras",
      displayName: "Ask Cerebras",
      condition: true,
      action: (
        <Action
          title="Ask Cerebras"
          icon={Icon.AddPerson}
          onAction={async () => {
            closeMainWindow();
            const description = getFormattedDescription();
            try {
              const response = await chat(description);
              await Clipboard.copy(response);
              // await Clipboard.paste(response);
            } catch (error) {
              console.error("Cerebras API 调用失败:", error);
            }
          }}
        />
      ),
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
              Clipboard.copy(getFormattedDescription());
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
      condition: true,
      displayName: "Paste",
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

  return (
    <>
      {action
        .sort((a, b) => {
          const lastSelectedAction = lastActionStore.getLastAction();
          const stripRunPrefix = (name: string) => name.replace(/^Run /, '');
          if (actions && actions.includes(stripRunPrefix(a.displayName))) return -1;
          if (actions && actions.includes(stripRunPrefix(b.displayName))) return 1;
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
              lastActionStore.setLastAction(option.name)
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
