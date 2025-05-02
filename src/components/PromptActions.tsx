import React from "react";
import {
  getPreferenceValues,
  Action,
  Icon,
  Clipboard,
  Toast,
  closeMainWindow,
  showToast,
  open,
  environment,
} from "@raycast/api";
import { runAppleScript } from "@raycast/utils";
import fs from "fs";
import defaultActionPreferenceStore from "../stores/DefaultActionPreferenceStore";
import { ScriptInfo } from "../utils/scriptUtils";
import { PromptProps } from "../managers/PromptManager";
import { SpecificReplacements } from "../utils/placeholderFormatter";
import { buildFormattedPromptContent, getIndentedPromptTitles } from "../utils/promptFormattingUtils";
import {
  updateTemporaryDirectoryUsage,
  updateAnyTemporaryDirectoryUsage,
} from "../stores/TemporaryPromptDirectoryStore";

interface Preferences {
  openURL?: string;
  primaryAction: string;
  scriptsDirectory?: string;
  aiCallerExtensionTarget?: string;
  aiProviderNames?: string;
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
 * global preferences, and available scripts. AI actions now trigger a deeplink.
 *
 * @param prompt The prompt object to generate actions for
 * @param baseReplacements Base replacements without clipboard
 * @param promptSpecificRootDir Root directory for file placeholder resolution
 * @param actions An optional array of action names specified in the prompt definition.
 * @param scripts An array of available script information.
 * @returns An array of React elements representing the sorted Raycast Actions.
 */
export function generatePromptActions(
  prompt: PromptProps,
  baseReplacements: Omit<SpecificReplacements, "clipboard">,
  promptSpecificRootDir: string | undefined,
  actions: string[] | undefined,
  scripts: ScriptInfo[],
) {
  const preferences = getPreferenceValues<Preferences>();
  const configuredActions =
    preferences.primaryAction
      ?.split(",")
      .map((action) => action.trim())
      .filter(Boolean) || [];
  const promptDefinedActions = actions || [];
  const finalActions = Array.from(new Set([...promptDefinedActions, ...configuredActions]));

  const wrapActionHandler = (originalHandler: (() => Promise<void>) | undefined | (() => void)) => {
    return async () => {
      if (prompt.isTemporary) {
        if (prompt.temporaryDirSource) {
          updateTemporaryDirectoryUsage(prompt.temporaryDirSource);
        } else {
          updateAnyTemporaryDirectoryUsage();
        }
      }

      if (originalHandler) {
        if (originalHandler.constructor.name === "AsyncFunction") {
          await (originalHandler as () => Promise<void>)();
        } else {
          (originalHandler as () => void)();
        }
      }
    };
  };

  const getFinalContent = async (): Promise<string> => {
    const currentClipboard = (await Clipboard.readText()) ?? "";
    const finalReplacements: SpecificReplacements = {
      ...baseReplacements,
      clipboard: currentClipboard,
      now: new Date().toLocaleString(),
      promptTitles: getIndentedPromptTitles(),
    };
    return buildFormattedPromptContent(prompt, finalReplacements, promptSpecificRootDir);
  };

  const getSystemPrompt = (prompt: PromptProps): string | undefined => {
    return "systemPrompt" in prompt ? (prompt as { systemPrompt?: string }).systemPrompt : undefined;
  };

  const scriptActions: ActionItem[] = scripts.map(({ path: scriptPath, name: scriptName }) => ({
    name: `script_${scriptName}`,
    displayName: scriptName,
    condition: true,
    action: (
      <Action
        title={scriptName}
        icon={Icon.Terminal}
        onAction={wrapActionHandler(async () => {
          try {
            const finalContent = await getFinalContent();
            await Clipboard.copy(finalContent);
            await closeMainWindow({ clearRootSearch: true });
            const scriptContent = fs.readFileSync(scriptPath, "utf8");
            const args = scriptName.endsWith("ChatGPT") ? [finalContent] : [];
            await runAppleScript(scriptContent, args);
          } catch (error) {
            console.error(`Failed to execute script ${scriptName}:`, error);
            await showToast(Toast.Style.Failure, "Script Error", `Failed to run ${scriptName}: ${String(error)}`);
          }
        })}
      />
    ),
  }));

  const aiCallerActions: ActionItem[] = [];
  if (preferences.aiCallerExtensionTarget) {
    const target = preferences.aiCallerExtensionTarget.trim();
    const targetParts = target.split(".");

    if (targetParts.length === 3) {
      const [author, extensionName, commandName] = targetParts;
      const providerNames =
        preferences.aiProviderNames
          ?.split(",")
          .map((name) => name.trim())
          .filter(Boolean) ?? [];

      const createAICallerAction = (providerName?: string): ActionItem => {
        const name = providerName ? providerName.toLowerCase() : "ai_caller_default";
        const title = providerName ? `Send to ${providerName}` : "Send to AI";

        return {
          name: name,
          displayName: title,
          condition: true,
          action: (
            <Action
              title={title}
              icon={Icon.Bolt}
              onAction={wrapActionHandler(async () => {
                try {
                  const finalContent = await getFinalContent();
                  const effectiveSystemPrompt = getSystemPrompt(prompt);
                  const args: { promptContent: string; systemPrompt?: string; providerName?: string } = {
                    promptContent: finalContent,
                  };
                  if (effectiveSystemPrompt) {
                    args.systemPrompt = effectiveSystemPrompt;
                  }
                  if (providerName) {
                    args.providerName = providerName;
                  }

                  const deeplink = `raycast://extensions/${author}/${extensionName}/${commandName}?arguments=${encodeURIComponent(JSON.stringify(args))}`;
                  await open(deeplink);
                } catch (error) {
                  console.error("Failed to construct or open AI Caller deeplink:", error);
                  await showToast(Toast.Style.Failure, "Deeplink Error", String(error));
                }
              })}
            />
          ),
        };
      };

      if (providerNames.length === 0) {
        aiCallerActions.push(createAICallerAction());
      } else {
        providerNames.forEach((providerName) => {
          aiCallerActions.push(createAICallerAction(providerName));
        });
      }
    } else if (target) {
      console.warn(
        "Invalid aiCallerExtensionTarget format in preferences. Expected 'author.extension_name.command_name'. AI Actions disabled.",
      );

      const configureUrl = `raycast://configure-extension?name=${environment.extensionName}`;

      aiCallerActions.push({
        name: "configure_ai_caller",
        displayName: "Configure Extension Settings",
        condition: true,
        action: <Action.OpenInBrowser title="Configure Extension Settings" icon={Icon.Gear} url={configureUrl} />,
      });
    }
  }

  const createRaycastOpenInBrowser = (title: string | undefined, url: string): ActionWithPossibleProps => (
    <Action.OpenInBrowser
      title={title}
      url={url}
      onOpen={wrapActionHandler(async () => {
        const finalContent = await getFinalContent();
        await Clipboard.copy(finalContent);
        await showToast(Toast.Style.Success, "Copied Prompt", "Opened URL");
      })}
    />
  );

  const baseActionItems: ActionItem[] = [
    {
      name: "openURL",
      displayName: "Open URL",
      condition: Boolean(preferences.openURL),
      action: createRaycastOpenInBrowser("Open URL", preferences.openURL ?? ""),
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
          onAction={wrapActionHandler(async () => {
            const finalContent = await getFinalContent();
            await Clipboard.copy(finalContent);
            await showToast(Toast.Style.Success, "Copied");
            await closeMainWindow({ clearRootSearch: true });
          })}
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
          onAction={wrapActionHandler(async () => {
            const finalContent = await getFinalContent();
            await Clipboard.copy(finalContent);
            await Clipboard.paste(finalContent);
            await showToast(Toast.Style.Success, "Pasted");
          })}
        />
      ),
    },
  ];

  const allActionItems: ActionItem[] = [...aiCallerActions, ...scriptActions, ...baseActionItems];

  const eligibleActions = allActionItems.filter((item) => item.condition);

  eligibleActions.sort((a, b) => {
    const getNameForSort = (name: string) => name.toLowerCase().replace(/^(script_|ai_caller_)/, "");
    const nameA = getNameForSort(a.name);
    const nameB = getNameForSort(b.name);

    const indexA = finalActions.findIndex((name) => name.toLowerCase() === nameA);
    const indexB = finalActions.findIndex((name) => name.toLowerCase() === nameB);

    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;
    return a.displayName.localeCompare(b.displayName);
  });

  const defaultActionPreference = defaultActionPreferenceStore.getDefaultActionPreference();
  let defaultActionItem: ActionItem | undefined;
  if (defaultActionPreference) {
    const preferenceBaseName = defaultActionPreference.replace(/^(script_|call\s+|ai_caller_)/, "");
    defaultActionItem = eligibleActions.find(
      (item) => item.name.toLowerCase().replace(/^(script_|ai_caller_)/, "") === preferenceBaseName.toLowerCase(),
    );
  }

  const resultActions: React.ReactElement[] = [];
  const actionNames = new Set<string>();

  if (defaultActionItem) {
    resultActions.push(React.cloneElement(defaultActionItem.action, { key: defaultActionItem.name }));
    actionNames.add(defaultActionItem.name);
  }

  eligibleActions.forEach((item) => {
    if (!actionNames.has(item.name)) {
      resultActions.push(React.cloneElement(item.action, { key: item.name }));
      actionNames.add(item.name);
    }
  });

  if (resultActions.length === 0) {
    const copyAction = baseActionItems.find((a) => a.name === "copyToClipboard");
    if (copyAction) {
      resultActions.push(React.cloneElement(copyAction.action, { key: copyAction.name }));
    }
  }

  return resultActions;
}
