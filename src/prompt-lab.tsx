import { LaunchProps } from "@raycast/api";
import pinsManager from "./managers/PinsManager";
import promptManager from "./managers/PromptManager";
import { getQuickPrompt } from "./utils/promptFormattingUtils";
import { PromptList } from "./components/PromptList";
import { useInitialContext } from "./hooks/useInitialContext";
import { PromptProps } from "./managers/PromptManager";

interface ExtendedArguments {
  clipboardText?: string;
  selectionText?: string;
  target?: string;
  activateOCR?: string;
  actions?: string;
  filePath?: string;
}

export default function PromptLab(props: LaunchProps<{ arguments: ExtendedArguments }>) {
  const {
    selectionText: initialSelectionText,
    clipboardText: initialClipboardText,
    target,
    activateOCR,
    actions,
    filePath,
  } = props.arguments;

  // 转换actions字符串为数组
  const allowedActions = actions?.split(',').filter(Boolean);

  // 使用自定义Hook获取初始上下文数据
  const {
    clipboardText,
    selectionText,
    currentApp,
    browserContent,
  } = useInitialContext(initialClipboardText, initialSelectionText, target, activateOCR);

  // 获取置顶的提示
  const pinnedIdentifiers = pinsManager.pinnedIdentifiers();
  const pinnedPrompts = promptManager.getFilteredPrompts((prompt) => {
    prompt.pinned = pinnedIdentifiers.has(prompt.identifier);
    return prompt.pinned;
  });

  // 获取快速提示
  const [quickPrompt, cleanedSelectionText] = getQuickPrompt(selectionText, target, filePath);

  // 准备要显示的提示列表
  const availablePrompts = quickPrompt?.subprompts
    ? quickPrompt.subprompts
    : quickPrompt
      ? [quickPrompt]
      : [
        ...pinnedPrompts,
        ...promptManager.getRootPrompts(),
        {
          title: "Settings",
          icon: "⚙️",
          identifier: "settings",
          subprompts: [
            {
              title: "Open Extension Preferences",
              icon: "🎛️",
              identifier: "open-preferences",
              actions: ["open-preferences"]
            },
            {
              title: "Open Custom Prompts Directory",
              icon: "📁",
              identifier: "open-custom-prompts-dir",
              actions: ["open-custom-prompts-dir"]
            },
            {
              title: "Open Scripts Directory",
              icon: "📁",
              identifier: "open-scripts-dir",
              actions: ["open-scripts-dir"]
            }
          ]
        }
      ];

  // 确定有效的选择文本
  const effectiveSelectionText = quickPrompt ? cleanedSelectionText : selectionText;

  // 去重提示列表
  const uniquePrompts = Array.from(
    new Set(availablePrompts.map((prompt) => prompt.identifier || prompt.title))
  )
    .map((unique) => availablePrompts.find((prompt) => prompt.identifier === unique || prompt.title === unique))
    .filter(Boolean) as PromptProps[];

  // 渲染提示列表组件
  return (
    <PromptList
      searchMode={!quickPrompt}
      prompts={uniquePrompts}
      clipboardText={clipboardText}
      selectionText={effectiveSelectionText}
      currentApp={currentApp}
      browserContent={browserContent}
      allowedActions={allowedActions}
    />
  );
}
