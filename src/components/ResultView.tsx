import { Detail, ActionPanel, Action, Icon, Clipboard, closeMainWindow } from "@raycast/api";
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

export function ResultView({ response, duration, model, temperature = 0.7, maxTokens = 4096, topP = 0.95 }: ResultViewProps) {
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
    const longest = matches.reduce((max, current) => 
      current.length > max.length ? current : max
    );
    return longest.replace(/```.*\n|```$/g, "").trim();
  };

  const hasCodeBlock = getLastCodeBlock(response).length > 0;
  
  const actions = [
    // 基础操作
    <Action
      key="paste"
      title="Paste"
      icon={Icon.Document}
      shortcut={{ modifiers: ["cmd"], key: "return" }}
      onAction={async () => {
        await Clipboard.paste(response);
        closeMainWindow();
      }}
    />,
    <Action
      key="copy"
      title="Copy"
      icon={Icon.Clipboard}
      onAction={async () => {
        await Clipboard.copy(response);
        closeMainWindow();
      }}
    />,
  ];

  // 如果有代码块，将代码块粘贴操作插入到数组开头
  if (hasCodeBlock) {
    actions.unshift(
      <Action
        key="pasteLongestCode"
        title="Paste Longest Code Block"
        icon={Icon.Code}
        shortcut={{ modifiers: ["cmd", "opt"], key: "return" }}
        onAction={async () => {
          const longestCodeBlock = getLongestCodeBlock(response);
          await Clipboard.paste(longestCodeBlock);
          closeMainWindow();
        }}
      />,
      <Action
        key="pasteCode"
        title="Paste Code Block"
        icon={Icon.Code}
        shortcut={{ modifiers: ["cmd", "shift"], key: "return" }}
        onAction={async () => {
          const lastCodeBlock = getLastCodeBlock(response);
          await Clipboard.paste(lastCodeBlock);
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