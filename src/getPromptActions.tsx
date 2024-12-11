import React, { useState, useEffect, useCallback, useRef } from "react";
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
import { ResultView } from "./components/ResultView";
import { AIService } from "./services/AIService";
import { ChatOptions } from "./services/types";

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

interface ChatViewProps {
  getFormattedDescription: () => string;
  options?: ChatOptions;
  providerName?: string;
  systemPrompt?: string;
}

function ChatView({ getFormattedDescription, options, providerName, systemPrompt }: ChatViewProps) {
  const [response, setResponse] = useState<string>('');
  const [duration, setDuration] = useState<string>();
  const [isStreaming, setIsStreaming] = useState(false);
  const [model, setModel] = useState<string>();
  const startTimeRef = useRef<number>(0);
  const contentRef = useRef<string>('');

  const appendResponse = useCallback((text: string) => {
    contentRef.current += text;
    setResponse(contentRef.current);
    const currentDuration = ((Date.now() - startTimeRef.current) / 1000).toFixed(1);
    setDuration(currentDuration);
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

        // 使用流式回调
        const result = await aiService.chat(
          description, 
          {
            ...options,
            systemPrompt: systemPrompt || options?.systemPrompt,
            onStream: (text: string) => {
              if (!isMounted) return;
              appendResponse(text);
            }
          }
        );
        
        if (!isMounted) return;

        // 设置模型信息
        setModel(result.model);
        
        const endTime = Date.now();
        const durationSeconds = ((endTime - startTimeRef.current) / 1000).toFixed(1);
        setDuration(durationSeconds);
        setIsStreaming(false);
        
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
    };
  }, [getFormattedDescription, options, providerName, systemPrompt, appendResponse]);

  return (
    <ResultView 
      response={response}
      duration={duration || ''}
      isLoading={isStreaming}
      model={model}
    />
  );
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
          target={<ChatView getFormattedDescription={getFormattedDescription} providerName="cerebras" />}
        />
      ),
    },
    {
      name: "sambanova",
      displayName: "Call Sambanova",
      condition: true,
      action: (
        <Action.Push
          title="Call Sambanova"
          icon={Icon.AddPerson}
          target={<ChatView getFormattedDescription={getFormattedDescription} providerName="sambanova" />}
        />
      ),
    },
    {
      name: "groq",
      displayName: "Call Groq",
      condition: true,
      action: (
        <Action.Push
          title="Call Groq"
          icon={Icon.AddPerson}
          target={<ChatView getFormattedDescription={getFormattedDescription} providerName="groq" />}
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
