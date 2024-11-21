import { useState, useEffect } from "react";
import {
  List,
  ActionPanel,
  Action as RaycastAction,
  Icon,
  Action,
  Color,
  clearSearchBar,
  Clipboard,
  getSelectedText,
  getFrontmostApplication,
  BrowserExtension,
  getSelectedFinderItems,
  Form,
} from "@raycast/api";
import pinsManager from "./pinsManager";
import promptManager, { PromptProps } from "./promptManager";
import { contentFormat, resolvePlaceholders, SpecificReplacements } from "./contentFormat";
import { match } from "pinyin-pro";
import { getPromptActions } from "./getPromptActions";
import fs from "fs";
import path from "path";
import fsPromises from "fs/promises";

const IDENTIFIER_PREFIX = "quickgpt-";
const DEFAULT_ICON = "🔖";
const BINARY_MEDIA_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".bmp",
  ".tiff",
  ".mp3",
  ".wav",
  ".flac",
  ".mp4",
  ".avi",
  ".mkv",
  ".exe",
  ".dll",
  ".bin",
  ".iso",
  ".zip",
  ".rar",
  ".xcodeproj",
  ".xcworkspace",
  ".tiktoken",
]);

const IGNORED_PATTERNS = [
  /^(node_modules|dist|build|coverage|tmp|logs|public|assets|vendor)$/,
  /^\..+/,
  /^(package-lock\.json|yarn\.lock)$/,
  /^\.vscode$/,
  /^\.idea$/,
  /^\.env(\.local)?$/,
  /^\.cache$/,
  /^(bower_components|jspm_packages)$/,
  /^\.DS_Store$/,
];

const placeholderIcons: { [key: string]: Icon } = {
  input: Icon.TextInput,
  clipboard: Icon.Clipboard,
  selection: Icon.Text,
  currentApp: Icon.Window,
  browserContent: Icon.Globe,
};

const SUPPORTED_PREFIX_COMMANDS: { [key: string]: string } = {
  c: "简体中文作答",
  ne: "NO EXPLANATION",
  np: "Do not use plugins and data analysis",
  cot: "",
  ns: "Do not use tool and Web Search",
};

const DEFAULT_PREFIX_COMMANDS = ["c"];

interface PromptListProps {
  prompts?: PromptProps[];
  searchMode?: boolean;
  clipboardText?: string;
  selectionText?: string;
  currentApp?: string;
  browserContent?: string;
}

export default function PromptList(props: PromptListProps) {
  const [searchText, setSearchText] = useState<string>("");
  const [, forceUpdate] = useState(0);

  const [clipboardText, setClipboardText] = useState(props.clipboardText ?? "");
  const [selectionText, setSelectionText] = useState(props.selectionText ?? "");
  const [currentApp, setCurrentApp] = useState(props.currentApp ?? "");
  const [browserContent, setBrowserContent] = useState(props.browserContent ?? "");
  const [prompts, setPrompts] = useState<PromptProps[]>(props.prompts ?? []);

  const [quickPrompt, cleanedSelectionText] = getQuickPrompt(selectionText);
  const availablePrompts = quickPrompt?.subprompts
    ? quickPrompt.subprompts
    : quickPrompt
    ? [quickPrompt]
    : [...getPinnedPrompts(), ...promptManager.getRootPrompts()];

  const effectiveSelectionText = quickPrompt ? cleanedSelectionText : selectionText;

  useEffect(() => {
    if (!props.prompts) {
      setPrompts(availablePrompts);
    }
  }, [quickPrompt, selectionText]);

  useEffect(() => {
    const fetchData = async () => {
      const [fetchedClipboardText, fetchedSelectedText, frontmostApp, fetchedBrowserContent] =
        await Promise.all([
          fetchClipboardText(),
          fetchSelectedText(),
          fetchFrontmostApp(),
          fetchBrowserContent(),
        ]);

      setClipboardText(fetchedClipboardText);
      setSelectionText(fetchedSelectedText);
      setCurrentApp(frontmostApp);
      setBrowserContent(fetchedBrowserContent);
    };

    fetchData();
  }, []);

  const searchMode = props.searchMode ?? !quickPrompt;

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

  let filteredPrompts = prompts;

  if (searchMode && searchText.length > 0) {
    filteredPrompts = promptManager.getFilteredPrompts((prompt) => {
      return (
        prompt.title.toLowerCase().includes(searchText.trim().toLowerCase()) ||
        !!match(prompt.title, searchText.trim(), { continuous: true })
      );
    });
  }

  const activeSearchText = searchMode ? "" : searchText;

  const replacements: SpecificReplacements = {
    input: activeSearchText,
    clipboard: clipboardText,
    selection: effectiveSelectionText,
    currentApp: currentApp,
    browserContent: browserContent,
  };

  const promptItems = filteredPrompts
    .sort((a, b) => Number(b.pinned) - Number(a.pinned))
    .map((prompt, index) => {
      const title = contentFormat(prompt.title || "", replacements);
      const formattedTitle =
        searchMode && prompt.path
          ? `${contentFormat(prompt.path, replacements).replace(title, "")}${title}`.trim()
          : title;

      // 延迟生成格式化后的内容
      const getFormattedContent = () => buildFormattedPromptContent(prompt, replacements);

      // 如果在输入模式下，排除不匹配搜索条件的提示
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
          icon={prompt.icon ?? DEFAULT_ICON}
          accessories={[
            prompt.pinned
              ? { tag: { value: "PIN", color: Color.SecondaryText } }
              : {},
            ...getPlaceholderIcons(prompt.content, replacements).map((accessory, i, arr) =>
              i === arr.length - 1
                ? {
                    ...accessory,
                    tooltip:
                      prompt.content ??
                      prompt.subprompts
                        ?.map((subPrompt, subIndex) => `${subIndex + 1}. ${subPrompt.title} `)
                        .join("\n"),
                  }
                : accessory
            ),
            // 如果没有任何占位符图标，则显示一个带有 tooltip 的文件夹/段落图标
            ...(getPlaceholderIcons(prompt.content, replacements).length === 0
              ? [
                  {
                    icon: prompt.subprompts ? Icon.Folder : Icon.Paragraph,
                    tooltip:
                      prompt.content ??
                      prompt.subprompts
                        ?.map((subPrompt, subIndex) => `${subIndex + 1}. ${subPrompt.title} `)
                        .join("\n"),
                  },
                ]
              : []),
          ]}
          actions={
            <ActionPanel>
              {prompt.subprompts ? (
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
                    getPromptActions(getFormattedContent, prompt.actions, prompt)
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
                  forceUpdate((n) => n + 1);
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
                    JSON.stringify({
                      target: `${IDENTIFIER_PREFIX}${prompt.identifier}`,
                      activateOCR: "true",
                    })
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
      searchBarPlaceholder={searchMode ? "Search" : "Input"}
      onSearchTextChange={setSearchText}
      filtering={false}
    >
      {promptItems}
    </List>
  );
}

function getQuickPrompt(selectionText: string, identifier?: string): [PromptProps | undefined, string] {
  let foundPrompt;
  let cleanedText = selectionText;

  if (identifier) {
    foundPrompt = promptManager.findPrompt(
      (prompt) => `${IDENTIFIER_PREFIX}${prompt.identifier}` === identifier
    );
  } else {
    foundPrompt = promptManager.findPrompt(
      (prompt) =>
        !!prompt.identifier &&
        selectionText.includes(`${IDENTIFIER_PREFIX}${prompt.identifier}`)
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

function getPinnedPrompts(): PromptProps[] {
  const pinnedIdentifiers = pinsManager.pinnedIdentifiers();
  return promptManager.getFilteredPrompts((prompt) => {
    prompt.pinned = pinnedIdentifiers.has(prompt.identifier);
    return prompt.pinned;
  });
}

function buildFormattedPromptContent(prompt: PromptProps, replacements: SpecificReplacements): string {
  if (prompt.rawRef) {
    for (const [key, filePath] of Object.entries(prompt.rawRef)) {
      try {
        if (typeof filePath === "string") {
          const fileContent = fs.readFileSync(filePath, "utf8");
          const placeholder = `{{${key}}}`;
          prompt.content = prompt.content?.replace(placeholder, fileContent);
        }
      } catch (error) {
        console.error(`Error: Failed to read file: ${filePath}`, error);
      }
    }
  }

  const processedContent = prompt.content
    ? applyPrefixCommandsToContent(prompt.content, prompt.prefixCMD)
    : undefined;

  const formattedContent = contentFormat(processedContent || "", replacements);
  return formattedContent;
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
          {getPromptActions(formattedContent, prompt.actions, prompt)}
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

function applyPrefixCommandsToContent(content: string, prefixCommands: string | undefined): string {
  // 如果 prefixCommands 包含 "none"，直接返回原始内容
  if (prefixCommands?.includes("none")) {
    return content;
  }

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
    content = `! ${SUPPORTED_PREFIX_COMMANDS[cmd]}\n` + content;
  });

  return content;
}

function getPlaceholderIcons(
  content: string | undefined,
  replacements: SpecificReplacements
): List.Item.Accessory[] {
  if (!content) return [];

  const usedPlaceholders = resolvePlaceholders(content, replacements);

  const placeholderIconsArray: List.Item.Accessory[] = [];
  usedPlaceholders.forEach((placeholder) => {
    const icon = placeholderIcons[placeholder];
    if (icon) {
      placeholderIconsArray.push({ icon });
    }
  });

  return placeholderIconsArray;
}

async function fetchClipboardText(): Promise<string> {
  try {
    const text = await Clipboard.readText();
    return text ?? "";
  } catch (error) {
    console.info("Failed to read clipboard text. Returning empty string.", error);
    return "";
  }
}

async function fetchSelectedText(): Promise<string> {
  try {
    const selectedItems = await getSelectedFinderItems();
    if (selectedItems.length > 0) {
      let content = "";
      for (const item of selectedItems) {
        const itemPath = item.path;
        const stats = await fsPromises.stat(itemPath);

        if (stats.isFile()) {
          if (!isBinaryOrMediaFile(itemPath)) {
            const fileContent = await fsPromises.readFile(itemPath, "utf-8");
            content += `File: ${path.basename(itemPath)}\n${fileContent}\n\n`;
          } else {
            content += `File: ${path.basename(itemPath)} (binary or media file, content ignored)\n\n`;
          }
        } else if (stats.isDirectory()) {
          content += await readDirectoryContents(itemPath);
        }
      }
      return content;
    }
  } catch (finderError) {
    // 继续执行
  }

  try {
    const text = await getSelectedText();
    if (text) {
      return text;
    }
    return "";
  } catch (error) {
    console.error("Error in fetchSelectedText:", error);
    return "";
  }
}

async function fetchFrontmostApp(): Promise<string> {
  const app = await getFrontmostApplication();
  return app.name;
}

async function fetchBrowserContent(): Promise<string> {
  try {
    const content = await BrowserExtension.getContent({ format: "markdown" });
    return content;
  } catch (error) {
    console.info("Failed to fetch browser content:", error);
    return "";
  }
}

const isBinaryOrMediaFile = (fileName: string): boolean => {
  const ext = path.extname(fileName).toLowerCase();
  return BINARY_MEDIA_EXTENSIONS.has(ext);
};

const isIgnoredItem = (itemName: string): boolean => {
  return IGNORED_PATTERNS.some((pattern) => pattern.test(itemName));
};

const readDirectoryContents = async (
  dirPath: string,
  basePath: string = ""
): Promise<string> => {
  let content = "";
  const items = await fsPromises.readdir(dirPath, { withFileTypes: true });

  for (const item of items) {
    const itemName = item.name;
    const itemPath = path.join(dirPath, itemName);
    const relativePath = path.join(basePath, itemName);

    if (isIgnoredItem(itemName) || isBinaryOrMediaFile(itemName)) {
      content += `File: ${relativePath} (content ignored)\n\n`;
    } else if (item.isDirectory()) {
      content += await readDirectoryContents(itemPath, relativePath);
    } else {
      try {
        const fileContent = await fsPromises.readFile(itemPath, "utf-8");
        content += `File: ${relativePath}\n${fileContent}\n\n`;
      } catch {
        content += `File: ${relativePath} (read failed)\n\n`;
      }
    }
  }

  return content;
};