import { useState } from "react";
import { Action, ActionPanel, Clipboard, Icon, List, Navigation, showToast, Toast, useNavigation } from "@raycast/api";
import inputHistoryStore from "../stores/input-history-store";

const CLIPBOARD_HISTORY_SIZE = 6;

/** Lists earlier `{{input}}` values so one can be put back into the search bar. */
export function InputHistoryList({ onSelect }: { onSelect: (input: string) => void }) {
  const { pop } = useNavigation();
  const [history, setHistory] = useState(() => inputHistoryStore.getHistory());

  return (
    <List>
      {history.map((item, index) => (
        <List.Item
          key={index}
          title={item}
          actions={
            <ActionPanel>
              <Action
                title="Use This Input"
                onAction={() => {
                  pop();
                  onSelect(item);
                }}
              />
              <Action
                title="Delete"
                style={Action.Style.Destructive}
                onAction={() => {
                  inputHistoryStore.removeFromHistory(item);
                  setHistory(inputHistoryStore.getHistory());
                }}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

/** Pushes a list of the most recent clipboard entries so an older one can be copied again. */
export async function showClipboardHistory(navigation: Navigation): Promise<void> {
  try {
    const clipboardHistory: string[] = [];

    for (let offset = 0; offset < CLIPBOARD_HISTORY_SIZE; offset++) {
      try {
        const text = await Clipboard.readText({ offset });
        if (text) {
          clipboardHistory.push(text);
        }
      } catch {
        break;
      }
    }

    if (clipboardHistory.length === 0) {
      await showToast({ style: Toast.Style.Failure, title: "Clipboard is empty" });
      return;
    }

    navigation.push(
      <List>
        <List.Section title="Clipboard History" subtitle={`${clipboardHistory.length} items`}>
          {clipboardHistory.map((text, index) => (
            <List.Item
              key={index}
              title={text.length > 100 ? text.substring(0, 100) + "..." : text}
              accessories={[{ text: index === 0 ? "Current" : "" }]}
              actions={
                <ActionPanel>
                  <Action
                    title="Copy to Clipboard"
                    icon={Icon.Clipboard}
                    onAction={async () => {
                      await Clipboard.copy(text);
                      navigation.pop();
                      await showToast({ style: Toast.Style.Success, title: "Copied to clipboard" });
                    }}
                  />
                  <Action.CopyToClipboard title="Copy Text" content={text} />
                </ActionPanel>
              }
            />
          ))}
        </List.Section>
      </List>,
    );
  } catch (error) {
    console.error("Failed to read clipboard history:", error);
    await showToast({ style: Toast.Style.Failure, title: "Couldn't read clipboard", message: String(error) });
  }
}
