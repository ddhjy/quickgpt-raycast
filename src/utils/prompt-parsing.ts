/**
 * Pure prompt parsing shared by the Raycast extension and the Prompt Map
 * server bundle. It turns the text of an `.hjson` file into prompt objects,
 * applies root property merging and parent inheritance, and derives stable
 * identifiers and breadcrumb paths.
 *
 * Nothing in this module may import `@raycast/api`: the Prompt Map server runs
 * outside Raycast and bundles this file as-is.
 */

import md5 from "md5";
import * as hjson from "hjson";
import { assignPromptLineNumbers } from "./prompt-line-locator";

export type PromptProps = {
  identifier: string;
  title: string;
  content?: string;
  icon?: string;
  subprompts?: PromptProps[];
  pinned?: boolean;
  prefix?: string;
  suffix?: string;
  options?: { [key: string]: string[] | Record<string, string> };
  actions?: string[];
  textInputs?: { [key: string]: string };
  path?: string;
  filePath?: string;
  /** 1-based line in `filePath` where this prompt is defined. */
  lineNumber?: number;
  /**
   * Raw index of this prompt inside each containing array of its source file,
   * outermost first. Used by the Prompt Map editor to locate the object again.
   */
  sourceIndexPath?: number[];
  /** True when the source object defines its own `content` (not inherited). */
  hasOwnContent?: boolean;
  /** True when the prompt is the file's single root object rather than an array item. */
  isFileRoot?: boolean;
  isTemporary?: boolean;
  temporaryDirSource?: string;
};

export const NON_INHERITED_PROPS: (keyof PromptProps)[] = [
  "subprompts",
  "identifier",
  "path",
  "pinned",
  "options",
  "textInputs",
  "lineNumber",
  "sourceIndexPath",
  "hasOwnContent",
  "isFileRoot",
];

/** Accumulates `rootProperty` blocks across every file of a library. */
export interface PromptParseState {
  mergedRootProperties: Partial<PromptProps>;
}

export function createPromptParseState(): PromptParseState {
  return { mergedRootProperties: {} };
}

type RawPrompt = Record<string, unknown> & { __rawIndex?: number };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function tagRawIndexes(items: unknown[]): RawPrompt[] {
  const tagged: RawPrompt[] = [];
  items.forEach((item, index) => {
    if (isObject(item)) tagged.push(Object.assign(item, { __rawIndex: index }));
  });
  return tagged;
}

function normalizeActions(prompt: PromptProps & { actions?: string | string[] }): void {
  if (typeof prompt.actions === "string") {
    prompt.actions = prompt.actions
      .split(",")
      .map((action) => action.trim())
      .filter((action) => action.length > 0);
  }
}

/**
 * Parses one prompt file. Returns the top-level prompts with `filePath`,
 * `lineNumber` and the raw index needed to resolve them again later.
 * Files that fail to parse produce an empty list; the error is reported
 * through `onError`.
 */
export function parsePromptsFromFile(
  state: PromptParseState,
  data: string,
  filePath: string,
  onError: (message: string, error: unknown) => void = (message, error) => console.error(message, error),
): PromptProps[] {
  let parsed: unknown;
  try {
    parsed = hjson.parse(data);
  } catch (parseError) {
    onError(`HJSON parsing failed ${filePath}:`, parseError);
    return [];
  }

  let promptsData: RawPrompt[] = [];
  if (Array.isArray(parsed)) {
    promptsData = tagRawIndexes(parsed);
  } else if (isObject(parsed)) {
    if (isObject(parsed.rootProperty)) {
      state.mergedRootProperties = { ...state.mergedRootProperties, ...(parsed.rootProperty as Partial<PromptProps>) };
      if (Array.isArray(parsed.prompts)) {
        promptsData = tagRawIndexes(parsed.prompts);
      } else if (parsed.title || typeof parsed.content === "string") {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { rootProperty, ...promptObject } = parsed;
        if (Object.keys(promptObject).length > 0) {
          promptsData = [Object.assign(promptObject, { __rawIndex: 0, isFileRoot: true })];
        }
      }
    } else if (Array.isArray(parsed.prompts)) {
      promptsData = tagRawIndexes(parsed.prompts);
    } else if (parsed.title || typeof parsed.content === "string") {
      promptsData = [Object.assign(parsed, { __rawIndex: 0, isFileRoot: true })];
    }
  } else {
    onError(`Unsupported HJSON root structure in ${filePath}`, undefined);
  }

  assignPromptLineNumbers(promptsData, data);

  return promptsData
    .map((p) => {
      if (!p.title && typeof p.content === "string" && p.content.trim().length > 0) {
        p.title = p.content.trim().split("\n")[0].trim();
      }
      return p;
    })
    .filter((p): p is RawPrompt & { title: string } => typeof p.title === "string" && p.title.length > 0)
    .map((raw) => {
      const prompt = raw as unknown as PromptProps;
      normalizeActions(prompt);
      prompt.filePath = filePath;
      return prompt;
    });
}

const EMOJI_REGEX = /[\p{Emoji}\u{1F3FB}-\u{1F3FF}\u{1F9B0}-\u{1F9B3}]/gu;
const PLACEHOLDER_REGEX = /{{([^}]+)}}/g;

/**
 * Derives the identifier the extension has always used for prompts without an
 * explicit one: a short md5 of the emoji, the title and the placeholders.
 */
export function generatePromptIdentifier(prompt: Pick<PromptProps, "title" | "content">): string {
  const emojis = prompt.title.match(EMOJI_REGEX) || [];
  const placeholders = prompt.content?.match(PLACEHOLDER_REGEX) || [];
  const placeholderStr = placeholders.map((p) => p.replace(/[{}]/g, "")).join("-");
  const baseStr = [emojis.join(""), prompt.title.replace(EMOJI_REGEX, "").trim(), placeholderStr]
    .filter(Boolean)
    .join("-");
  return md5(baseStr).substring(0, 8);
}

/**
 * Applies inheritance, identifiers and paths to a list of parsed prompts,
 * recursing into `subprompts`. Must run after every file has been parsed so
 * `state.mergedRootProperties` is complete.
 */
export function processPrompts(
  state: PromptParseState,
  prompts: PromptProps[],
  parentPrompt?: PromptProps,
): PromptProps[] {
  return prompts.map((original, position) => {
    let prompt = original;
    if (!prompt.title && prompt.content) {
      prompt.title = prompt.content.trim().split("\n")[0].trim();
    }

    const baseProperties: Partial<PromptProps> = { ...state.mergedRootProperties };

    if (parentPrompt) {
      for (const key in parentPrompt) {
        if (Object.prototype.hasOwnProperty.call(parentPrompt, key)) {
          const propKey = key as keyof PromptProps;
          if (!NON_INHERITED_PROPS.includes(propKey) && parentPrompt[propKey] !== undefined) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (baseProperties as any)[propKey] = parentPrompt[propKey];
          }
        }
      }
    }

    const originalFilePath = prompt.filePath;
    const rawIndex = (original as PromptProps & { __rawIndex?: number }).__rawIndex;
    const hasOwnContent = typeof original.content === "string";

    prompt = { ...baseProperties, ...prompt };
    delete (prompt as PromptProps & { __rawIndex?: number }).__rawIndex;

    normalizeActions(prompt);

    if (originalFilePath) {
      prompt.filePath = originalFilePath;
    } else if (!prompt.filePath) {
      prompt.filePath = state.mergedRootProperties.filePath;
    }

    if (!prompt.identifier) {
      prompt.identifier = generatePromptIdentifier(prompt);
    }

    if (!prompt.content) {
      prompt.content = prompt.title;
    }

    prompt.path = parentPrompt?.path ? `${parentPrompt.path} / ${prompt.title}` : prompt.title;
    prompt.sourceIndexPath = parentPrompt?.sourceIndexPath
      ? [...parentPrompt.sourceIndexPath, position]
      : [rawIndex ?? position];
    prompt.hasOwnContent = hasOwnContent;

    if (prompt.subprompts) {
      prompt.subprompts = processPrompts(state, prompt.subprompts, prompt);
    }

    return prompt;
  });
}
