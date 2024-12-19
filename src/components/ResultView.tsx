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

  const hasCodeBlock = getLastCodeBlock(response).length > 0;

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
    actions.unshift(
      <Action
        key="pasteLongestCode"
        title="Paste Longest Code Block"
        icon={Icon.Code}
        shortcut={{ modifiers: ["cmd"], key: ";" }}
        onAction={async () => {
          const longestCodeBlock = getLongestCodeBlock(response);
          await Clipboard.paste(longestCodeBlock);
          await showHUD("已粘贴最长代码块");
          closeMainWindow();
        }}
      />,
      <Action
        key="copyLongestCode"
        title="Copy Longest Code Block"
        icon={Icon.Code}
        shortcut={{ modifiers: ["cmd"], key: "'" }}
        onAction={async () => {
          const longestCodeBlock = getLongestCodeBlock(response);
          await Clipboard.copy(longestCodeBlock);
          await showHUD("已复制最长代码块到剪贴板");
          closeMainWindow();
        }}
      />,
      <Action
        key="pasteCode"
        title="Paste Code Block"
        icon={Icon.Code}
        shortcut={{ modifiers: ["cmd", "shift"], key: ";" }}
        onAction={async () => {
          const lastCodeBlock = getLastCodeBlock(response);
          await Clipboard.paste(lastCodeBlock);
          await showHUD("已粘贴代码块");
          closeMainWindow();
        }}
      />,
      <Action
        key="copyCode"
        title="Copy Code Block"
        icon={Icon.Code}
        shortcut={{ modifiers: ["cmd", "shift"], key: "'" }}
        onAction={async () => {
          const lastCodeBlock = getLastCodeBlock(response);
          await Clipboard.copy(lastCodeBlock);
          await showHUD("已复制代码块到剪贴板");
          closeMainWindow();
        }}
      />,
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
