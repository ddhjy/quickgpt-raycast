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
  clearSearchBar,
  getSelectedText,
  Form,
  getFrontmostApplication,
} from "@raycast/api";
import pinsManager from "./pinsManager";
import promptManager, { PromptProps } from "./promptManager";
import { contentFormat, SpecificReplacements } from "./contentFormat";
import fs from "fs";
import { match } from "pinyin-pro";
import { getPromptActions } from "./getPromptActions";

const IDENTIFIER_PREFIX = "quickgpt-";
const DEFAULT_ICON = "🔖";

const SUPPORTED_PREFIX_COMMANDS: { [key: string]: string } = {
  c: "简体中文作答",
  ne: "NO EXPLANATION",
  np: "Do not use plugins and data analysis",
  cot: "Take a deep breath and work on this problem step-by-step, first think of a suitable solution, then analyze step by step, and finally draw conclusions based on the analysis",
  ns: "Do not use tool and Web Search",
};

const DEFAULT_PREFIX_COMMANDS = ["ns", "c", "cot"];

/**
 * 应用前缀命令到内容
 * @param content 原始内容
 * @param prefixCommands 前缀命令
 * @returns 处理后的内容
 */
function applyPrefixCommandsToContent(content: string, prefixCommands: string | undefined): string {
  let activePrefixCommands = [...DEFAULT_PREFIX_COMMANDS];
  const prefixes = prefixCommands?.split(",");

  prefixes?.forEach((cmd) => {
    if (cmd.startsWith("!")) {
      activePrefixCommands = activePrefixCommands.filter((c) => c !== cmd.substring(1));
    } else {
      activePrefixCommands.push(cmd);
    }
  });

  activePrefixCommands = Array.from(new Set(activePrefixCommands));

  activePrefixCommands.reverse().forEach((cmd) => {
    const commandText = SUPPORTED_PREFIX_COMMANDS[cmd];
    if (commandText) {
      content = `! ${commandText}\n${content}`;
    }
  });

  return content;
}

/**
 * 获取快速提示
 * @param selectionText 选中的文本
 * @param identifier 目标标识符
 * @returns 快速提示和清理后的选择文本
 */
function getQuickPrompt(selectionText: string, identifier?: string): [PromptProps | undefined, string] {
  let foundPrompt: PromptProps | undefined;
  let cleanedText = selectionText;

  if (identifier) {
    foundPrompt = promptManager.findPrompt(
      (prompt) => `${IDENTIFIER_PREFIX}${prompt.identifier}` === identifier
    );
  } else {
    foundPrompt = promptManager.findPrompt(
      (prompt) =>
        !!prompt.identifier && selectionText.includes(`${IDENTIFIER_PREFIX}${prompt.identifier}`)
    );
    if (foundPrompt?.identifier) {
      cleanedText = selectionText
        .split(`${IDENTIFIER_PREFIX}${foundPrompt.identifier}`)
        .slice(1)
        .join("")
        .trim();
    }
  }

  return [foundPrompt, cleanedText];
}

interface OptionsFormProps {
  prompt: PromptProps;
  getFormattedContent: () => string;
}

function PromptOptionsForm({ prompt, getFormattedContent }: OptionsFormProps) {
  const [selectedOptions, setSelectedOptions] = useState<{ [key: string]: string }>({});
  const [selectedTextInputs, setSelectedTextInputs] = useState<{ [key: string]: string }>({});

  const formattedContent = () =>
    contentFormat(getFormattedContent() || "", { ...selectedOptions, ...selectedTextInputs });

  return (
    <Form
      actions={
        <ActionPanel>
          {getPromptActions(formattedContent)}
        </ActionPanel>
      }
    >
      {Object.entries(prompt.options || {}).map(([key, values]) => (
        <Form.Dropdown
          key={key}
          id={key}
          title={key}
          value={selectedOptions[key] || values[0]}
          onChange={(newValue) => {
            setSelectedOptions({ ...selectedOptions, [key]: newValue });
          }}
        >
          {values.map((value) => (
            <Form.Dropdown.Item key={value} value={value} title={value} />
          ))}
        </Form.Dropdown>
      ))}
      {Object.entries(prompt.textInputs || {}).map(([key, placeholder]) => (
        <Form.TextField
          key={key}
          id={key}
          title={key}
          placeholder={placeholder}
          value={selectedTextInputs[key] || ""}
          onChange={(newValue) => {
            setSelectedTextInputs({ ...selectedTextInputs, [key]: newValue });
          }}
        />
      ))}
    </Form>
  );
}

function buildFormattedPromptContent(prompt: PromptProps, replacements: SpecificReplacements): string {
  if (prompt.rawRef) {
    for (const [key, filePath] of Object.entries(prompt.rawRef)) {
      try {
        if (typeof filePath === 'string') {
          const fileContent = fs.readFileSync(filePath, 'utf8');
          const placeholder = `{{${key}}}`;
          prompt.content = prompt.content?.replace(placeholder, fileContent);
        }
      } catch (error) {
        console.error(`错误: 无法读取文件: ${filePath}`, error);
      }
    }
  }

  const processedContent = prompt.content
    ? applyPrefixCommandsToContent(prompt.content, prompt.prefixCMD)
    : undefined;

  const formattedContent = contentFormat(processedContent || "", replacements);
  return formattedContent;
}

interface PromptListProps {
  prompts: PromptProps[];
  searchMode?: boolean;
  clipboardText: string;
  selectionText: string;
  currentApp: string;
  browserContent: string;
}

function PromptList({
  prompts,
  searchMode = false,
  clipboardText,
  selectionText,
  currentApp,
  browserContent,
}: PromptListProps) {
  const [searchText, setSearchText] = useState<string>("");
  const [, forceUpdate] = useState(0);

  // 过滤提示（仅在搜索模式下）
  if (searchMode && searchText.trim()) {
    prompts = promptManager.getFilteredPrompts((prompt) => {
      return (
        prompt.title.toLowerCase().includes(searchText.trim().toLowerCase()) ||
        !!match(prompt.title, searchText.trim(), { continuous: true })
      );
    });
  }

  // input mode
  if (searchMode && searchText.endsWith(" ")) {
    clearSearchBar({ forceScrollToTop: true });
    return (
      <PromptList
        searchMode={false}
        prompts={prompts}
        clipboardText={clipboardText}
        selectionText={selectionText}
        currentApp={currentApp}
        browserContent={browserContent}
      />
    );
  }

  const activeSearchText = searchMode ? "" : searchText;

  const replacements: SpecificReplacements = {
    input: activeSearchText,
    clipboard: clipboardText,
    selection: selectionText,
    currentApp: currentApp,
    browserContent: browserContent,
  };

  const promptItems = prompts
    .sort((a, b) => Number(b.pinned) - Number(a.pinned))
    .map((prompt, index) => {
      const formattedTitle = contentFormat(prompt.title || "", replacements);

      // 懒加载格式化内容
      const getFormattedContent = () => buildFormattedPromptContent(prompt, replacements);

      // 在输入模式下排除不匹配的提示
      if (
        searchMode &&
        activeSearchText &&
        formattedTitle === prompt.title &&
        !prompt.title.toLowerCase().includes(activeSearchText.toLowerCase()) &&
        !match(prompt.title, activeSearchText, { continuous: true })
      ) {
        return null;
      }

      return (
        <List.Item
          key={index}
          title={formattedTitle.replace(/\n/g, " ")}
          icon={prompt.icon || DEFAULT_ICON}
          accessories={[
            prompt.pinned
              ? { tag: { value: "PIN", color: Color.SecondaryText } }
              : {},
            {
              icon: prompt.subprompts ? Icon.Folder : Icon.Paragraph,
              tooltip:
                prompt.content ||
                prompt.subprompts
                  ?.map((subPrompt, subIndex) => `${subIndex + 1}. ${subPrompt.title} `)
                  .join("\n"),
            },
          ]}
          actions={
            <ActionPanel>
              {prompt.subprompts ? (
                <RaycastAction.Push
                  title="Open"
                  icon={prompt.icon || DEFAULT_ICON}
                  target={
                    <PromptList
                      searchMode={false}
                      prompts={prompt.subprompts}
                      clipboardText={clipboardText}
                      selectionText={selectionText}
                      currentApp={currentApp}
                      browserContent={browserContent}
                    />
                  }
                />
              ) : (
                <>
                  {prompt.options && Object.keys(prompt.options).length > 0 ? (
                    <RaycastAction.Push
                      title="Select Options"
                      icon={Icon.Gear}
                      target={
                        <PromptOptionsForm
                          prompt={prompt}
                          getFormattedContent={getFormattedContent}
                        />
                      }
                    />
                  ) : (
                    getPromptActions(getFormattedContent, prompt.actions)
                  )}
                </>
              )}
              <Action
                title={prompt.pinned ? "Unpin" : "Pin"}
                icon={Icon.Pin}
                onAction={() => {
                  prompt.pinned = !prompt.pinned;
                  prompt.pinned
                    ? pinsManager.pin(prompt.identifier)
                    : pinsManager.unpin(prompt.identifier);
                  forceUpdate(n => n + 1);
                }}
                shortcut={{ modifiers: ["cmd", "shift"], key: "p" }}
              />
              <>
                <RaycastAction.CopyToClipboard
                  title="Copy Identifier"
                  content={`${IDENTIFIER_PREFIX}${prompt.identifier}`}
                  icon={Icon.Document}
                />
                <RaycastAction.CopyToClipboard
                  title="Copy Deeplink"
                  content={`raycast://extensions/ddhjy2012/quickgpt/index?arguments=${encodeURIComponent(
                    JSON.stringify({ target: `${IDENTIFIER_PREFIX}${prompt.identifier}` })
                  )}`}
                  icon={Icon.Link}
                />
              </>
            </ActionPanel>
          }
        />
      );
    });

  return (
    <List
      searchBarPlaceholder={searchMode ? "Search Mode" : "Input Mode"}
      onSearchTextChange={setSearchText}
      filtering={false}
    >
      {promptItems}
    </List>
  );
}

interface ExtendedArguments extends Arguments.Index {
  clipboardText?: string;
  selectionText?: string;
  target?: string;
}

export default function MainCommand(props: LaunchProps<{ arguments: ExtendedArguments }>) {
  const {
    selectionText: initialSelectionText,
    clipboardText: initialClipboardText,
    target,
  } = props.arguments;

  const [clipboardText, setClipboardText] = useState(initialClipboardText || "");
  const [selectionText, setSelectionText] = useState(initialSelectionText || "");
  const [currentApp, setCurrentApp] = useState("");
  const [browserContent, setBrowserContent] = useState("");

  useEffect(() => {
    const fetchClipboardText = async (): Promise<string> => {
      if (initialClipboardText) return initialClipboardText;
      try {
        const text = await Clipboard.readText();
        return text || "";
      } catch {
        console.info("Failed to read clipboard text.");
        return "";
      }
    };

    const fetchSelectedText = async (): Promise<string> => {
      if (initialSelectionText) return initialSelectionText;
      try {
        const text = await getSelectedText();
        return text || "";
      } catch {
        console.info("Failed to read selected text.");
        return "";
      }
    };

    const fetchFrontmostApp = async (): Promise<string> => {
      try {
        const app = await getFrontmostApplication();
        return app.name;
      } catch {
        console.info("Failed to get frontmost application.");
        return "";
      }
    };

    const fetchBrowserContent = async (): Promise<string> => {
      try {
        const content = await Clipboard.readText(); // 假设从剪贴板获取浏览器内容
        return content || "";
      } catch {
        console.info("Failed to read browser content.");
        return "";
      }
    };

    const initialize = async () => {
      if (!target) {
        const [fetchedClipboardText, fetchedSelectedText, frontmostApp, fetchedBrowserContent] = await Promise.all([
          fetchClipboardText(),
          fetchSelectedText(),
          fetchFrontmostApp(),
          fetchBrowserContent(),
        ]);
        setClipboardText(fetchedClipboardText);
        setSelectionText(fetchedSelectedText);
        setCurrentApp(frontmostApp);
        setBrowserContent(fetchedBrowserContent);
      } else {
        const fetchedClipboardText = await fetchClipboardText();
        setClipboardText(fetchedClipboardText);
      }
    };

    initialize();
  }, [initialClipboardText, initialSelectionText, target]);

  const pinnedIdentifiers = pinsManager.pinnedIdentifiers();
  const pinnedPrompts = promptManager.getFilteredPrompts(prompt =>
    pinnedIdentifiers.has(prompt.identifier)
  );

  const [quickPrompt, cleanedSelectionText] = getQuickPrompt(selectionText, target);
  const availablePrompts = quickPrompt?.subprompts
    ? quickPrompt.subprompts
    : quickPrompt
      ? [quickPrompt]
      : [...pinnedPrompts, ...promptManager.getRootPrompts()];

  const effectiveSelectionText = quickPrompt ? cleanedSelectionText : selectionText;

  const uniquePrompts = Array.from(
    new Set(availablePrompts.map(prompt => prompt.identifier || prompt.title))
  )
    .map(unique => availablePrompts.find(prompt => prompt.identifier === unique || prompt.title === unique))
    .filter(Boolean) as PromptProps[];

  return (
    <PromptList
      searchMode={!quickPrompt}
      prompts={uniquePrompts}
      clipboardText={clipboardText}
      selectionText={effectiveSelectionText}
      currentApp={currentApp}
      browserContent={browserContent}
    />
  );
}