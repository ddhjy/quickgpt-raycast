import { LaunchProps } from "@raycast/api";
import pinsManager from "./managers/pins-manager";
import promptManager from "./managers/prompt-manager";
import { getQuickPrompt } from "./utils/prompt-formatting-utils";
import { PromptList } from "./components/prompt-list";
import { useInitialContext } from "./hooks/use-initial-context";
import { PromptProps } from "./managers/prompt-manager";

interface ExtendedArguments extends Arguments.PromptLab {
  initialSelectionText?: string;
  target?: string;
  actions?: string;
  filePath?: string;
}

/**
 * The main entry point component for the QuickGPT Raycast command.
 * It determines the initial context (selection, app, etc.), fetches prompts,
 * handles "quick prompts" based on selection/target, and renders the appropriate PromptList.
 *
 * @param props The launch properties provided by Raycast.
 * @param props.arguments Launch arguments, including potential initial text, target prompt identifier, and allowed actions.
 */
export default function PromptLab(props: LaunchProps<{ arguments: ExtendedArguments }>) {
  const { initialSelectionText, target, actions, filePath } = props.arguments;

  // Convert actions string to array
  const allowedActions = actions?.split(",").filter(Boolean);

  const { selectionText, currentApp, allApp, browserContent, diff } = useInitialContext(initialSelectionText, target);

  // Get pinned prompts
  const pinnedIdentifiers = pinsManager.pinnedIdentifiers();
  const pinnedPrompts = promptManager.getFilteredPrompts((prompt) => {
    prompt.pinned = pinnedIdentifiers.includes(prompt.identifier);
    return prompt.pinned;
  });

  // Get quick prompt
  const [quickPrompt, cleanedSelectionText] = getQuickPrompt(selectionText, target, filePath);

  // Prepare the list of prompts to display
  const availablePrompts = quickPrompt?.subprompts
    ? quickPrompt.subprompts
    : quickPrompt
      ? [quickPrompt]
      : [...pinnedPrompts, ...promptManager.getRootPrompts()];

  // Determine the effective selected text
  const effectiveSelectionText = quickPrompt ? cleanedSelectionText : selectionText;

  // Deduplicate the prompt list
  const uniquePrompts = Array.from(new Set(availablePrompts.map((prompt) => prompt.identifier || prompt.title)))
    .map((unique) => availablePrompts.find((prompt) => prompt.identifier === unique || prompt.title === unique))
    .filter(Boolean) as PromptProps[];

  // Render the prompt list component
  return (
    <PromptList
      searchMode={!quickPrompt}
      prompts={uniquePrompts}
      selectionText={effectiveSelectionText}
      currentApp={currentApp}
      allApp={allApp}
      browserContent={browserContent}
      allowedActions={allowedActions}
      diff={diff}
    />
  );
}
