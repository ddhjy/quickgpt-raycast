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

  // Convert actions string to array
  const allowedActions = actions?.split(',').filter(Boolean);

  // Use custom hook to get initial context data
  const {
    clipboardText,
    selectionText,
    currentApp,
    browserContent,
  } = useInitialContext(initialClipboardText, initialSelectionText, target, activateOCR);

  // Get pinned prompts
  const pinnedIdentifiers = pinsManager.pinnedIdentifiers();
  const pinnedPrompts = promptManager.getFilteredPrompts((prompt) => {
    prompt.pinned = pinnedIdentifiers.has(prompt.identifier);
    return prompt.pinned;
  });

  // Get quick prompt
  const [quickPrompt, cleanedSelectionText] = getQuickPrompt(selectionText, target, filePath);

  // Prepare the list of prompts to display
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

  // Determine the effective selected text
  const effectiveSelectionText = quickPrompt ? cleanedSelectionText : selectionText;

  // Deduplicate the prompt list
  const uniquePrompts = Array.from(
    new Set(availablePrompts.map((prompt) => prompt.identifier || prompt.title))
  )
    .map((unique) => availablePrompts.find((prompt) => prompt.identifier === unique || prompt.title === unique))
    .filter(Boolean) as PromptProps[];

  // Render the prompt list component
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
