/**
 * Position-aware HJSON scanner and surgical editor for prompt files.
 *
 * `hjson.parse()` discards source positions, so any edit made through it
 * would re-serialize whole files and destroy the author's formatting and
 * comments. This module mirrors the hjson-js grammar just far enough to record
 * the character span of every object, array, key and value, then rewrites only
 * the span that changes. Everything outside the edited span stays identical.
 *
 * The prompt shadow tree built by `promptTree` has the same shape and order as
 * `parsePromptsFromFile` + `processPrompts` produce, so the `sourceIndexPath`
 * recorded on a prompt resolves to the matching source object.
 */

import * as hjson from "hjson";

const PUNCTUATORS = new Set(["{", "}", "[", "]", ",", ":"]);
const NUMBER_RE = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?\s*$/;
const ESCAPES: Record<string, string> = {
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  '"': '"',
  "'": "'",
  "\\": "\\",
  "/": "/",
};

/* Types */

export interface StringSpan {
  kind: "string" | "quoteless";
  start: number;
  end: number;
  value: string;
}

export interface MultilineSpan {
  kind: "mlstring";
  start: number;
  end: number;
  /** Column of the opening `'''`, which hjson uses to dedent the body. */
  indent: number;
  value: string;
}

export interface LiteralSpan {
  kind: "literal";
  start: number;
  end: number;
  value: boolean | number | null;
}

export interface ObjectSpan {
  kind: "object";
  start: number;
  end: number;
  members: MemberSpan[];
  braceless: boolean;
}

export interface ArraySpan {
  kind: "array";
  start: number;
  end: number;
  items: ValueSpan[];
}

export type ValueSpan = StringSpan | MultilineSpan | LiteralSpan | ObjectSpan | ArraySpan;

export interface MemberSpan {
  key: string;
  keyStart: number;
  keyEnd: number;
  colon: number;
  value: ValueSpan;
}

export interface PromptShadow {
  obj: ObjectSpan;
  /** Index of the object inside its containing array, counting non-object items too. */
  rawIndex: number;
  /** Containing array, or undefined for a single-object file. */
  arr?: ArraySpan;
  children: PromptShadow[];
}

export interface HjsonEditError extends Error {
  pos?: number;
}

interface ScanState {
  t: string;
  i: number;
}

/* Errors */

function makeError(text: string, pos: number, message: string): HjsonEditError {
  const line = text.slice(0, pos).split("\n").length;
  const col = pos - (text.lastIndexOf("\n", pos - 1) + 1) + 1;
  const error: HjsonEditError = new Error(`${message} (line ${line}, col ${col})`);
  error.pos = pos;
  return error;
}

/* Scanner */

function skipWhite(s: ScanState): void {
  const t = s.t;
  for (;;) {
    const c = t[s.i];
    if (c === undefined) return;
    if (c <= " ") {
      s.i++;
      continue;
    }
    if (c === "#" || (c === "/" && t[s.i + 1] === "/")) {
      while (s.i < t.length && t[s.i] !== "\n") s.i++;
      continue;
    }
    if (c === "/" && t[s.i + 1] === "*") {
      const end = t.indexOf("*/", s.i + 2);
      s.i = end < 0 ? t.length : end + 2;
      continue;
    }
    return;
  }
}

function parseQuoted(s: ScanState): StringSpan {
  const t = s.t;
  const start = s.i;
  const quote = t[s.i];
  s.i++;
  let value = "";
  for (;;) {
    const ch = t[s.i];
    if (ch === undefined || ch === "\n") throw makeError(t, start, "Bad string");
    if (ch === quote) {
      s.i++;
      return { kind: "string", start, end: s.i, value };
    }
    if (ch === "\\") {
      const next = t[s.i + 1];
      if (next === "u") {
        value += String.fromCharCode(parseInt(t.substr(s.i + 2, 4), 16));
        s.i += 6;
      } else if (next !== undefined && next in ESCAPES) {
        value += ESCAPES[next];
        s.i += 2;
      } else {
        throw makeError(t, s.i, "Bad escape");
      }
      continue;
    }
    value += ch;
    s.i++;
  }
}

function skipIndent(body: string, index: number, indent: number): number {
  let skip = indent;
  let i = index;
  while (i < body.length && body[i] !== "\n" && body[i] <= " " && skip-- > 0) i++;
  return i;
}

function decodeMultiline(body: string, indent: number): string {
  let i = 0;
  while (i < body.length && body[i] !== "\n" && body[i] <= " ") i++;
  if (body[i] === "\n") {
    i++;
    i = skipIndent(body, i, indent);
  }
  let out = "";
  while (i < body.length) {
    const ch = body[i];
    if (ch === "\n") {
      out += "\n";
      i++;
      i = skipIndent(body, i, indent);
    } else {
      if (ch !== "\r") out += ch;
      i++;
    }
  }
  if (out.endsWith("\n")) out = out.slice(0, -1);
  return out;
}

function parseMultiline(s: ScanState): MultilineSpan {
  const t = s.t;
  const start = s.i;
  const lineStart = t.lastIndexOf("\n", start - 1) + 1;
  const indent = start - lineStart;
  const close = t.indexOf("'''", start + 3);
  if (close < 0) throw makeError(t, start, "Bad multiline string");
  s.i = close + 3;
  return { kind: "mlstring", start, end: s.i, indent, value: decodeMultiline(t.slice(start + 3, close), indent) };
}

function parseQuoteless(s: ScanState): StringSpan | LiteralSpan {
  const t = s.t;
  const start = s.i;
  const first = t[start];
  if (first === undefined || PUNCTUATORS.has(first)) {
    throw makeError(t, start, `Found a punctuator character '${first ?? ""}' when expecting a quoteless string`);
  }
  for (;;) {
    s.i++;
    const ch = t[s.i];
    const isEol = ch === undefined || ch === "\r" || ch === "\n";
    const isStop =
      isEol ||
      ch === "," ||
      ch === "}" ||
      ch === "]" ||
      ch === "#" ||
      (ch === "/" && (t[s.i + 1] === "/" || t[s.i + 1] === "*"));
    if (!isStop) continue;

    const raw = t.slice(start, s.i);
    const trimmed = raw.trim();
    const chf = raw[0];
    let literal: boolean | number | null | undefined;
    if (chf === "f" && trimmed === "false") literal = false;
    else if (chf === "n" && trimmed === "null") literal = null;
    else if (chf === "t" && trimmed === "true") literal = true;
    else if ((chf === "-" || (chf >= "0" && chf <= "9")) && NUMBER_RE.test(raw)) literal = Number(trimmed);
    if (literal !== undefined) return { kind: "literal", start, end: start + raw.trimEnd().length, value: literal };
    if (isEol) return { kind: "quoteless", start, end: start + raw.trimEnd().length, value: trimmed };
  }
}

function parseKey(s: ScanState): { key: string; keyStart: number; keyEnd: number } {
  const t = s.t;
  if (t[s.i] === '"' || t[s.i] === "'") {
    const str = parseQuoted(s);
    return { key: str.value, keyStart: str.start, keyEnd: str.end };
  }
  const keyStart = s.i;
  let name = "";
  let keyEnd = -1;
  for (;;) {
    const ch = t[s.i];
    if (ch === undefined) throw makeError(t, keyStart, "Unexpected end of input while reading a key");
    if (ch === ":") {
      if (!name) throw makeError(t, s.i, "Found ':' but no key name");
      return { key: name, keyStart, keyEnd: keyEnd < 0 ? s.i : keyEnd };
    }
    if (ch <= " ") {
      if (keyEnd < 0) keyEnd = s.i;
      s.i++;
      continue;
    }
    if (keyEnd >= 0) throw makeError(t, s.i, "Found whitespace in your key name");
    if (PUNCTUATORS.has(ch)) throw makeError(t, s.i, `Found '${ch}' where a key name was expected`);
    name += ch;
    s.i++;
  }
}

function parseObject(s: ScanState, braceless: boolean): ObjectSpan {
  const t = s.t;
  const start = s.i;
  if (!braceless) s.i++;
  const members: MemberSpan[] = [];
  for (;;) {
    skipWhite(s);
    if (braceless) {
      if (s.i >= t.length) return { kind: "object", start, end: t.length, members, braceless: true };
    } else if (t[s.i] === "}") {
      s.i++;
      return { kind: "object", start, end: s.i, members, braceless: false };
    } else if (t[s.i] === undefined) {
      throw makeError(t, start, "Unterminated object");
    }
    const { key, keyStart, keyEnd } = parseKey(s);
    const colon = s.i;
    s.i++;
    skipWhite(s);
    const value = parseValue(s);
    members.push({ key, keyStart, keyEnd, colon, value });
    skipWhite(s);
    if (t[s.i] === ",") s.i++;
  }
}

function parseArray(s: ScanState): ArraySpan {
  const t = s.t;
  const start = s.i;
  s.i++;
  const items: ValueSpan[] = [];
  for (;;) {
    skipWhite(s);
    if (t[s.i] === "]") {
      s.i++;
      return { kind: "array", start, end: s.i, items };
    }
    if (t[s.i] === undefined) throw makeError(t, start, "Unterminated array");
    items.push(parseValue(s));
    skipWhite(s);
    if (t[s.i] === ",") s.i++;
  }
}

function parseValue(s: ScanState): ValueSpan {
  const t = s.t;
  skipWhite(s);
  const c = t[s.i];
  if (c === "{") return parseObject(s, false);
  if (c === "[") return parseArray(s);
  if (c === '"') return parseQuoted(s);
  if (c === "'") return t[s.i + 1] === "'" && t[s.i + 2] === "'" ? parseMultiline(s) : parseQuoted(s);
  return parseQuoteless(s);
}

/**
 * Scans a whole file and returns the root value with positions for every node.
 */
export function scan(text: string): ValueSpan {
  const s: ScanState = { t: text, i: 0 };
  skipWhite(s);
  const c = text[s.i];
  if (c === "{" || c === "[") {
    const root = parseValue(s);
    skipWhite(s);
    if (s.i < text.length) throw makeError(text, s.i, "Syntax error, found trailing characters");
    return root;
  }
  return parseObject(s, true);
}

/* Prompt shadow tree */

function member(obj: ObjectSpan, key: string): MemberSpan | undefined {
  return obj.members.find((m) => m.key === key);
}

/**
 * Builds the tree of prompt objects in document order, mirroring how the
 * extension turns a file into prompts.
 */
export function promptTree(root: ValueSpan): PromptShadow[] {
  const fromArray = (arr: ArraySpan): PromptShadow[] =>
    arr.items
      .map((item, rawIndex) => ({ item, rawIndex }))
      .filter((entry): entry is { item: ObjectSpan; rawIndex: number } => entry.item.kind === "object")
      .map(({ item, rawIndex }) => toPrompt(item, rawIndex, arr));
  const toPrompt = (obj: ObjectSpan, rawIndex: number, arr?: ArraySpan): PromptShadow => {
    const sub = member(obj, "subprompts");
    return { obj, rawIndex, arr, children: sub && sub.value.kind === "array" ? fromArray(sub.value) : [] };
  };
  if (root.kind === "array") return fromArray(root);
  if (root.kind === "object") {
    const prompts = member(root, "prompts");
    if (prompts && prompts.value.kind === "array") return fromArray(prompts.value);
    if (member(root, "title") || member(root, "content")) return [toPrompt(root, 0)];
  }
  return [];
}

/**
 * Resolves the prompt at `indexPath` (raw index inside each containing array).
 */
export function resolvePrompt(text: string, indexPath: readonly number[]): PromptShadow {
  let list = promptTree(scan(text));
  let node: PromptShadow | undefined;
  for (const index of indexPath) {
    node = list.find((n) => n.rawIndex === index);
    if (!node) throw new Error(`Prompt not found at index path ${JSON.stringify(indexPath)}`);
    list = node.children;
  }
  if (!node) throw new Error("Empty index path");
  return node;
}

/**
 * Decoded string value of a member, or undefined when absent or not a string.
 */
export function valueOf(node: PromptShadow, key: string): string | undefined {
  const m = member(node.obj, key);
  if (!m) return undefined;
  const v = m.value;
  if (v.kind === "string" || v.kind === "mlstring" || v.kind === "quoteless") return v.value;
  if (v.kind === "literal") return v.value === null ? undefined : String(v.value);
  return undefined;
}

/* Serialization helpers */

/**
 * True when hjson could not read `str` back as the same quoteless string.
 */
export function needsQuotes(str: string): boolean {
  if (str === "" || /^\s|\s$/.test(str) || /[\n\r]/.test(str)) return true;
  const c = str[0];
  if ("{}[],:#\"'".includes(c) || str.startsWith("//") || str.startsWith("/*")) return true;
  // A quoteless string that hjson would read as a keyword or number before a
  // stop character (`,` `}` `]` `#` `//` `/*`) has to be quoted.
  const stops = /,|\}|\]|#|\/\/|\/\*|$/g;
  let m: RegExpExecArray | null;
  while ((m = stops.exec(str)) !== null) {
    const prefix = str.slice(0, m.index).trim();
    if (/^(true|false|null)$/.test(prefix) || NUMBER_RE.test(prefix)) return true;
    if (m.index === str.length) break;
    stops.lastIndex = m.index + Math.max(1, m[0].length);
  }
  return false;
}

function singleLine(value: string, preferQuoteless: boolean): string {
  return preferQuoteless && !needsQuotes(value) ? value : JSON.stringify(value);
}

/**
 * Renders a `'''` block whose body lines are indented to `indent` columns.
 */
export function multilineBlock(value: string, indent: number): string {
  const pad = " ".repeat(indent);
  const lines = value.split("\n").map((line) => (line.length ? pad + line : ""));
  return `'''\n${lines.join("\n")}\n${pad}'''`;
}

function lineStartOf(text: string, pos: number): number {
  return text.lastIndexOf("\n", pos - 1) + 1;
}

/** Whitespace before `pos` on its line, or undefined when something else precedes it. */
function leadingIndent(text: string, pos: number): string | undefined {
  const before = text.slice(lineStartOf(text, pos), pos);
  return /^[ \t]*$/.test(before) ? before : undefined;
}

/** Indentation used by the members of an object, derived from its source. */
function memberIndent(text: string, obj: ObjectSpan): string {
  for (const m of obj.members) {
    const indent = leadingIndent(text, m.keyStart);
    if (indent !== undefined) return indent;
  }
  return (leadingIndent(text, obj.start) ?? "") + "  ";
}

function splice(text: string, start: number, end: number, replacement: string): string {
  return text.slice(0, start) + replacement + text.slice(end);
}

/**
 * Renders a replacement for an existing member value, keeping the surrounding
 * style (quoteless, quoted or multiline block) where possible.
 */
function renderReplacement(text: string, m: MemberSpan, newValue: string): string {
  const v = m.value;
  const multiline = newValue.includes("\n");
  if (v.kind === "mlstring") {
    if (newValue.includes("'''")) return JSON.stringify(newValue);
    return multilineBlock(newValue, v.indent);
  }
  if (multiline) {
    if (newValue.includes("'''")) return JSON.stringify(newValue);
    const keyIndent = leadingIndent(text, m.keyStart) ?? "";
    return `\n${keyIndent}${multilineBlock(newValue, keyIndent.length)}`;
  }
  return singleLine(newValue, v.kind === "quoteless" || v.kind === "literal");
}

function renderNewMember(key: string, value: string, indent: string): string {
  if (value.includes("\n") || key === "content") {
    if (value.includes("'''")) return `${key}: ${JSON.stringify(value)}`;
    return `${key}:\n${indent}${multilineBlock(value, indent.length)}`;
  }
  return `${key}: ${singleLine(value, true)}`;
}

/* Edit operations */

function setMember(text: string, indexPath: readonly number[], key: string, value: string): string {
  const node = resolvePrompt(text, indexPath);
  const obj = node.obj;
  const existing = member(obj, key);
  if (existing) return splice(text, existing.value.start, existing.value.end, renderReplacement(text, existing, value));

  const indent = memberIndent(text, obj);
  const rendered = renderNewMember(key, value, indent);
  if (key !== "title") {
    // New content goes right after the title so files stay readable.
    const anchor = member(obj, "title") ?? obj.members[obj.members.length - 1];
    if (anchor) return splice(text, anchor.value.end, anchor.value.end, `\n${indent}${rendered}`);
  }
  if (obj.members.length) {
    const first = obj.members[0];
    return splice(text, first.keyStart, first.keyStart, `${rendered}\n${indent}`);
  }
  const at = obj.braceless ? obj.start : obj.start + 1;
  return splice(text, at, at, `\n${indent}${rendered}\n${leadingIndent(text, obj.start) ?? ""}`);
}

export interface PromptFields {
  title?: string;
  content?: string;
}

/**
 * Updates the title and/or content of the prompt at `indexPath`. Each field is
 * applied on a fresh scan so offsets never go stale.
 */
export function updateFields(text: string, indexPath: readonly number[], fields: PromptFields): string {
  let next = text;
  if (typeof fields.title === "string") next = setMember(next, indexPath, "title", fields.title);
  if (typeof fields.content === "string") next = setMember(next, indexPath, "content", fields.content);
  return next;
}

function renderPromptObject(
  data: { title: string; content: string },
  itemIndent: string,
  braceSameLine: boolean,
): string {
  const keyIndent = itemIndent + "  ";
  const title = `title: ${singleLine(data.title, true)}`;
  let body = braceSameLine ? `{ ${title}` : `{\n${keyIndent}${title}`;
  if (data.content) body += `\n${keyIndent}${renderNewMember("content", data.content, keyIndent)}`;
  return `${body}\n${itemIndent}}`;
}

/**
 * Appends a new prompt object to the `subprompts` of the prompt at
 * `parentIndexPath`, creating the array when the parent has none yet.
 */
export function addChild(
  text: string,
  parentIndexPath: readonly number[],
  data: { title: string; content: string },
): { text: string; indexPath: number[] } {
  const parent = resolvePrompt(text, parentIndexPath);
  const obj = parent.obj;
  const sub = member(obj, "subprompts");

  if (sub && sub.value.kind === "array") {
    const arr = sub.value;
    const objects = arr.items.filter((item): item is ObjectSpan => item.kind === "object");
    const last = objects[objects.length - 1];
    let itemIndent = (leadingIndent(text, arr.start) ?? "") + "  ";
    let braceSameLine = true;
    if (last) {
      itemIndent = leadingIndent(text, last.start) ?? itemIndent;
      const firstMember = last.members[0];
      braceSameLine = firstMember ? lineStartOf(text, firstMember.keyStart) === lineStartOf(text, last.start) : true;
    }
    const insertAt = last ? last.end : arr.start + 1;
    const rendered = `\n${itemIndent}${renderPromptObject(data, itemIndent, braceSameLine)}`;
    return { text: splice(text, insertAt, insertAt, rendered), indexPath: [...parentIndexPath, arr.items.length] };
  }

  const indent = memberIndent(text, obj);
  const itemIndent = indent + "  ";
  const anchor = obj.members[obj.members.length - 1];
  const rendered = `\n${indent}subprompts: [\n${itemIndent}${renderPromptObject(data, itemIndent, true)}\n${indent}]`;
  const insertAt = anchor ? anchor.value.end : obj.braceless ? obj.start : obj.start + 1;
  return { text: splice(text, insertAt, insertAt, rendered), indexPath: [...parentIndexPath, 0] };
}

/**
 * Range covering `start..end` plus a trailing comma, widened to the whole line
 * (and its leading newline) when nothing else shares that line.
 */
function lineAwareRange(text: string, start: number, end: number): { start: number; end: number } {
  while (text[end] === " " || text[end] === "\t") end++;
  if (text[end] === ",") end++;
  const lineStart = lineStartOf(text, start);
  if (/^[ \t]*$/.test(text.slice(lineStart, start))) {
    const lineEnd = text.indexOf("\n", end);
    const rest = text.slice(end, lineEnd < 0 ? text.length : lineEnd);
    if (/^[ \t]*$/.test(rest)) return { start: lineStart > 0 ? lineStart - 1 : lineStart, end: end + rest.length };
  }
  return { start, end };
}

/**
 * Removes the prompt object at `indexPath` together with the line it occupies.
 * Root prompts that are not array elements (single-object files) cannot be
 * removed this way.
 */
export function deletePrompt(text: string, indexPath: readonly number[]): string {
  const node = resolvePrompt(text, indexPath);
  if (!node.arr) throw new Error("This prompt is the whole file; delete the file instead");
  const range = lineAwareRange(text, node.obj.start, node.obj.end);
  return splice(text, range.start, range.end, "");
}

/* Structural edits: batch delete and move */

export type DropPosition = "before" | "after" | "inside-first" | "inside-last";

export interface PromptLocation {
  file: string;
  indexPath: number[];
}

export interface MoveTarget extends PromptLocation {
  where: DropPosition;
}

interface RangeEdit {
  start: number;
  end: number;
  text: string;
}

/**
 * Applies non-overlapping edits given in original coordinates and returns a
 * mapper from original positions (outside removed ranges) to new ones.
 */
function applyEdits(text: string, edits: RangeEdit[]): { text: string; map: (pos: number) => number } {
  const sorted = [...edits].sort((a, b) => b.start - a.start || b.end - a.end);
  let next = text;
  for (const edit of sorted) next = splice(next, edit.start, edit.end, edit.text);
  const map = (pos: number): number => {
    let delta = 0;
    for (const edit of edits) {
      if (edit.end <= pos && edit.start < pos) delta += edit.text.length - (edit.end - edit.start);
    }
    return pos + delta;
  };
  return { text: next, map };
}

function isPrefix(prefix: readonly number[], full: readonly number[]): boolean {
  return prefix.length <= full.length && prefix.every((value, i) => full[i] === value);
}

/** Drops duplicates and prompts whose ancestor is also listed. */
function outermost(indexPaths: readonly (readonly number[])[]): number[][] {
  const unique = Array.from(new Map(indexPaths.map((p) => [p.join("."), [...p]])).values());
  return unique.filter((p) => !unique.some((other) => other !== p && isPrefix(other, p)));
}

function resolveIn(tree: PromptShadow[], indexPath: readonly number[]): PromptShadow {
  let list = tree;
  let node: PromptShadow | undefined;
  for (const index of indexPath) {
    node = list.find((n) => n.rawIndex === index);
    if (!node) throw new Error(`Prompt not found at index path ${JSON.stringify(indexPath)}`);
    list = node.children;
  }
  if (!node) throw new Error("Empty index path");
  return node;
}

/** Finds the prompt object that starts exactly at `pos`, with its index path. */
function locateAt(tree: PromptShadow[], pos: number): { node: PromptShadow; indexPath: number[] } | undefined {
  const visit = (list: PromptShadow[], prefix: number[]): { node: PromptShadow; indexPath: number[] } | undefined => {
    for (const node of list) {
      const indexPath = [...prefix, node.rawIndex];
      if (node.obj.start === pos) return { node, indexPath };
      if (node.obj.start < pos && pos < node.obj.end) return visit(node.children, indexPath);
    }
    return undefined;
  };
  return visit(tree, []);
}

function lineIndent(text: string, pos: number): string {
  return /^[ \t]*/.exec(text.slice(lineStartOf(text, pos)))![0];
}

/**
 * Shifts every line after the first by `delta` columns so the snippet reads
 * the same at a new nesting depth. Lines that are already shallower than the
 * shift only lose whitespace, which keeps `'''` blocks decoding identically.
 */
function reindent(snippet: string, delta: number, padChar: string): string {
  if (delta === 0) return snippet;
  return snippet
    .split("\n")
    .map((line, i) => {
      if (i === 0 || line === "") return line;
      if (delta > 0) return padChar.repeat(delta) + line;
      const ws = /^[ \t]*/.exec(line)![0].length;
      return line.slice(Math.min(ws, -delta));
    })
    .join("\n");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function arrayUsesCommas(text: string, arr: ArraySpan): boolean {
  return arr.items.some((item) => {
    let i = item.end;
    while (text[i] === " " || text[i] === "\t") i++;
    return text[i] === ",";
  });
}

interface Insertion {
  start: number;
  end: number;
  indent: string;
  before: string;
  sep: string;
  after: string;
}

function insertBeforeItem(text: string, arr: ArraySpan, item: ValueSpan): Insertion {
  const indent = leadingIndent(text, item.start) ?? lineIndent(text, arr.start) + "  ";
  const comma = arrayUsesCommas(text, arr) ? "," : "";
  return {
    start: item.start,
    end: item.start,
    indent,
    before: "",
    sep: `${comma}\n${indent}`,
    after: `${comma}\n${indent}`,
  };
}

function insertAfterItem(text: string, arr: ArraySpan, item: ValueSpan): Insertion {
  const indent = leadingIndent(text, item.start) ?? lineIndent(text, arr.start) + "  ";
  let i = item.end;
  while (text[i] === " " || text[i] === "\t") i++;
  if (text[i] === ",")
    return { start: i + 1, end: i + 1, indent, before: `\n${indent}`, sep: `,\n${indent}`, after: "," };
  const comma = arrayUsesCommas(text, arr) ? "," : "";
  return {
    start: item.end,
    end: item.end,
    indent,
    before: `${comma}\n${indent}`,
    sep: `${comma}\n${indent}`,
    after: "",
  };
}

function insertionFor(text: string, anchor: PromptShadow, where: DropPosition): Insertion {
  if (where === "before" || where === "after") {
    if (!anchor.arr) throw new Error("不能把提示词放在整个文件对象的前后");
    return where === "before"
      ? insertBeforeItem(text, anchor.arr, anchor.obj)
      : insertAfterItem(text, anchor.arr, anchor.obj);
  }
  const obj = anchor.obj;
  const sub = member(obj, "subprompts");
  if (sub && sub.value.kind !== "array") throw new Error("目标的 subprompts 不是数组");
  if (sub && sub.value.kind === "array") {
    const arr = sub.value;
    if (arr.items.length) {
      return where === "inside-first"
        ? insertBeforeItem(text, arr, arr.items[0])
        : insertAfterItem(text, arr, arr.items[arr.items.length - 1]);
    }
    const outer = lineIndent(text, arr.start);
    const indent = outer + "  ";
    const innerBlank = /^\s*$/.test(text.slice(arr.start + 1, arr.end - 1));
    return {
      start: arr.start + 1,
      end: innerBlank ? arr.end - 1 : arr.start + 1,
      indent,
      before: `\n${indent}`,
      sep: `\n${indent}`,
      after: innerBlank ? `\n${outer}` : "",
    };
  }
  const outer = memberIndent(text, obj);
  const indent = outer + "  ";
  const anchorMember = obj.members[obj.members.length - 1];
  const at = anchorMember ? anchorMember.value.end : obj.braceless ? obj.start : obj.start + 1;
  return {
    start: at,
    end: at,
    indent,
    before: `\n${outer}subprompts: [\n${indent}`,
    sep: `\n${indent}`,
    after: `\n${outer}]`,
  };
}

/**
 * Removes the given prompts (and, for parents left with an empty
 * `subprompts: []`, that member too). Positions of `keepStarts` are mapped to
 * the new text; a parent whose start is listed there keeps its empty array.
 */
function removePrompts(
  text: string,
  indexPaths: readonly (readonly number[])[],
  keepStarts: number[] = [],
): { text: string; map: (pos: number) => number; removed: { snippet: string; column: number }[] } {
  const tree = promptTree(scan(text));
  const removed: { snippet: string; column: number }[] = [];
  const edits: RangeEdit[] = [];
  const parents = new Set<number>();
  for (const indexPath of outermost(indexPaths)) {
    const node = resolveIn(tree, indexPath);
    if (!node.arr) throw new Error("这条提示词是整个文件，不能移动或删除");
    removed.push({
      snippet: text.slice(node.obj.start, node.obj.end),
      column: node.obj.start - lineStartOf(text, node.obj.start),
    });
    const range = lineAwareRange(text, node.obj.start, node.obj.end);
    edits.push({ ...range, text: "" });
    if (indexPath.length > 1) parents.add(resolveIn(tree, indexPath.slice(0, -1)).obj.start);
  }
  const first = applyEdits(text, edits);

  const cleanupTree = promptTree(scan(first.text));
  const cleanup: RangeEdit[] = [];
  for (const start of parents) {
    if (keepStarts.includes(start)) continue;
    const parent = locateAt(cleanupTree, first.map(start));
    const sub = parent && member(parent.node.obj, "subprompts");
    if (!sub || sub.value.kind !== "array" || sub.value.items.length) continue;
    if (!/^\s*$/.test(first.text.slice(sub.value.start + 1, sub.value.end - 1))) continue;
    cleanup.push({ ...lineAwareRange(first.text, sub.keyStart, sub.value.end), text: "" });
  }
  const second = applyEdits(first.text, cleanup);
  return { text: second.text, map: (pos) => second.map(first.map(pos)), removed };
}

/**
 * Removes several prompts from one file at once. Index paths refer to the
 * original text, so callers never deal with shifting indexes.
 */
export function deletePrompts(text: string, indexPaths: readonly (readonly number[])[]): string {
  return removePrompts(text, indexPaths).text;
}

export interface MoveResult {
  /** New text for every file that changed. */
  texts: Record<string, string>;
  /** Where the moved prompts ended up, in the order they were given. */
  moved: PromptLocation[];
}

/**
 * Moves prompts (possibly from several files) next to or into `target`,
 * keeping each moved object's source text and re-indenting it for its new
 * depth. `files` maps every involved file path to its current text.
 */
export function movePrompts(
  files: Readonly<Record<string, string>>,
  sources: readonly PromptLocation[],
  target: MoveTarget,
): MoveResult {
  const textOf = (file: string): string => {
    const text = files[file];
    if (typeof text !== "string") throw new Error(`Missing text for ${file}`);
    return text;
  };
  const byFile = new Map<string, number[][]>();
  for (const source of sources) {
    if (source.file === target.file && isPrefix(source.indexPath, target.indexPath)) {
      throw new Error("不能把提示词移动到它自己或它的子项里");
    }
    byFile.set(source.file, [...(byFile.get(source.file) ?? []), source.indexPath]);
  }
  if (!byFile.size) return { texts: {}, moved: [] };

  const targetOriginal = textOf(target.file);
  const anchorStart = resolvePrompt(targetOriginal, target.indexPath).obj.start;

  // Phase 1: take the prompts out of their files.
  const snippets = new Map<string, { snippet: string; column: number }>();
  const texts: Record<string, string> = {};
  let anchorPos = anchorStart;
  for (const [file, indexPaths] of byFile) {
    const original = textOf(file);
    const kept = outermost(indexPaths);
    const tree = promptTree(scan(original));
    // Remove in document order so snippets can be matched back to sources.
    const ordered = [...kept].sort((a, b) => resolveIn(tree, a).obj.start - resolveIn(tree, b).obj.start);
    const result = removePrompts(original, ordered, file === target.file ? [anchorStart] : []);
    ordered.forEach((indexPath, i) => snippets.set(`${file}#${indexPath.join(".")}`, result.removed[i]));
    texts[file] = result.text;
    if (file === target.file) anchorPos = result.map(anchorStart);
  }

  // Phase 2: insert them at the target, in the order the caller listed them.
  const targetText = texts[target.file] ?? targetOriginal;
  const anchor = locateAt(promptTree(scan(targetText)), anchorPos);
  if (!anchor) throw new Error("Could not find the drop target after removing the moved prompts");
  const insertion = insertionFor(targetText, anchor.node, target.where);
  const padChar = insertion.indent.includes("\t") ? "\t" : " ";
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const key = `${source.file}#${source.indexPath.join(".")}`;
    const entry = snippets.get(key);
    if (!entry || seen.has(key)) continue;
    seen.add(key);
    const moved = reindent(entry.snippet, insertion.indent.length - entry.column, padChar);
    if (canonicalJson(hjson.parse(moved)) !== canonicalJson(hjson.parse(entry.snippet))) {
      throw new Error("移动后的内容校验失败，已取消");
    }
    parts.push(moved);
  }
  const inserted = insertion.before + parts.join(insertion.sep) + insertion.after;
  const finalText = splice(targetText, insertion.start, insertion.end, inserted);
  texts[target.file] = finalText;

  const starts: number[] = [];
  let offset = insertion.start + insertion.before.length;
  for (const part of parts) {
    starts.push(offset);
    offset += part.length + insertion.sep.length;
  }
  const finalTree = promptTree(scan(finalText));
  const moved = starts.map((start) => {
    const hit = locateAt(finalTree, start);
    if (!hit) throw new Error("Could not locate a moved prompt");
    return { file: target.file, indexPath: hit.indexPath };
  });

  for (const [file, text] of Object.entries(texts)) {
    try {
      hjson.parse(text);
    } catch (error) {
      throw new Error(
        `移动后 ${file} 不是合法的 HJSON，已取消：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (text === files[file]) delete texts[file];
  }
  return { texts, moved };
}
