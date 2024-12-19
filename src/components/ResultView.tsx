import { Detail, ActionPanel, Action, Icon, Clipboard, closeMainWindow, showHUD } from "@raycast/api";
import { useState } from "react";

interface ResultViewProps {
  response: string;
  duration: string;
  isLoading: boolean;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

export function ResultView({
  response,
  duration,
  model,
  temperature = 0.7,
  maxTokens = 4096,
  topP = 0.95,
}: ResultViewProps) {
  const [isLoading] = useState(false);

  const markdown = `
${response}
`;

  const getLastCodeBlock = (text: string) => {
    const matches = text.match(/```[\s\S]*?```/g);
    if (!matches) return "";
    const lastBlock = matches[matches.length - 1];
    return lastBlock.replace(/```.*\n|```$/g, "").trim();
  };

  const getLongestCodeBlock = (text: string) => {
    const matches = text.match(/```[\s\S]*?```/g);
    if (!matches) return "";
    const longest = matches.reduce((max, current) => (current.length > max.length ? current : max));
    return longest.replace(/```.*\n|```$/g, "").trim();
  };

  const getAllCodeBlocks = (text: string) => {
    const matches = text.match(/```[\s\S]*?```/g);
    if (!matches) return [];
    return matches.map(block => block.replace(/```.*\n|```$/g, "").trim());
  };

  const hasCodeBlock = getLastCodeBlock(response).length > 0;

  const getCodeBlockSummary = (block: string, maxLength: number = 30): string => {
    const firstLine = block.split('\n').find(line => line.trim().length > 0) || '';
    const summary = firstLine.trim();
    return summary.length > maxLength ? summary.slice(0, maxLength) + '...' : summary;
  };

  const actions = [
    <Action
      key="paste"
      title="Paste"
      shortcut={{ modifiers: ["cmd"], key: "v" }}
      icon={Icon.Document}
      onAction={async () => {
        await Clipboard.paste(response);
        await showHUD("已粘贴内容");
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
        await showHUD("已复制到剪贴板");
        closeMainWindow();
      }}
    />,
  ];

  if (hasCodeBlock) {
    const codeBlocks = getAllCodeBlocks(response);

    // 对于普通代码块，只提供复制功能
    codeBlocks.forEach((block) => {
      const summary = getCodeBlockSummary(block);
      actions.unshift(
        <Action
          key={`copyCode${summary}`}
          title={`Copy: ${summary}`}
          icon={Icon.Code}
          onAction={async () => {
            await Clipboard.copy(block);
            await showHUD(`已复制代码块: ${summary}`);
            closeMainWindow();
          }}
        />
      );
    });

    // 使用摘要显示最长代码块的操作
    const longestCodeBlock = getLongestCodeBlock(response);
    const longestBlockSummary = getCodeBlockSummary(longestCodeBlock);

    actions.unshift(
      <Action
        key="pasteLongestCode"
        title={`Paste: ${longestBlockSummary}`}
        icon={Icon.Code}
        shortcut={{ modifiers: ["cmd"], key: ";" }}
        onAction={async () => {
          await Clipboard.copy(longestCodeBlock);
          await Clipboard.paste(longestCodeBlock);
          await showHUD(`已复制并粘贴代码块: ${longestBlockSummary}`);
          closeMainWindow();
        }}
      />,
      <Action
        key="copyLongestCode"
        title={`Copy: ${longestBlockSummary}`}
        icon={Icon.Code}
        shortcut={{ modifiers: ["cmd"], key: "'" }}
        onAction={async () => {
          await Clipboard.copy(longestCodeBlock);
          await showHUD(`已复制代码块: ${longestBlockSummary}`);
          closeMainWindow();
        }}
      />
    );
  }

  return (
    <Detail
      markdown={markdown}
      isLoading={isLoading}
      actions={<ActionPanel>{actions}</ActionPanel>}
      metadata={
        <Detail.Metadata>
          {model && (
            <>
              <Detail.Metadata.Label title="Model" text={model} />
            </>
          )}
          <Detail.Metadata.Label title="Temperature" text={temperature.toString()} />
          <Detail.Metadata.Label title="Max Tokens" text={maxTokens.toString()} />
          <Detail.Metadata.Label title="Top P" text={topP.toString()} />
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label title="Duration" text={`${duration}s`} />
          <Detail.Metadata.Label title="Response Length" text={`${response.length} chars`} />
        </Detail.Metadata>
      }
    />
  );
}
