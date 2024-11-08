import { Detail, ActionPanel, Action, Icon, Clipboard, closeMainWindow } from "@raycast/api";
import { useState } from "react";

interface ResultViewProps {
  response: string;
  duration: string;
  isLoading: boolean;
}

export function ResultView({response, duration }: ResultViewProps) {
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

  return (
    <Detail
      markdown={markdown}
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action
            title="Paste Last Code Block"
            icon={Icon.Code}
            shortcut={{ modifiers: ["cmd", "shift"], key: "return" }}
            onAction={async () => {
              const lastCodeBlock = getLastCodeBlock(response);
              if (lastCodeBlock) {
                await Clipboard.paste(lastCodeBlock);
                closeMainWindow();
              }
            }}
          />
          <Action
            title="Paste"
            icon={Icon.Document}
            shortcut={{ modifiers: ["cmd"], key: "return" }}
            onAction={async () => {
              await Clipboard.paste(response);
              closeMainWindow();
            }}
          />
          <Action
            title="Copy"
            icon={Icon.Clipboard}
            onAction={async () => {
              await Clipboard.copy(response);
              closeMainWindow();
            }}
          />
        </ActionPanel>
      }
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.Label title="Duration" text={`${duration}s`} />
          <Detail.Metadata.Separator />
          <Detail.Metadata.Label title="Response Length" text={`${response.length} chars`} />
        </Detail.Metadata>
      }
    />
  );
}