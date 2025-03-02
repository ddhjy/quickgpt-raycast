import { Detail, ActionPanel, Action, Icon, Clipboard, closeMainWindow, showHUD, KeyEquivalent } from "@raycast/api";
import React, { useMemo } from "react";
import MarkdownIt from "markdown-it";

// 初始化 Markdown 解析器
const md = new MarkdownIt();

// 使用近似值计算 tokens
const countTokens = (text: string): number => {
  // 中文字符计为2个token，其他字符计为0.25个token
  const chineseCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const otherCount = text.length - chineseCount;
  return Math.ceil(chineseCount * 2 + otherCount * 0.25);
};

// 提取代码块的辅助函数，限制最大代码块数量
const extractCodeBlocks = (text: string, maxBlocks: number = 10): string[] => {
  const tokens = md.parse(text, {});
  const codeBlocks: string[] = [];
  let count = 0;

  for (const token of tokens) {
    if (token.type === 'fence' && token.tag === 'code') {
      codeBlocks.push(token.content.trim());
      count += 1;
      if (count >= maxBlocks) break; // 达到上限后停止
    }
  }

  return codeBlocks;
};

// 获取最长的代码块
const getLongestCodeBlock = (blocks: string[]): string => {
  return blocks.reduce((max, current) => (current.length > max.length ? current : max), "");
};

// 获取代码块摘要
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
  // 使用 useMemo 缓存代码块的提取结果，限制最大代码块数量
  const codeBlocks = useMemo(() => extractCodeBlocks(response, 10), [response]); // 例如限制为10个
  const hasCodeBlock = codeBlocks.length > 0;

  const longestCodeBlock = useMemo(() => getLongestCodeBlock(codeBlocks), [codeBlocks]);
  const longestBlockSummary = useMemo(() => getCodeBlockSummary(longestCodeBlock), [longestCodeBlock]);

  const actions = useMemo(() => {
    // 如果正在加载，返回空数组
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