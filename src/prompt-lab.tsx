import "./utils/captured-selection";
import { useEffect, useMemo, useRef, useState } from "react";
import { LaunchProps } from "@raycast/api";
import pinsManager from "./managers/pins-manager";
import promptManager from "./managers/prompt-manager";
import { getQuickPrompt } from "./utils/prompt-formatting-utils";
import { PromptList } from "./components/prompt-list";
import { useInitialContext } from "./hooks/use-initial-context";
import { startupLog } from "./utils/startup-profiler";
import type { PromptProps } from "./managers/prompt-manager";

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
  const hasStartedPromptRefreshRef = useRef(false);
  const hasLoggedFirstRenderRef = useRef(false);
  const { initialSelectionText, selection, target, actions, filePath, ...placeholderArgs } = props.arguments;

  const allowedActions = actions?.split(",").filter(Boolean);

  const initialSelection = (typeof selection === "string" && selection) || initialSelectionText;

  const { selectionText, currentApp, allApp, browserContent, diff } = useInitialContext(initialSelection, target);
  const promptLoadState = useMemo(() => promptManager.getLoadState(), [promptVersion]);

  if (!hasLoggedFirstRenderRef.current) {
    hasLoggedFirstRenderRef.current = true;
    startupLog("PromptLab first render", {
      promptCount: promptLoadState.promptCount,
      cacheHydrated: promptLoadState.hasHydratedFromCache,
      isLoading: isRefreshingPrompts && promptLoadState.promptCount === 0,
    });
  }

  useEffect(() => {
    startupLog("PromptLab mounted", {
      cachedPromptCount: promptManager.getPromptCount(),
      cacheHydrated: promptManager.getLoadState().hasHydratedFromCache,
    });

    const unsubscribe = promptManager.subscribe(() => {
      setPromptVersion((version) => version + 1);
      setIsRefreshingPrompts(false);
    });

    if (!hasStartedPromptRefreshRef.current) {
      hasStartedPromptRefreshRef.current = true;
      setIsRefreshingPrompts(!promptManager.hasPrompts());
      promptManager.refreshPrompts("prompt-lab-startup");
    }

    return () => {
      unsubscribe();
    };
  }, []);

  const pinnedIdentifiers = pinsManager.pinnedIdentifiers();
  const pinnedPrompts = promptManager.getFilteredPrompts((prompt) => {
    prompt.pinned = pinnedIdentifiers.includes(prompt.identifier);
    return prompt.pinned;
  });

  const [quickPrompt, cleanedSelectionText] = getQuickPrompt(selectionText, target, filePath);

  const availablePrompts = quickPrompt?.subprompts
    ? quickPrompt.subprompts
    : quickPrompt
      ? [quickPrompt]
      : [...pinnedPrompts, ...promptManager.getRootPrompts()];

  const effectiveSelectionText = quickPrompt ? cleanedSelectionText : selectionText;

  const uniquePrompts = Array.from(new Set(availablePrompts.map((prompt) => prompt.identifier || prompt.title)))
    .map((unique) => availablePrompts.find((prompt) => prompt.identifier === unique || prompt.title === unique))
    .filter(Boolean) as PromptProps[];

  return (
    <PromptList
      searchMode={!quickPrompt}
      isLoading={isRefreshingPrompts && promptLoadState.promptCount === 0}
      prompts={uniquePrompts}
      selectionText={effectiveSelectionText}
      currentApp={currentApp}
      allApp={allApp}
      browserContent={browserContent}
      allowedActions={allowedActions}
      diff={diff}
      placeholderArgs={placeholderArgs}
    />
  );
}
