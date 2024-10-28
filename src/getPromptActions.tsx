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

export function getPromptActions(getFormattedDescription: () => string, actions?: string[]) {
  const preferences = getPreferenceValues<Preferences>();

  // 从 preferences.primaryAction 中解析出用户配置的操作顺序
  const configuredActions = preferences.primaryAction?.split(',').map(action => action.trim()) || [];

  // 合并传入的 actions 和配置的 actions
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

  const action = [
    {
      name: "openURL",
      displayName: "Open URL",
      condition: preferences.openURL,
      action: createRaycastOpenInBrowser("Open URL", preferences.openURL ?? "", getFormattedDescription),
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
            }
          }}
        />
      ),
    },
    {
      name: "runScripts",
      displayName: "Run Scripts", 
      condition: preferences.scriptsDirectory,
      action: (() => {
        const scriptsDir = preferences.scriptsDirectory;
        if (!scriptsDir) {
          return null;
        }

        let scripts;
        try {
          scripts = fs.readdirSync(scriptsDir)
            .filter(file => file.endsWith('.applescript') || file.endsWith('.scpt'))
            .map(file => path.join(scriptsDir, file));
        } catch (error) {
          return null;
        }
        
        return scripts.map((script, index) => {
          const scriptName = path.basename(script, path.extname(script));
          return (
            <Action
              key={`runScript${index}`}
              title={`Run ${scriptName}`}
              icon={Icon.Terminal}
              onAction={() => {
                closeMainWindow();
                const description = getFormattedDescription();
                Clipboard.copy(description);
                
                try {
                  const scriptContent = fs.readFileSync(script, "utf8");
                  runAppleScript(scriptContent);
                } catch (error) {
                  console.error(`执行脚本失败: ${error}`);
                }
              }}
            />
          );
        });
      })()
    },
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
          if (finalActions && finalActions.includes(stripRunPrefix(a.displayName))) return -1;
          if (finalActions && finalActions.includes(stripRunPrefix(b.displayName))) return 1;
          if (a.name === lastSelectedAction) return -1;
          if (b.name === lastSelectedAction) return 1;
          return 0;
        })
        .map((option, index) =>
          option.condition && option.action ? (
            Array.isArray(option.action) ? 
              option.action.map((action, i) => 
                React.cloneElement(action, {
                  key: `${index}-${i}`,
                  onAction: () => {
                    lastActionStore.setLastAction(option.name);
                    if (action.props.onAction) {
                      action.props.onAction();
                    }
                  }
                })
              )
            : React.cloneElement(option.action as React.ReactElement, {
                key: index,
                onAction: () => {
                  lastActionStore.setLastAction(option.name);
                  if ((option.action as React.ReactElement).props.onAction) {
                    (option.action as React.ReactElement).props.onAction();
                  }
                }
              })
          ) : null
        )
        .filter(Boolean)
      }
    </>
  );
}
