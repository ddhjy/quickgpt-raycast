import { Detail, ActionPanel, Action, Icon, Clipboard, closeMainWindow, showHUD, KeyEquivalent } from "@raycast/api";
import React, { useMemo } from "react";
import MarkdownIt from "markdown-it";

// Initialize Markdown parser
const md = new MarkdownIt();

// Calculate tokens using approximate values
const countTokens = (text: string): number => {
  // Chinese characters count as 2 tokens, other characters as 0.25 tokens
  const chineseCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherCount = text.length - chineseCount;
  return Math.ceil(chineseCount * 2 + otherCount * 0.25);
};

// Helper function to extract code blocks, limiting max number of blocks
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
const getLongestCodeBlock = (blocks: string[]): string => {
  return blocks.reduce((max, current) => (current.length > max.length ? current : max), "");
};

// Get code block summary
const getCodeBlockSummary = (block: string, maxLength: number = 30): string => {
  const firstLine = block.split('\n').find(line => line.trim().length > 0) || '';
  const summary = firstLine.trim();
  return summary.length > maxLength ? `${summary.slice(0, maxLength)}...` : summary;
};

interface ResultViewProps {
  response: string;
  duration: string;
  isLoading: boolean;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

export function ChatResultView({
  response,
  duration,
  model,
  temperature = 0.7,
  maxTokens = 4096,
  topP = 0.95,
  isLoading,
}: ResultViewProps) {
  // Use useMemo to cache code block extraction results, limit max number of blocks
  const codeBlocks = useMemo(() => extractCodeBlocks(response, 10), [response]); // For example, limit to 10
  const hasCodeBlock = codeBlocks.length > 0;

  const longestCodeBlock = useMemo(() => getLongestCodeBlock(codeBlocks), [codeBlocks]);
  const longestBlockSummary = useMemo(() => getCodeBlockSummary(longestCodeBlock), [longestCodeBlock]);

  const actions = useMemo(() => {
    // If loading, return empty array
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
      {<Detail.Metadata.Label title="Model" text={model || "-"} />}
      <Detail.Metadata.Label title="Temperature" text={temperature?.toFixed(2) || "-"} />
      <Detail.Metadata.Label title="Max Tokens" text={maxTokens?.toString() || "-"} />
      <Detail.Metadata.Label title="Top P" text={topP?.toFixed(2) || "-"} />
      <Detail.Metadata.Separator />
      <Detail.Metadata.Label title="Duration(s)" text={duration ? `${duration}` : "-"} />
      <Detail.Metadata.Label title="Response Tokens" text={response ? `${countTokens(response)}` : "-"} />
    </Detail.Metadata>
  ), [model, temperature, maxTokens, topP, duration, response]);

  return (
    <Detail
      markdown={response}
      isLoading={isLoading}
      actions={<ActionPanel>{actions}</ActionPanel>}
      metadata={metadata}
    />
  );
}