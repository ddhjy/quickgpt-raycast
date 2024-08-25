import { useState, useEffect } from "react";
import {
  List,
  ActionPanel,
  Action as RaycastAction,
  Clipboard,
  LaunchProps,
  Icon,
  Action,
  Color,
  closeMainWindow,
  getPreferenceValues,
  clearSearchBar,
  getSelectedText,
  Form,
  useNavigation,
} from "@raycast/api";
import { runAppleScript } from "@raycast/utils";
import pinsManager from "./pinsManager";
import promptManager, { PromptProps } from "./promptManager";
import { contentFormat } from "./contentFormat";
import fs from "fs";
import path from "path";
import { match } from "pinyin-pro";
import React from "react";
import actionManager from "./actionManager";

const IDENTIFIER_PREFIX = "quickgpt-";
const DEFAULT_ICON = "🔖";

const supportedPrefixCMD: { [key: string]: string } = {
  c: "简体中文作答",
  ne: "NO EXPLANATION",
  np: "Do not use plugins and data analysis",
  cot: "Take a deep breath and work on this problem step-by-step",
};

const defaultPrefixCMD = ["c", "cot"];

function processActionPrefixCMD(content: string, actionPrefixCMD: string | undefined) {
  let currentPrefixCMD = defaultPrefixCMD.slice();
  const actionPrefixes = actionPrefixCMD?.split(",");
  actionPrefixes?.forEach((cmd) => {
    cmd.startsWith("!")
      ? (currentPrefixCMD = currentPrefixCMD.filter((c) => c !== cmd.substring(1)))
      : currentPrefixCMD.push(cmd);
  });
  currentPrefixCMD = [...new Set(currentPrefixCMD)];

  currentPrefixCMD.reverse().forEach((cmd) => {
    content = `! ${supportedPrefixCMD[cmd]}\n` + content;
  });

  return content;
}

function findQuickPrompt(selectionText: string, identifier?: string): [PromptProps | undefined, string] {
  let foundAction;
  let cleanedText = selectionText;

  if (identifier) {
    foundAction = promptManager.findPrompt((action) => `${IDENTIFIER_PREFIX}${action.identifier}` === identifier);
  } else {
    foundAction = promptManager.findPrompt(
      (action) => (action.identifier && selectionText.includes(IDENTIFIER_PREFIX + action.identifier)) || false
    );
    if (foundAction?.identifier) {
      cleanedText = selectionText
        .split(IDENTIFIER_PREFIX + foundAction.identifier)
        .slice(1)
        .join("")
        .trim();
    }
  }

  return [foundAction, cleanedText];
}

function getPromptActions(formattedDescription: string) {
  const preferences = getPreferenceValues<Preferences>();
  const createRaycastOpenInBrowser = (
    title: string | undefined,
    url: string,
    formattedDescription: string | number | Clipboard.Content
  ) => <RaycastAction.OpenInBrowser title={title} url={url} onOpen={() => Clipboard.copy(formattedDescription)} />;

  const action = [
    {
      name: "openURL",
      condition: preferences.openURL,
      action: createRaycastOpenInBrowser("Open URL", preferences.openURL ?? "", formattedDescription),
    },
    ...[
      path.join(__dirname, "assets/ChatGPT.applescript"),
      preferences.runScript1,
      preferences.runScript2,
      preferences.runScript3,
      preferences.runScript4,
      preferences.runScript5,
      preferences.runScript6,
      preferences.runScript7,
      preferences.runScript8,
      preferences.runScript9,
    ].map((script, index) => {
      return {
        name: `runScript${index}`,
        condition: script,
        action: (
          <Action
            title={`Run ${path.basename(script ?? "", path.extname(script ?? ""))}`}
            key={`runScript${index + 1}`}
            icon={Icon.Terminal}
            onAction={() => {
              closeMainWindow();
              Clipboard.copy(formattedDescription);
              const myScript = fs.readFileSync(script ?? "", "utf8");
              runAppleScript(myScript);
            }}
          />
        ),
      };
    }),
    {
      name: "copyToClipboard",
      condition: true,
      action: (
        <RaycastAction.CopyToClipboard
          title="Copy"
          content={formattedDescription}
          shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
        />
      ),
    },
  ];

  return (
    <>
      {action
        .sort((a, b) => {
          const lastSelectedAction = actionManager.getLastSelectedAction();
          if (a.name === preferences.primaryAction) return -1;
          if (b.name === preferences.primaryAction) return 1;
          if (a.name === lastSelectedAction) return -1;
          if (b.name === lastSelectedAction) return 1;
          if (a.name === preferences.secondaryAction && b.name !== preferences.primaryAction) return -1;
          if (b.name === preferences.secondaryAction && a.name !== preferences.primaryAction) return 1;
          return 0;
        })
        .map((option, index) =>
          option.condition && React.cloneElement(option.action, {
            key: index,
            onAction: () => {
              actionManager.setLastSelectedAction(option.name);
              if (option.action.props.onAction) {
                option.action.props.onAction();
              }
            }
          })
        )}
    </>
  );
}

function OptionsForm({ prompt, selectedOptions, onSubmit }: { prompt: PromptProps; selectedOptions: { [key: string]: string }; onSubmit: (options: { [key: string]: string }) => void }) {
  const [options, setOptions] = useState(() => {
    const defaultOptions: { [key: string]: string } = {};
    Object.entries(prompt.options || {}).forEach(([key, values]) => {
      defaultOptions[key] = values[0] || '';
    });
    return { ...defaultOptions, ...selectedOptions };
  });

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="确认选项并执行"
            onSubmit={() => onSubmit(options)}
          />
        </ActionPanel>
      }
    >
      {Object.entries(prompt.options || {}).map(([key, values]) => (
        <Form.Dropdown key={key} id={key} title={key} value={options[key]} onChange={(newValue) => setOptions({ ...options, [key]: newValue })}>
          {values.map((value) => (
            <Form.Dropdown.Item key={value} value={value} title={value} />
          ))}
        </Form.Dropdown>
      ))}
    </Form>
  );
}

function PromptList({
  prompts: prompts,
  searchMode = false,
  clipboardText = "",
  selectionText = "",
}: {
  prompts: PromptProps[];
  searchMode: boolean;
  clipboardText: string;
  selectionText: string;
}) {
  const [searchText, setSearchText] = useState<string>("");
  const [, forceUpdate] = useState(0);
  const [selectedOptions, setSelectedOptions] = useState<{ [key: string]: string }>({});
  const { push } = useNavigation();

  // 只在搜索模式下进行筛选
  if (searchMode && searchText.length > 0) {
    prompts = promptManager.getFilteredPrompts((prompt) => {
      return (
        prompt.title.toLowerCase().includes(searchText.trim().toLowerCase()) ||
        match(prompt.title, searchText.trim(), { continuous: true })
      );
    });
  }

  if (searchMode && searchText && searchText.slice(-1) === " ") {
    clearSearchBar({ forceScrollToTop: true });
    return (
      <PromptList
        searchMode={false}
        prompts={prompts}
        clipboardText={clipboardText}
        selectionText={selectionText}
      />
    );
  }

  const activeSearchText = searchMode ? "" : searchText;
  const replacements = { query: activeSearchText, clipboard: clipboardText, selection: selectionText };

  const promptItems = prompts
    .sort((a, b) => Number(b.pinned) - Number(a.pinned))
    .map((prompt, index) => {
      const [formattedTitle] = contentFormat(prompt.title || "", replacements);

      const promptTitle = formattedTitle;

      // 移除在 Input mode 下的筛选逻辑
      if (searchMode && activeSearchText &&
          formattedTitle == prompt.title &&
          prompt.title.toLowerCase().indexOf(activeSearchText.toLowerCase()) == -1 &&
          !match(prompt.title, activeSearchText, { continuous: true })
      ) {
        return null;
      }

      return (
        <List.Item
          key={index}
          title={promptTitle.replace(/\n/g, " ")}
          icon={prompt.icon ?? DEFAULT_ICON}
          accessories={[
            prompt.pinned ? { tag: { value: "PIN", color: Color.SecondaryText } } : {},
            {
              icon: prompt.subprompts ? Icon.Folder : Icon.Paragraph,
              tooltip:
                prompt.content ??
                prompt.subprompts?.map((subaction, index) => `${index + 1}. ${subaction.title} `).join("\n"),
            },
          ]}
          actions={
            <ActionPanel>
              {prompt.subprompts && (
                <RaycastAction.Push
                  title="Open"
                  icon={prompt.icon ?? DEFAULT_ICON}
                  target={
                    <PromptList
                      searchMode={false}
                      prompts={prompt.subprompts}
                      clipboardText={clipboardText}
                      selectionText={selectionText}
                    />
                  }
                />
              )}
              {!prompt.subprompts && (
                <Action
                  title="Execute"
                  onAction={() => {
                    if (prompt.options && Object.keys(prompt.options).length > 0) {
                      push(
                        <OptionsForm
                          prompt={prompt}
                          selectedOptions={selectedOptions}
                          onSubmit={(options) => {
                            console.log("options", options);
                            setSelectedOptions(options);
                            executePrompt(prompt, options);
                          }}
                        />
                      );
                    } else {
                      executePrompt(prompt, selectedOptions);
                    }
                  }}
                />
              )}
              {
                <Action
                  title={prompt.pinned ? "Unpin" : "Pin"}
                  icon={Icon.Pin}
                  onAction={() => {
                    prompt.pinned = !prompt.pinned;
                    prompt.pinned ? pinsManager.pin(prompt.identifier) : pinsManager.unpin(prompt.identifier);
                    forceUpdate((n) => n + 1);
                  }}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "p" }}
                />
              }
              {
                <>
                  <RaycastAction.CopyToClipboard
                    title="Copy Identifier"
                    content={IDENTIFIER_PREFIX + prompt.identifier}
                    icon={Icon.Document}
                  />
                  <RaycastAction.CopyToClipboard
                    title="Copy Deeplink"
                    content={`raycast://extensions/ddhjy2012/quickgpt/index?arguments=${encodeURIComponent(
                      JSON.stringify({ target: IDENTIFIER_PREFIX + prompt.identifier })
                    )}`}
                    icon={Icon.Link}
                  />
                </>
              }
            </ActionPanel>
          }
        />
      );
    });

  function executePrompt(prompt: PromptProps, options: { [key: string]: string }) {
    if (prompt.rawRef) {
      for (const [key, filePath] of Object.entries(prompt.rawRef)) {
        try {
          if (typeof filePath === 'string') {
            const fileContent = fs.readFileSync(filePath, 'utf8');
            const placeholder = `{{${key}}}`;
            prompt.content = prompt.content?.replace(placeholder, fileContent);
          }
        } catch (error) {
          console.error(`Error reading file: ${filePath}`, error);
        }
      }
    }
    const content = prompt.content ? processActionPrefixCMD(prompt.content, prompt.prefixCMD) : undefined;
    const [formattedDescription] = contentFormat(content || "", { ...replacements, ...options });
    const actions = getPromptActions(formattedDescription);
    const firstActionWithOnAction = actions.props.children.find((action: React.ReactElement) => action.props.onAction);
    if (firstActionWithOnAction) {
      firstActionWithOnAction.props.onAction();
    }
  }

  return (
    <List
      searchBarPlaceholder={searchMode ? "Search mode" : "Input mode"}
      onSearchTextChange={setSearchText}
      filtering={false}
    >
      {promptItems}
    </List>
  );
}

interface ExtendedIndex extends Arguments.Index {
  clipboardText?: string;
  selectionText?: string;
  target?: string;
}

export default function MainCommand(props: LaunchProps<{ arguments: ExtendedIndex }>) {
  const {
    selectionText: argumentSelectionText,
    clipboardText: argumentClipboardText,
    target: target,
  } = props.arguments;
  const [clipboardText, setClipboardText] = useState(argumentClipboardText ?? "");
  const [selectionText, setSelectionText] = useState(argumentSelectionText ?? "");

  useEffect(() => {
    const fetchClipboardText = async () => {
      if (!argumentClipboardText || argumentClipboardText.length === 0) {
        try {
          const text = await Clipboard.readText() ?? "";
          return text;
        } catch (_) {
          console.error("剪贴板文本读取失败，返回空字符串");
          return "";
        }
      }
      return argumentClipboardText;
    };

    const fetchSelectedText = async () => {
      if (!argumentSelectionText || argumentSelectionText.length === 0) {
        try {
          const text = await getSelectedText();
          // console.log("选中的文本:", text);
          return text;
        } catch (_) {
          console.error("选中文本读取失败，返回空字符串");
          return "";
        }
      }
      return argumentSelectionText;
    };

    if (!target || target.length === 0) {
      const timer = setTimeout(async () => {
        const [clipboardText, selectedText] = await Promise.all([
          fetchClipboardText(),
          fetchSelectedText()
        ]);
        setClipboardText(clipboardText);
        setSelectionText(selectedText);
      }, 10);

      return () => clearTimeout(timer);
    } else {
      fetchClipboardText().then(setClipboardText);
    }
  }, []);

  const pinnedIdentifiers = pinsManager.pinnedIdentifiers();
  const pinnedActions = promptManager.getFilteredPrompts((action) => {
    action.pinned = pinnedIdentifiers.has(action.identifier);
    return action.pinned;
  });

  const [quickAction, cleanSelectionText] = findQuickPrompt(selectionText, target);
  const actionsForUse = quickAction?.subprompts ? quickAction.subprompts : (quickAction ? [quickAction] : [...pinnedActions, ...promptManager.getRootPrompts()]);
  const selectionTextForUse = quickAction ? cleanSelectionText : selectionText;
  const uniqueFilteredActions = Array.from(new Set(actionsForUse.map((action) => action.identifier || action.title)))
    .map((unique) => actionsForUse.find((action) => action.identifier === unique || action.title === unique))
    .filter(Boolean) as PromptProps[];

  return (
    <PromptList
      searchMode={quickAction ? false : true}
      prompts={uniqueFilteredActions}
      clipboardText={clipboardText}
      selectionText={selectionTextForUse}
    />
  );
}