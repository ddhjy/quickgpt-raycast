import { Detail, ActionPanel, Action, Icon, Clipboard, closeMainWindow, showHUD, KeyEquivalent, showToast, Toast } from "@raycast/api";
import React, { useMemo, useState, useEffect, useRef, useCallback } from "react";
import MarkdownIt from "markdown-it";
import { AIService } from "../services/AIService"; // Import AIService
import { ChatOptions } from "../services/types"; // Import ChatOptions if needed

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
  getFormattedDescription: () => string;
  options?: ChatOptions;
  providerName?: string;
  systemPrompt?: string;
  // Remove props that are now state: response, duration, isLoading, model
}

/**
 * Component to display the result of an AI chat interaction.
 * Handles fetching the response, displaying streaming updates, calculating tokens/duration,
 * and providing relevant actions (copy, paste, copy/paste code blocks).
 *
 * @param props The component props.
 * @param props.getFormattedDescription Function to retrieve the final prompt content sent to the AI.
 * @param props.options Optional configuration for the AI chat request (e.g., model, temperature).
 * @param props.providerName Optional name of the AI provider to use (overrides the default).
 * @param props.systemPrompt Optional system prompt to guide the AI's behavior.
 */
export function ChatResultView({
  getFormattedDescription,
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
        const description = getFormattedDescription();
        startTimeRef.current = Date.now();
        setIsLoading(true); // Ensure loading state is true
        setResponse(''); // Reset response
        contentRef.current = ''; // Reset content ref

        toast = await showToast(Toast.Style.Animated, "Thinking...");

        const aiService = AIService.getInstance();
        if (providerName) {
          aiService.setCurrentProvider(providerName);
        }

        // Fetch response with streaming
        const result = await aiService.chat(
          description,
          {
            ...options, // Pass options from props
            systemPrompt: systemPrompt || options?.systemPrompt, // Pass systemPrompt from props
            onStream: (text: string) => {
              if (!isMounted) return;
              contentRef.current += text;
              scheduleUpdate(); // Schedule throttled state update
            }
          }
        );

        if (!isMounted) return;

        setModel(result.model); // Set model info from result

        const endTime = Date.now();
        const durationSeconds = ((endTime - startTimeRef.current) / 1000).toFixed(1);
        setDuration(durationSeconds);
        setIsLoading(false); // Set loading to false

        // Final update to ensure all content is rendered
        setResponse(contentRef.current);

        if (toast) {
          toast.style = Toast.Style.Success;
          toast.title = `Done (${durationSeconds}s)`;
        }
      } catch (error) {
        if (!isMounted) return;
        console.error("[ChatResultView] Error fetching response:", error);
        setIsLoading(false); // Stop loading on error
        await showToast(Toast.Style.Failure, "Error", String(error));
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
      // Optional: Cancel any ongoing AI request if AIService supports it
    };
  }, [getFormattedDescription, options, providerName, systemPrompt, scheduleUpdate]); // Dependencies for the effect

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
            await showHUD(`已粘贴: ${longestBlockSummary}`);
            closeMainWindow();
          }}
        />
      );

      const codeActions = codeBlocks.length > 1 ? codeBlocks.map((block, index) => {
        const summary = getCodeBlockSummary(block);
        const uniqueKey = `copyCode-${index}-${summary}`;
        return (
          <Action
            key={uniqueKey}
            title={`Copy #${index + 1}: ${summary}`}
            icon={Icon.Code}
            shortcut={{ modifiers: ["cmd"], key: String(index + 1) as KeyEquivalent }}
            onAction={async () => {
              await Clipboard.copy(block);
              await showHUD(`复制: ${summary}`);
              closeMainWindow();
            }}
          />
        );
      }).slice(0, 9) : [];

      const otherActions = [
        <Action
          key="copyLongestCode"
          title={`Copy Longest: ${longestBlockSummary}`}
          icon={Icon.Code}
          shortcut={{ modifiers: ["cmd"], key: "'" }}
          onAction={async () => {
            await Clipboard.copy(longestCodeBlock);
            await showHUD(`已复制: ${longestBlockSummary}`);
            closeMainWindow();
          }}
        />,
      ];

      return [
        ...otherActions,
        pasteLongestAction,
        ...baseActions,
        ...codeActions
      ];
    }

    return baseActions;
  }, [hasCodeBlock, codeBlocks, longestCodeBlock, longestBlockSummary, response, isLoading]);

  const metadata = useMemo(() => (
    <Detail.Metadata>
      {/* Use internal model and duration state */}
      {<Detail.Metadata.Label title="Model" text={model || "-"} />}
      {/* Access options if needed, or pass them through props if they are static */}
      <Detail.Metadata.Label title="Temperature" text={options?.temperature?.toFixed(2) || "-"} />
      <Detail.Metadata.Label title="Max Tokens" text={options?.maxTokens?.toString() || "-"} />
      <Detail.Metadata.Label title="Top P" text={options?.topP?.toFixed(2) || "-"} />
      <Detail.Metadata.Separator />
      <Detail.Metadata.Label title="Duration(s)" text={duration ? `${duration}` : "-"} />
      {/* Use internal response state */}
      <Detail.Metadata.Label title="Response Tokens" text={response ? `${countTokens(response)}` : "-"} />
    </Detail.Metadata>
    // Use internal state and options in dependencies
  ), [model, options, duration, response]);

  return (
    <Detail
      // Use internal response and isLoading state
      markdown={response}
      isLoading={isLoading}
      actions={<ActionPanel>{actions}</ActionPanel>}
      metadata={metadata}
    />
  );
}