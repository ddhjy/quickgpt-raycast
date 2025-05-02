import { Detail, ActionPanel, Action, Icon, Clipboard, closeMainWindow, showHUD, KeyEquivalent, showToast, Toast, getPreferenceValues } from "@raycast/api";
import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import MarkdownIt from "markdown-it";
import { AIService } from "../services/AIService";
import { ChatOptions } from "../services/types"; // Keep if options are passed through

// Initialize Markdown parser
const md = new MarkdownIt();

// Calculate tokens using approximate values
/**
 * Approximates the number of tokens in a given text string.
 * Considers Chinese characters as 2 tokens and others as 0.25 tokens.
 *
 * @param text The input string.
 * @returns The estimated token count.
 */
const countTokens = (text: string): number => {
  // Chinese characters count as 2 tokens, other characters as 0.25 tokens
  const chineseCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherCount = text.length - chineseCount;
  return Math.ceil(chineseCount * 2 + otherCount * 0.25);
};

// Helper function to extract code blocks, limiting max number of blocks
/**
 * Extracts fenced code blocks from a Markdown string.
 *
 * @param text The Markdown text to parse.
 * @param maxBlocks The maximum number of code blocks to extract. Defaults to 10.
 * @returns An array of strings, each containing the content of a code block.
 */
const extractCodeBlocks = (text: string, maxBlocks: number = 10): string[] => {
  const tokens = md.parse(text, {});
  const codeBlocks: string[] = [];
  let count = 0;

  for (const token of tokens) {
    if (token.type === 'fence' && token.tag === 'code') {
      codeBlocks.push(token.content.trim());
      count += 1;
      if (count >= maxBlocks) break; // Stop when limit is reached
    }
  }

  return codeBlocks;
};

// Get the longest code block
/**
 * Finds the longest code block from an array of code block strings.
 *
 * @param blocks An array of code block strings.
 * @returns The string content of the longest code block. Returns an empty string if the input array is empty.
 */
const getLongestCodeBlock = (blocks: string[]): string => {
  return blocks.reduce((max, current) => (current.length > max.length ? current : max), "");
};

// Get code block summary
/**
 * Creates a short summary (typically the first non-empty line) of a code block.
 *
 * @param block The code block string.
 * @param maxLength The maximum length of the summary. Defaults to 30.
 * @returns A truncated summary string, ending with '...' if truncated.
 */
const getCodeBlockSummary = (block: string, maxLength: number = 30): string => {
  const firstLine = block.split('\n').find(line => line.trim().length > 0) || '';
  const summary = firstLine.trim();
  return summary.length > maxLength ? `${summary.slice(0, maxLength)}...` : summary;
};

// Update props for ResultView
interface ResultViewProps {
  initialPromptContent: string;       // Renamed and required
  initialSystemPrompt?: string;      // Renamed
  initialProviderName?: string;      // Renamed
  // Remove prompt, baseReplacements, promptSpecificRootDir, options
}

/**
 * Component to display the result of an AI chat interaction triggered by deeplink.
 * Handles fetching the response using the provided content and provider,
 * displaying streaming updates, calculating tokens/duration,
 * and providing relevant actions (copy, paste, copy/paste code blocks).
 *
 * @param props The component props.
 * @param props.initialPromptContent The final prompt content received from the trigger.
 * @param props.initialSystemPrompt Optional system prompt received from the trigger.
 * @param props.initialProviderName Optional name of the AI provider to use, received from the trigger.
 */
export function ResultView({ initialPromptContent, initialSystemPrompt, initialProviderName }: ResultViewProps) {
  const [response, setResponse] = useState<string>('');
  const [duration, setDuration] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [model, setModel] = useState<string>();

  const startTimeRef = useRef<number>(0);
  const contentRef = useRef<string>('');
  const updatingRef = useRef<boolean>(false);
  const updateTimerRef = useRef<NodeJS.Timeout | null>(null);

  const scheduleUpdate = useCallback(() => {
    if (!updatingRef.current) {
      updatingRef.current = true;
      updateTimerRef.current = setTimeout(() => {
        if (!isMountedRef.current) return; // Check if component is still mounted
        setResponse(contentRef.current);
        const currentDuration = ((Date.now() - startTimeRef.current) / 1000).toFixed(1);
        setDuration(currentDuration);
        updatingRef.current = false;
      }, 500); // Update interval
    }
  }, []);

  // Ref to track component mount status
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Effect to fetch AI response
  useEffect(() => {
    let toast: Toast | undefined;

    async function fetchResponse() {
      // No need to read clipboard or build final content here, it's already provided
      setIsLoading(true);
      setResponse('');
      contentRef.current = '';
      setModel(undefined); // Reset model name
      setDuration(undefined); // Reset duration
      startTimeRef.current = Date.now();

      toast = await showToast(Toast.Style.Animated, "Thinking...");

      try {
        const aiService = AIService.getInstance();

        // Set Provider if specified
        if (initialProviderName) {
          try {
            aiService.setCurrentProvider(initialProviderName);
            await toast?.hide(); // Hide previous toast before showing potential provider error
            toast = await showToast(Toast.Style.Animated, `Using ${aiService.getCurrentProvider().name}...`);
            // console.log(`Provider set to: ${initialProviderName}`);
          } catch (providerError) {
            console.error("[ResultView] Error setting provider:", providerError);
            await showToast(Toast.Style.Failure, "Provider Error", String(providerError));
            setIsLoading(false);
            if (toast) toast.hide();
            return; // Stop execution if provider is invalid
          }
        }
        // else: Use AIService's default provider

        // console.log(`Sending to AI (${aiService.getCurrentProvider().name}):`, {
        //   content: initialPromptContent.substring(0, 100) + '...',
        //   system: initialSystemPrompt,
        // });

        // Directly use the provided prompt content and system prompt
        const result = await aiService.chat(
          initialPromptContent,
          {
            // Pass systemPrompt directly. AIService will handle merging with defaults if necessary.
            systemPrompt: initialSystemPrompt,
            // Note: We don't pass 'options' here anymore. AIService uses its loaded config.
            // If needed, 'options' could be another argument in the deeplink and passed here.
            onStream: (text: string) => {
              if (!isMountedRef.current) return;
              contentRef.current += text;
              scheduleUpdate();
            }
          }
        );

        if (!isMountedRef.current) return;

        setModel(result.model);

        const endTime = Date.now();
        const durationSeconds = ((endTime - startTimeRef.current) / 1000).toFixed(1);
        setDuration(durationSeconds);
        setIsLoading(false);

        // Ensure final update captures all content
        if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
        setResponse(contentRef.current);

        if (toast) {
          toast.style = Toast.Style.Success;
          toast.title = `Done (${durationSeconds}s)`;
          // Hide success toast after a delay
          setTimeout(() => toast?.hide(), 2000);
        }
      } catch (error) {
        if (!isMountedRef.current) return;
        console.error("[ResultView] Error fetching AI response:", error);
        setIsLoading(false);
        await showToast(Toast.Style.Failure, "AI Error", String(error));
        if (toast) {
          toast.hide(); // Hide thinking toast
        }
      }
    }

    fetchResponse();

    // Cleanup function
    return () => {
      // isMountedRef is handled by its own effect
      if (toast) {
        toast.hide();
      }
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
        updatingRef.current = false; // Reset update flag on unmount
      }
    };
    // Update dependencies: only trigger when initial inputs change
  }, [initialPromptContent, initialSystemPrompt, initialProviderName, scheduleUpdate]);

  // Use internal state for calculations and rendering
  const codeBlocks = useMemo(() => extractCodeBlocks(response, 10), [response]);
  const hasCodeBlock = codeBlocks.length > 0;

  const longestCodeBlock = useMemo(() => getLongestCodeBlock(codeBlocks), [codeBlocks]);
  const longestBlockSummary = useMemo(() => getCodeBlockSummary(longestCodeBlock), [longestCodeBlock]);

  const actions = useMemo(() => {
    // Use internal isLoading state
    if (isLoading) {
      return [];
    }

    const baseActions = [
      <Action
        key="paste"
        title="Paste"
        shortcut={{ modifiers: ["cmd"], key: "v" }}
        icon={Icon.Document}
        onAction={async () => {
          await Clipboard.paste(response);
          await showHUD("已粘贴");
          closeMainWindow();
        }}
      />,
      <Action
        key="copy"
        title="Copy"
        shortcut={{ modifiers: ["cmd"], key: "c" }}
        icon={Icon.Clipboard}
        onAction={async () => {
          await Clipboard.copy(response);
          await showHUD("已复制");
          closeMainWindow();
        }}
      />,
    ];

    if (hasCodeBlock) {
      const pasteLongestAction = (
        <Action
          key="pasteLongestCode"
          title={`Paste Longest: ${longestBlockSummary}`}
          icon={Icon.Code}
          shortcut={{ modifiers: ["cmd"], key: ";" }}
          onAction={async () => {
            await Clipboard.copy(longestCodeBlock);
            await Clipboard.paste(longestCodeBlock);
            await showHUD("已粘贴代码");
            closeMainWindow();
          }}
        />
      );

      const copyLongestAction = (
        <Action
          key="copyLongestCode"
          title={`Copy Longest: ${longestBlockSummary}`}
          icon={Icon.Code}
          shortcut={{ modifiers: ["cmd"], key: "'" }}
          onAction={async () => {
            await Clipboard.copy(longestCodeBlock);
            await showHUD("已复制代码");
            closeMainWindow();
          }}
        />
      );

      baseActions.unshift(pasteLongestAction, copyLongestAction); // Add code-related actions to beginning
    }

    // Add actions for each individual code block if there are multiple
    if (codeBlocks.length > 1) {
      codeBlocks.forEach((block, index) => {
        const summary = getCodeBlockSummary(block, 20);
        const blockNumber = index + 1;
        const shortcutKey = blockNumber <= 9 ? String(blockNumber) as KeyEquivalent : undefined;

        baseActions.push(
          <Action
            key={`copyBlock${index}`}
            title={`Copy Block ${blockNumber}: ${summary}`}
            icon={Icon.Code}
            shortcut={shortcutKey ? { modifiers: ["cmd", "shift"], key: shortcutKey } : undefined}
            onAction={async () => {
              await Clipboard.copy(block);
              await showHUD(`已复制代码块 ${blockNumber}`);
              closeMainWindow();
            }}
          />
        );

        baseActions.push(
          <Action
            key={`pasteBlock${index}`}
            title={`Paste Block ${blockNumber}: ${summary}`}
            icon={Icon.Code}
            onAction={async () => {
              await Clipboard.copy(block);
              await Clipboard.paste(block);
              await showHUD(`已粘贴代码块 ${blockNumber}`);
              closeMainWindow();
            }}
          />
        );
      });
    }

    return baseActions;
  }, [isLoading, response, hasCodeBlock, codeBlocks, longestCodeBlock, longestBlockSummary]);

  // Calculate token counts, response length, model info
  const tokenCounts = useMemo(() => {
    const responseTokens = countTokens(response || "");
    return responseTokens;
  }, [response]);

  // Metadata that appears as a footer in the Detail view
  const metadata = useMemo(() => {
    if (isLoading) {
      return undefined;
    }

    let metaString = `${response.length} chars`;
    if (tokenCounts && tokenCounts > 0) {
      metaString += ` • ~${tokenCounts} tokens`;
    }
    if (duration) {
      metaString += ` • ${duration}s`;
    }
    if (model) {
      metaString += ` • ${model}`;
    }

    return metaString;
  }, [isLoading, response.length, tokenCounts, duration, model]);

  return (
    <Detail
      isLoading={isLoading}
      markdown={response}
      actions={actions}
      metadata={
        !isLoading ? (
          <Detail.Metadata>
            {model && <Detail.Metadata.Label title="Model" text={model} />}
            {duration && <Detail.Metadata.Label title="Duration" text={`${duration}s`} />}
            <Detail.Metadata.Separator />
            <Detail.Metadata.Label title="Tokens (approx.)" text={`${countTokens(response)}`} />
          </Detail.Metadata>
        ) : null
      }
    />
  );
}