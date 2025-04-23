import { Detail, ActionPanel, Action, Icon, Clipboard, closeMainWindow, showHUD, KeyEquivalent, showToast, Toast } from "@raycast/api";
import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import MarkdownIt from "markdown-it";
import { AIService } from "../services/AIService"; // Import AIService
import { ChatOptions } from "../services/types"; // Import ChatOptions if needed
import { PromptProps } from "../managers/PromptManager";
import { SpecificReplacements } from "../utils/placeholderFormatter";
import { buildFormattedPromptContent, getIndentedPromptTitles } from "../utils/promptFormattingUtils";

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

// Update props for ChatResultView
interface ResultViewProps {
  prompt: PromptProps;
  baseReplacements: Omit<SpecificReplacements, 'clipboard'>;
  promptSpecificRootDir?: string;
  options?: ChatOptions;
  providerName?: string;
  systemPrompt?: string;
}

/**
 * Component to display the result of an AI chat interaction.
 * Handles fetching the response, displaying streaming updates, calculating tokens/duration,
 * and providing relevant actions (copy, paste, copy/paste code blocks).
 *
 * @param props The component props.
 * @param props.prompt The prompt object.
 * @param props.baseReplacements Base replacements without clipboard.
 * @param props.promptSpecificRootDir Root directory for file placeholder resolution.
 * @param props.options Optional configuration for the AI chat request (e.g., model, temperature).
 * @param props.providerName Optional name of the AI provider to use (overrides the default).
 * @param props.systemPrompt Optional system prompt to guide the AI's behavior.
 */
export function ChatResultView({
  prompt,
  baseReplacements,
  promptSpecificRootDir,
  options,
  providerName,
  systemPrompt,
}: ResultViewProps) {
  // Internal state for AI response
  const [response, setResponse] = useState<string>('');
  const [duration, setDuration] = useState<string>();
  const [isLoading, setIsLoading] = useState(true); // Start loading initially
  const [model, setModel] = useState<string>();

  // Refs for streaming and timing (from ChatResponseView)
  const startTimeRef = useRef<number>(0);
  const contentRef = useRef<string>('');
  const updatingRef = useRef<boolean>(false);
  const updateTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Throttling logic (from ChatResponseView)
  /**
   * Schedules a state update for the response content using throttling.
   * This prevents excessive re-renders during rapid streaming updates.
   * Updates are buffered and applied at a maximum frequency (e.g., every 500ms).
   */
  const scheduleUpdate = useCallback(() => {
    if (!updatingRef.current) {
      updatingRef.current = true;
      updateTimerRef.current = setTimeout(() => {
        setResponse(contentRef.current);
        const currentDuration = ((Date.now() - startTimeRef.current) / 1000).toFixed(1);
        setDuration(currentDuration);
        updatingRef.current = false;
      }, 500); // Update interval
    }
  }, []);

  // Effect to fetch AI response (logic from ChatResponseView)
  useEffect(() => {
    let toast: Toast;
    let isMounted = true;

    async function fetchResponse() {
      try {
        // Read clipboard and build final content here
        setIsLoading(true);
        setResponse('');
        contentRef.current = '';
        startTimeRef.current = Date.now();

        toast = await showToast(Toast.Style.Animated, "Thinking...");

        const currentClipboard = await Clipboard.readText() ?? "";
        const finalReplacements: SpecificReplacements = {
          ...baseReplacements,
          clipboard: currentClipboard,
          now: new Date().toLocaleString(),
          promptTitles: getIndentedPromptTitles()
        };
        const finalContent = buildFormattedPromptContent(prompt, finalReplacements, promptSpecificRootDir);

        const aiService = AIService.getInstance();
        if (providerName) {
          aiService.setCurrentProvider(providerName);
        }

        // Send finalContent to AI
        const result = await aiService.chat(
          finalContent,
          {
            ...options,
            systemPrompt: systemPrompt || options?.systemPrompt,
            onStream: (text: string) => {
              if (!isMounted) return;
              contentRef.current += text;
              scheduleUpdate();
            }
          }
        );

        if (!isMounted) return;

        setModel(result.model);

        const endTime = Date.now();
        const durationSeconds = ((endTime - startTimeRef.current) / 1000).toFixed(1);
        setDuration(durationSeconds);
        setIsLoading(false);

        setResponse(contentRef.current);

        if (toast) {
          toast.style = Toast.Style.Success;
          toast.title = `Done (${durationSeconds}s)`;
        }
      } catch (error) {
        if (!isMounted) return;
        console.error("[ChatResultView] Error fetching response:", error);
        setIsLoading(false);
        await showToast(Toast.Style.Failure, "Error", String(error));
        if (toast) {
          toast.hide();
        }
      }
    }

    fetchResponse();

    // Cleanup function
    return () => {
      isMounted = false;
      if (toast) {
        toast.hide();
      }
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
      }
    };
  }, [prompt, baseReplacements, promptSpecificRootDir, options, providerName, systemPrompt, scheduleUpdate]);

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
      markdown={response || "*Thinking...*"}
      actions={
        <ActionPanel>
          {actions}
        </ActionPanel>
      }
      isLoading={isLoading}
      metadata={metadata ? <Detail.Metadata.TagList title="Stats">
        <Detail.Metadata.TagList.Item text={metadata} color="#eed535" />
      </Detail.Metadata.TagList> : undefined}
    />
  );
}