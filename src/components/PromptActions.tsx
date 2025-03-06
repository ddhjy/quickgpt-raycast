import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  getPreferenceValues,
  Action,
  Icon,
  Clipboard,
  Toast,
  closeMainWindow,
  showToast,
  showHUD,
} from "@raycast/api";
import { runAppleScript } from "@raycast/utils";
import fs from "fs";
import defaultActionPreferenceStore from "../stores/DefaultActionPreferenceStore";
import { ChatResultView } from "./ResultView";
import { AIService } from "../services/AIService";
import { ChatOptions } from "../services/types";
import { getAvailableScripts } from "../utils/scriptUtils";
import { ChatView } from "./ChatView";

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

  // 用于节流更新
  const updatingRef = useRef<boolean>(false);
  const updateTimerRef = useRef<NodeJS.Timeout | null>(null);

  const scheduleUpdate = useCallback(() => {
    if (!updatingRef.current) {
      // 标记正在更新，稍后清除
      updatingRef.current = true;
      updateTimerRef.current = setTimeout(() => {
        // 定时更新状态
        setResponse(contentRef.current);
        const currentDuration = ((Date.now() - startTimeRef.current) / 1000).toFixed(1);
        setDuration(currentDuration);
        updatingRef.current = false;
      }, 500); // 每500ms更新一次UI，可根据需要进行调节
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

        // 使用流式回调，但不在回调中直接setState
        const result = await aiService.chat(
          description,
          {
            ...options,
            systemPrompt: systemPrompt || options?.systemPrompt,
            onStream: (text: string) => {
              if (!isMounted) return;
              // 仅将新数据追加到contentRef
              contentRef.current += text;
              // 使用批次更新，减少频繁UI更新
              scheduleUpdate();
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

        // 确保流结束后有一次最终更新（有些流可能在timer空隙未更新完整）
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
      // 使用工具函数获取所有可用脚本
      const scripts = getAvailableScripts(preferences.scriptsDirectory, __dirname);

      // 为每个脚本创建 Action
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
        };
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

    // 优先处理最近选择的动作
    if (a.name === lastSelectedAction && b.name !== lastSelectedAction) return -1;
    if (b.name === lastSelectedAction && a.name !== lastSelectedAction) return 1;

    const indexA = finalActions.indexOf(stripRunPrefix(a.displayName));
    const indexB = finalActions.indexOf(stripRunPrefix(b.displayName));

    if (indexA !== -1 && indexB !== -1) {
      return indexA - indexB;
    }

    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;

    // 检查 action 是否有快捷键
    const hasShortcutA = Boolean(a.action.props.shortcut);
    const hasShortcutB = Boolean(b.action.props.shortcut);

    // 如果两个 action 都没有快捷键，才考虑 lastSelectedAction
    if (!hasShortcutA && !hasShortcutB) {
      if (a.name === lastSelectedAction) return -1;
      if (b.name === lastSelectedAction) return 1;
    }

    return a.displayName.localeCompare(b.displayName); // 添加字母顺序作为最终后备排序
  });

  return (
    <>
      {filteredActions.map((option, index) => {
        const handleAction = () => {
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