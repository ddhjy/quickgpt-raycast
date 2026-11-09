import "./utils/captured-selection";
import { useEffect, useMemo, useState } from "react";
import { LaunchProps, showToast, Toast } from "@raycast/api";
import pinsManager from "./managers/pins-manager";
import promptManager from "./managers/prompt-manager";
import { getQuickPrompt } from "./utils/prompt-formatting-utils";
import { PromptList, type PromptContext } from "./components/prompt-list";
import { useInitialContext } from "./hooks/use-initial-context";

interface ExtendedArguments extends Arguments.PromptLab {
  initialSelectionText?: string;
  selection?: string;
  target?: string;
  actions?: string;
  filePath?: string;
  [key: string]: unknown;
}

export default function PromptLab(props: LaunchProps<{ arguments: ExtendedArguments }>) {
  const [promptVersion, setPromptVersion] = useState(0);
  const [isRefreshingPrompts, setIsRefreshingPrompts] = useState(() => !promptManager.hasPrompts());
  const { initialSelectionText, selection, target, actions, filePath } = props.arguments;

  const allowedActions = useMemo(() => actions?.split(",").filter(Boolean), [actions]);
  const placeholderArgs = useMemo(() => {
    const customArguments = { ...props.arguments };
    delete customArguments.initialSelectionText;
    delete customArguments.selection;
    delete customArguments.target;
    delete customArguments.actions;
    delete customArguments.filePath;
    return customArguments;
  }, [props.arguments]);

  const initialSelection = (typeof selection === "string" && selection) || initialSelectionText;

  const { selectionText, selectionPending, currentApp, allApp, browserContent, diff } = useInitialContext(
    initialSelection,
    target,
  );

  useEffect(() => {
    const unsubscribe = promptManager.subscribe((promptsChanged) => {
      if (promptsChanged) {
        setPromptVersion((version) => version + 1);
      }
      setIsRefreshingPrompts(false);
    });

    // The cached library is already on screen; re-read the files in the background.
    void promptManager.refreshPrompts().catch((error) =>
      showToast({
        style: Toast.Style.Failure,
        title: "Couldn't refresh prompts",
        message: String(error),
      }),
    );

    return unsubscribe;
  }, []);

  const [quickPrompt, cleanedSelectionText] = useMemo(
    () => getQuickPrompt(selectionText, target, filePath),
    [filePath, selectionText, target, promptVersion],
  );

  const effectiveSelectionText = quickPrompt ? cleanedSelectionText : selectionText;
  const pinnedIdentifiersKey = JSON.stringify(pinsManager.pinnedIdentifiers());
  const uniquePrompts = useMemo(() => {
    const pinnedIdentifierSet = new Set<string>(JSON.parse(pinnedIdentifiersKey));
    const pinnedPrompts = promptManager.getFilteredPrompts((prompt) => {
      prompt.pinned = pinnedIdentifierSet.has(prompt.identifier);
      return prompt.pinned;
    });
    const availablePrompts = quickPrompt?.subprompts
      ? quickPrompt.subprompts
      : quickPrompt
        ? [quickPrompt]
        : [...pinnedPrompts, ...promptManager.getRootPrompts()];
    const seen = new Set<string>();

    return availablePrompts.filter((prompt) => {
      const key = prompt.identifier || prompt.title;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }, [pinnedIdentifiersKey, promptVersion, quickPrompt]);

  // Launch arguments come last so a deeplink can override any captured value.
  const context = useMemo<PromptContext>(
    () => ({ selection: effectiveSelectionText, currentApp, allApp, browserContent, diff, ...placeholderArgs }),
    [allApp, browserContent, currentApp, diff, effectiveSelectionText, placeholderArgs],
  );

  return (
    <PromptList
      searchMode={!quickPrompt}
      isLoading={selectionPending || (isRefreshingPrompts && !promptManager.hasPrompts())}
      prompts={selectionPending ? [] : uniquePrompts}
      context={context}
      allowedActions={allowedActions}
    />
  );
}
