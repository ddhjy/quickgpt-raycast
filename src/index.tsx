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

const supportedPrefixCMD: { [key: string]: string } = {
  c: "简体中文作答",
  ne: "NO EXPLANATION",
  np: "Do not use plugins and data analysis",
  cot: "Take a deep breath and work on this problem step-by-step",
  w: "Do not use Web Search",
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

function OptionsForm({
  prompt,
  getFormattedContent,
}: {
  prompt: PromptProps;
  getFormattedContent: () => string;
}) {
  const [currentOptions, setCurrentOptions] = useState<{ [key: string]: string }>({});
  const [currentTextInputs, setCurrentTextInputs] = useState<{ [key: string]: string }>({});
  const formattedContentWithOptions = () => contentFormat(getFormattedContent() || "", { ...currentOptions, ...currentTextInputs });
  
  return (
    <Form
      actions={
        <ActionPanel>
          {getPromptActions(formattedContentWithOptions)}
        </ActionPanel>
      }
    >
      {Object.entries(prompt.options || {}).map(([key, values]) => (
        <Form.Dropdown
          key={key}
          id={key}
          title={key}
          value={currentOptions[key] || values[0]}
          onChange={(newValue) => {
            setCurrentOptions({ ...currentOptions, [key]: newValue });
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
          value={currentTextInputs[key] || ""}
          onChange={(newValue) => {
            setCurrentTextInputs({ ...currentTextInputs, [key]: newValue });
          }}
        />
      ))}
    </Form>
  );
}

function buildFormattedPromptContent(prompt: PromptProps, replacements: SpecificReplacements) {
  if (prompt.rawRef) {
    for (const [key, filePath] of Object.entries(prompt.rawRef)) {
      try {
        if (typeof filePath === 'string') {
          const fileContent = fs.readFileSync(filePath, 'utf8');
          const placeholder = `{{${key}}}`;
          prompt.content = prompt.content?.replace(placeholder, fileContent);
        }
      } catch (error) {
        console.error(`错误：读取文件失败: ${filePath}`, error);
      }
    }
  }
  const processedContent = prompt.content ? processActionPrefixCMD(prompt.content, prompt.prefixCMD) : undefined;
  const formattedContent = contentFormat(processedContent || "", replacements);
  return formattedContent;
}

function PromptList({
  prompts: prompts,
  searchMode = false,
  clipboardText = "",
  selectionText = "",
  currentApp = "",
}: {
  prompts: PromptProps[];
  searchMode: boolean;
  clipboardText: string;
  selectionText: string;
  currentApp: string;
}) {
  const [searchText, setSearchText] = useState<string>("");
  const [, forceUpdate] = useState(0);

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
        currentApp={currentApp}
      />
    );
  }

  const activeSearchText = searchMode ? "" : searchText;

  const replacements: SpecificReplacements = { query: activeSearchText, clipboard: clipboardText, selection: selectionText, currentApp: currentApp };

  const promptItems = prompts
    .sort((a, b) => Number(b.pinned) - Number(a.pinned))
    .map((prompt, index) => {
      const formattedTitle = contentFormat(prompt.title || "", replacements);

      // 将 formattedContent 的生成延后
      const getFormattedContent = () => buildFormattedPromptContent(prompt, replacements);

      // 移除在 Input mode 下的筛选辑
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
          title={formattedTitle.replace(/\n/g, " ")}
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
                      currentApp={currentApp}
                    />
                  }
                />
              )}
              {!prompt.subprompts && (
                <>
                  {prompt.options && Object.keys(prompt.options).length > 0 ? (
                    <RaycastAction.Push
                      title="选择参数"
                      icon={Icon.Gear}
                      target={
                        <OptionsForm
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
  const [currentApp, setCurrentApp] = useState("");

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
        const [clipboardText, selectedText, frontmostApplication] = await Promise.all([
          fetchClipboardText(),
          fetchSelectedText(),
          getFrontmostApplication()
        ]);
        setClipboardText(clipboardText);
        setSelectionText(selectedText);
        setCurrentApp(frontmostApplication.name);
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
      currentApp={currentApp}
    />
  );
}