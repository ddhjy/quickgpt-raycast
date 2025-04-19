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
  BrowserExtension,
  getSelectedFinderItems,
  showToast,
  getPreferenceValues,
  closeMainWindow,
  Toast,
  openExtensionPreferences,
} from "@raycast/api";
import { runAppleScript } from "@raycast/utils";
import pinsManager from "./managers/PinsManager";
import promptManager, { PromptProps } from "./managers/PromptManager";
import { placeholderFormatter, resolvePlaceholders, SpecificReplacements } from "./utils/placeholderFormatter";
import fs from "fs";
import { match } from "pinyin-pro";
import { generatePromptActions } from "./components/PromptActions";
import path from "path";
import fsPromises from "fs/promises";
import { AIService } from "./services/AIService";
import { AIProvider } from "./services/types";
import defaultActionPreferenceStore from "./stores/DefaultActionPreferenceStore";
import { getAvailableScripts } from "./utils/scriptUtils";
import { isBinaryOrMediaFile, readDirectoryContents, readDirectoryContentsSync } from "./utils/fileSystemUtils";

const IDENTIFIER_PREFIX = "quickgpt-";
const DEFAULT_ICON = "🔖";

const SUPPORTED_PREFIX_COMMANDS: { [key: string]: string } = {
  c: "简体中文作答",
  ne: "NO EXPLANATION",
  np: "Do not use plugins and data analysis",
  cot: "",
  ns: "Do not use tool and Web Search",
};

const DEFAULT_PREFIX_COMMANDS = ["c"];

const placeholderIcons: { [key: string]: Icon } = {
  input: Icon.TextInput,
  clipboard: Icon.Clipboard,
  selection: Icon.Text,
  currentApp: Icon.Window,
  browserContent: Icon.Globe,
  promptTitles: Icon.List
};

/**
 * Apply prefix commands to content
 * @param content Original content
 * @param prefixCommands Prefix commands
 * @returns Processed content
 */
function applyPrefixCommandsToContent(content: string, prefixCommands: string | undefined): string {
  // If prefixCommands contains "none", return the original content
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

/**
 * Get quick prompt
 * @param selectionText Selected text
 * @param identifier Target identifier
 * @returns Quick prompt and cleaned selected text
 */
function getQuickPrompt(selectionText: string, identifier?: string, filePath?: string): [PromptProps | undefined, string] {
  let foundPrompt;
  let cleanedText = selectionText;

  if (identifier) {
    foundPrompt = promptManager.findPrompt(
      (prompt) => `${IDENTIFIER_PREFIX}${prompt.identifier}` === identifier
    );
    if (foundPrompt && filePath) {
      foundPrompt.filePath = filePath;
    }
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
    placeholderFormatter(getFormattedContent() || "", {
      ...selectedOptions,
      ...selectedTextInputs,
      promptTitles: getIndentedPromptTitles(),
    });

  return (
    <Form
      actions={
        <ActionPanel>
          {generatePromptActions(formattedContent, prompt.actions)}
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

function buildFormattedPromptContent(
  prompt: PromptProps,
  replacements: SpecificReplacements,
  relativeRootDir?: string
): string {
  const currentContent = prompt.content; // Work on a copy

  // Step 2: Apply prefix commands
  const processedContent = currentContent
    ? applyPrefixCommandsToContent(currentContent, prompt.prefixCMD)
    : undefined;

  // Step 3: Update replacements (e.g., promptTitles)
  const updatedReplacements = {
    ...replacements,
    promptTitles: replacements.promptTitles || getIndentedPromptTitles(),
  };

  // Step 4: Format standard placeholders using placeholderFormatter
  let formattedContent = placeholderFormatter(processedContent || "", updatedReplacements);

  // Step 5: Handle {{file:filepath}} placeholders (relative to specified root or absolute)
  const filePlaceholderPattern = /{{file:([^}]+)}}/g;
  formattedContent = formattedContent.replace(filePlaceholderPattern, (match, filePath) => {
    const trimmedPath = filePath.trim();
    let absoluteTargetPath: string;

    if (path.isAbsolute(trimmedPath)) {
      absoluteTargetPath = trimmedPath;
    } else {
      if (!relativeRootDir) {
        console.error(`Error: Relative path "${trimmedPath}" provided, but no custom prompt directory is configured as the root.`);
        return `[Error: Root directory not configured for relative path: ${trimmedPath}]`;
      }
      absoluteTargetPath = path.resolve(relativeRootDir, trimmedPath);
      if (!absoluteTargetPath.startsWith(relativeRootDir)) {
        console.error(`Error: Relative path traversal detected. Attempted access outside of root directory ${relativeRootDir}. Path: ${trimmedPath}`);
        return `[Error: Path traversal detected for: ${trimmedPath}]`;
      }
    }

    try {
      // Check if path exists and is a file or directory
      const stats = fs.statSync(absoluteTargetPath);

      if (stats.isFile()) {
        // Read file content
        return fs.readFileSync(absoluteTargetPath, 'utf-8');
      } else if (stats.isDirectory()) {
        // Read directory contents using the sync helper function
        // Pass the directory name itself as the initial basePath for clarity
        return readDirectoryContentsSync(absoluteTargetPath, path.basename(absoluteTargetPath));
      } else {
        // Handle other types like symbolic links, sockets, etc. if needed
        console.warn(`Warning: Path is neither a file nor a directory: ${absoluteTargetPath}`);
        return `[Unsupported path type: ${trimmedPath}]`;
      }
    } catch (error) {
      // Handle errors like permission denied or file/dir not found
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        console.warn(`Warning: File or directory not found for placeholder: ${absoluteTargetPath}`);
        return `[Path not found: ${trimmedPath}]`;
      } else if ((error as NodeJS.ErrnoException).code === 'EACCES') {
        console.error(`Error: Permission denied for path: ${absoluteTargetPath}`, error);
        return `[Permission denied: ${trimmedPath}]`;
      } else {
        console.error(`Error accessing path specified in placeholder: ${absoluteTargetPath}`, error);
        return `[Error accessing path: ${trimmedPath}]`;
      }
    }
  });

  return formattedContent;
}

interface PromptListProps {
  prompts: PromptProps[];
  searchMode?: boolean;
  clipboardText: string;
  selectionText: string;
  currentApp: string;
  browserContent: string;
  allowedActions?: string[];
}

function PromptList({
  prompts,
  searchMode = false,
  clipboardText,
  selectionText,
  currentApp,
  browserContent,
  allowedActions,
}: PromptListProps) {
  const [searchText, setSearchText] = useState<string>("");
  const [, forceUpdate] = useState(0);
  const preferences = getPreferenceValues<{
    customPromptsDirectory?: string;
    customPromptsDirectory1?: string;
    customPromptsDirectory2?: string;
    customPromptsDirectory3?: string;
    customPromptsDirectory4?: string;
    scriptsDirectory?: string;
  }>();
  const aiService = AIService.getInstance();
  const [selectedAction, setSelectedAction] = useState<string>(() => defaultActionPreferenceStore.getDefaultActionPreference() || "");

  // Get all configured, non-empty custom prompt directories
  const configuredRootDirs = [
    preferences.customPromptsDirectory1,
    preferences.customPromptsDirectory,
    preferences.customPromptsDirectory2,
    preferences.customPromptsDirectory3,
    preferences.customPromptsDirectory4
  ].filter((dir): dir is string => typeof dir === 'string' && dir.trim() !== '');

  // Filter prompts only in search mode
  if (searchMode && searchText.length > 0) {
    prompts = promptManager.getFilteredPrompts((prompt) => {
      return (
        prompt.title.toLowerCase().includes(searchText.trim().toLowerCase()) ||
        !!match(prompt.title, searchText.trim(), { continuous: true })
      );
    });
  }

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
        allowedActions={allowedActions}
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
    promptTitles: getIndentedPromptTitles(),
  };

  const promptItems = prompts
    .sort((a, b) => Number(b.pinned) - Number(a.pinned))
    .slice(0, searchMode && searchText.trim().length > 0 ? 5 : undefined)
    .map((prompt, index) => {
      // Determine the specific root directory for *this* prompt
      let promptSpecificRootDir: string | undefined = undefined;
      if (prompt.filePath) {
        let longestMatchLength = 0;
        for (const rootDir of configuredRootDirs) {
          // Normalize to ensure consistent path comparison
          const normalizedRootDir = path.normalize(rootDir);
          const normalizedPromptPath = path.normalize(prompt.filePath);

          // Check if the prompt path starts with the root directory path
          // Add path.sep to avoid matching '/path/to/rootABC' with '/path/to/root'
          const rootDirWithSeparator = normalizedRootDir.endsWith(path.sep) ? normalizedRootDir : normalizedRootDir + path.sep;

          if (normalizedPromptPath.startsWith(rootDirWithSeparator) || normalizedPromptPath === normalizedRootDir) {
            if (normalizedRootDir.length > longestMatchLength) {
              longestMatchLength = normalizedRootDir.length;
              promptSpecificRootDir = rootDir; // Store the original, non-normalized path from preferences
            }
          }
        }
      }

      const title = placeholderFormatter(prompt.title || "", replacements);
      const formattedTitle = searchMode && prompt.path
        ? `${placeholderFormatter(prompt.path, replacements).replace(title, '')}${title}`.trim()
        : title;

      // Lazy generation of formatted content, passing the determined specific root directory
      const getFormattedContent = () => buildFormattedPromptContent(prompt, replacements, promptSpecificRootDir);

      // Exclude prompts not matching search criteria in input mode
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
                  tooltip: prompt.content ?? prompt.subprompts
                    ?.map((subPrompt, subIndex) => `${subIndex + 1}. ${subPrompt.title} `)
                    .join("\n")
                }
                : accessory
            ),
            ...(getPlaceholderIcons(prompt.content, replacements).length === 0
              ? [{
                icon: prompt.subprompts ? Icon.Folder : Icon.Paragraph,
                tooltip: prompt.content ?? prompt.subprompts
                  ?.map((subPrompt, subIndex) => `${subIndex + 1}. ${subPrompt.title} `)
                  .join("\n")
              }]
              : [])
          ]}
          actions={
            <ActionPanel>
              {prompt.identifier === "open-custom-prompts-dir" ? (
                <>
                  {[
                    { dir: preferences.customPromptsDirectory1, label: "Custom Prompts 1" },
                    { dir: preferences.customPromptsDirectory, label: "Custom Prompts" },
                    { dir: preferences.customPromptsDirectory2, label: "Custom Prompts 2" },
                    { dir: preferences.customPromptsDirectory3, label: "Custom Prompts 3" },
                    { dir: preferences.customPromptsDirectory4, label: "Custom Prompts 4" }
                  ].map(({ dir, label }) =>
                    dir && (
                      <Action
                        key={label}
                        title={`Open ${label}`}
                        icon={Icon.Folder}
                        onAction={async () => {
                          await runAppleScript(`do shell script "open -a Cursor '${dir}'"`);
                          await closeMainWindow();
                        }}
                      />
                    )
                  )}
                  {![
                    preferences.customPromptsDirectory1,
                    preferences.customPromptsDirectory,
                    preferences.customPromptsDirectory2,
                    preferences.customPromptsDirectory3,
                    preferences.customPromptsDirectory4
                  ].some(Boolean) && (
                      <Action
                        title="Open"
                        icon={Icon.Folder}
                        onAction={async () => {
                          await showToast({
                            title: "Error",
                            message: "No custom prompts directories configured",
                            style: Toast.Style.Failure
                          });
                        }}
                      />
                    )}
                </>
              ) : prompt.identifier === "open-scripts-dir" ? (
                <Action
                  title="Open"
                  icon={Icon.Folder}
                  onAction={async () => {
                    if (preferences.scriptsDirectory) {
                      await runAppleScript(`do shell script "open -a Cursor '${preferences.scriptsDirectory}'"`);
                      await closeMainWindow();
                    } else {
                      await showToast({
                        title: "Error",
                        message: "Scripts directory not configured",
                        style: Toast.Style.Failure
                      });
                    }
                  }}
                />
              ) : prompt.identifier === "open-preferences" ? (
                <Action
                  title="Open"
                  icon={Icon.Gear}
                  onAction={() => {
                    openExtensionPreferences();
                    closeMainWindow();
                  }}
                />
              ) : prompt.subprompts ? (
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
                      allowedActions={allowedActions}
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
                    generatePromptActions(
                      getFormattedContent,
                      allowedActions || prompt.actions,
                    )
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
                  content={`raycast://extensions/ddhjy2012/quickgpt/prompt-lab?arguments=${encodeURIComponent(
                    JSON.stringify({
                      target: `${IDENTIFIER_PREFIX}${prompt.identifier}`,
                      activateOCR: "false",
                      actions: prompt.actions?.join(','),
                      filePath: prompt.filePath
                    })
                  )}`}
                  icon={Icon.Link}
                />
                {prompt.filePath && (
                  <Action
                    title="Edit with Cursor"
                    icon={Icon.Code}
                    onAction={async () => {
                      if (!prompt.filePath) return;
                      await Clipboard.copy(prompt.title);
                      const configDir = path.dirname(prompt.filePath);
                      await runAppleScript(`do shell script "open -a Cursor '${configDir}'"`);
                      await closeMainWindow();
                      await showToast({
                        title: "复制标题",
                        message: prompt.title,
                        style: Toast.Style.Success,
                      });
                    }}
                  />
                )}
              </>
            </ActionPanel>
          }
        />
      );
    });

  // Get available scripts
  const getScripts = () => {
    return getAvailableScripts(preferences.scriptsDirectory);
  };

  return (
    <List
      searchBarPlaceholder={searchMode ? "Search" : "Input"}
      onSearchTextChange={setSearchText}
      filtering={false}
      searchBarAccessory={
        searchMode ? (
          <List.Dropdown
            tooltip="Select preferred action"
            value={selectedAction}
            onChange={(newValue: string) => {
              if (newValue === selectedAction) return;

              // When selecting the default item (value is empty), directly clear the setting
              if (newValue === "") {
                setSelectedAction("");
                defaultActionPreferenceStore.saveDefaultActionPreference("");
                console.log("Cleared preferred action");
                showToast({
                  style: Toast.Style.Success,
                  title: "Cleared preferred action",
                });
                return;
              }

              setSelectedAction(newValue);
              defaultActionPreferenceStore.saveDefaultActionPreference(newValue);
              console.log(`Set preferred action: ${newValue}`);
              showToast({
                style: Toast.Style.Success,
                title: "Set preferred action",
                message: newValue,
              });
            }}
          >
            <List.Dropdown.Item key="default" title="Default" value="" />
            <List.Dropdown.Section title="Execute Scripts">
              {getScripts().map((script) => (
                <List.Dropdown.Item
                  key={script.path}
                  title={script.name}
                  value={`script_${script.name}`}
                />
              ))}
            </List.Dropdown.Section>
            <List.Dropdown.Section title="AI Providers">
              {aiService.getAllProviders().map((provider: AIProvider) => (
                <List.Dropdown.Item
                  key={provider.name}
                  title={`${provider.name}`}
                  value={`call ${provider.name.toLowerCase()}`}
                />
              ))}
            </List.Dropdown.Section>
          </List.Dropdown>
        ) : null
      }
    >
      {promptItems}
    </List>
  );
}

interface ExtendedArguments {
  clipboardText?: string;
  selectionText?: string;
  target?: string;
  activateOCR?: string;
  actions?: string;
  filePath?: string;
}

export default function PromptLab(props: LaunchProps<{ arguments: ExtendedArguments }>) {
  const {
    selectionText: initialSelectionText,
    clipboardText: initialClipboardText,
    target,
    activateOCR,
    actions,
    filePath,
  } = props.arguments;

  // Convert actions string back to array
  const allowedActions = actions?.split(',').filter(Boolean);

  const shouldActivateOCR = activateOCR === "true";

  const [clipboardText, setClipboardText] = useState(initialClipboardText ?? "");
  const [selectionText, setSelectionText] = useState(initialSelectionText ?? "");
  const [currentApp, setCurrentApp] = useState("");
  const [browserContent, setBrowserContent] = useState("");

  useEffect(() => {
    const fetchClipboardText = async (): Promise<string> => {
      if (initialClipboardText && initialClipboardText.length > 0) {
        return initialClipboardText;
      }
      try {
        const text = await Clipboard.readText();
        return text ?? "";
      } catch (error) {
        console.info("Failed to read clipboard text. Returning empty string.", error);
        return "";
      }
    };

    const fetchSelectedText = async (): Promise<string> => {
      if (initialSelectionText && initialSelectionText.length > 0) {
        return initialSelectionText;
      }

      try {
        try {
          const selectedItems = await getSelectedFinderItems();
          if (selectedItems.length > 0) {
            let content = '';
            for (const item of selectedItems) {
              const itemPath = item.path;
              const stats = await fsPromises.stat(itemPath);

              if (stats.isFile()) {
                if (!isBinaryOrMediaFile(itemPath)) {
                  const fileContent = await fsPromises.readFile(itemPath, 'utf-8');
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
          // Continue execution
        }

        const text = await getSelectedText();
        if (text) {
          return text;
        }

        return "";
      } catch (error) {
        console.info("No text selected");
        return "";
      }
    };

    const fetchFrontmostApp = async (): Promise<string> => {
      const app = await getFrontmostApplication();
      return app.name;
    };

    const fetchBrowserContent = async (): Promise<string> => {
      try {
        const content = await BrowserExtension.getContent({ format: "markdown" });
        return content;
      } catch (error) {
        console.info("Failed to fetch browser content:", error);
        return "";
      }
    };

    const timer = setTimeout(async () => {
      // First get the foreground application name
      const frontmostApp = await fetchFrontmostApp();

      // Get other content in parallel
      const [fetchedClipboardText, fetchedSelectedText] = await Promise.all([
        fetchClipboardText(),
        fetchSelectedText(),
      ]);

      // Only get browser content if the foreground app is a browser
      let fetchedBrowserContent = "";
      // Check if the foreground app is a browser (may need to adjust browser name list based on actual situation)
      const browserNames = ["Safari", "Google Chrome", "Firefox", "Edge", "Arc"];
      if (browserNames.some(browser => frontmostApp.includes(browser))) {
        fetchedBrowserContent = await fetchBrowserContent();
      }

      setClipboardText(fetchedClipboardText);
      setSelectionText(fetchedSelectedText);
      setCurrentApp(frontmostApp);
      setBrowserContent(fetchedBrowserContent);
    }, 10);

    return () => clearTimeout(timer);
  }, [initialClipboardText, initialSelectionText, target, shouldActivateOCR]);

  const pinnedIdentifiers = pinsManager.pinnedIdentifiers();
  const pinnedPrompts = promptManager.getFilteredPrompts((prompt) => {
    prompt.pinned = pinnedIdentifiers.has(prompt.identifier);
    return prompt.pinned;
  });

  const [quickPrompt, cleanedSelectionText] = getQuickPrompt(selectionText, target, filePath);

  const availablePrompts = quickPrompt?.subprompts
    ? quickPrompt.subprompts
    : quickPrompt
      ? [quickPrompt]
      : [
        ...pinnedPrompts,
        ...promptManager.getRootPrompts(),
        {
          title: "Settings",
          icon: "⚙️",
          identifier: "settings",
          subprompts: [
            {
              title: "Open Extension Preferences",
              icon: "🎛️",
              identifier: "open-preferences",
              actions: ["open-preferences"]
            },
            {
              title: "Open Custom Prompts Directory",
              icon: "📁",
              identifier: "open-custom-prompts-dir",
              actions: ["open-custom-prompts-dir"]
            },
            {
              title: "Open Scripts Directory",
              icon: "📁",
              identifier: "open-scripts-dir",
              actions: ["open-scripts-dir"]
            }
          ]
        }
      ];

  const effectiveSelectionText = quickPrompt ? cleanedSelectionText : selectionText;

  const uniquePrompts = Array.from(
    new Set(availablePrompts.map((prompt) => prompt.identifier || prompt.title))
  )
    .map((unique) => availablePrompts.find((prompt) => prompt.identifier === unique || prompt.title === unique))
    .filter(Boolean) as PromptProps[];

  return (
    <PromptList
      searchMode={!quickPrompt}
      prompts={uniquePrompts}
      clipboardText={clipboardText}
      selectionText={effectiveSelectionText}
      currentApp={currentApp}
      browserContent={browserContent}
      allowedActions={allowedActions}
    />
  );
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

/**
 * Get prompt titles with hierarchical indentation and content summary
 * @returns Prompt titles with hierarchical indentation and content summary
 */
function getIndentedPromptTitles(): string {
  const rootPrompts = promptManager.getRootPrompts();
  const result: string[] = [];

  function processPrompt(prompt: PromptProps, level: number = 0) {
    const indent = '  '.repeat(level);

    // Get content summary (first 20 characters)
    let contentSummary = '';
    if (prompt.content) {
      // Process content, apply prefix commands
      let processedContent = prompt.content;

      // Apply prefix commands
      processedContent = applyPrefixCommandsToContent(processedContent, prompt.prefixCMD);

      // Remove newlines and prefix command lines from content for better summary display
      const cleanContent = processedContent
        .replace(/^! .*\n/gm, '') // Remove prefix command lines
        .replace(/\n/g, ' ')      // Replace newlines with spaces
        .trim();

      contentSummary = cleanContent.length > 20
        ? cleanContent.substring(0, 20) + '...'
        : cleanContent;

      if (contentSummary) {
        contentSummary = ` - ${contentSummary}`;
      }
    }

    result.push(`${indent}${prompt.title}${contentSummary}`);

    if (prompt.subprompts && prompt.subprompts.length > 0) {
      prompt.subprompts.forEach(subprompt => {
        processPrompt(subprompt, level + 1);
      });
    }
  }

  rootPrompts.forEach(prompt => {
    processPrompt(prompt);
  });

  return result.join('\n');
}
