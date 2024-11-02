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
  return (
    <Detail
      markdown={markdown}
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action
            title="Paste Response"
            icon={Icon.Document}
            shortcut={{ modifiers: ["cmd"], key: "return" }}
            onAction={async () => {
              await Clipboard.paste(response);
              closeMainWindow();
            }}
          />
          <Action
            title="Copy Response"
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