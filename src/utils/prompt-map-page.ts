/**
 * Renders the Prompt Map page by injecting the model into the HTML template.
 * The template is a self-contained page (no external resources) that reads
 * the model from a `<script type="application/json">` block.
 */

import type { PromptMapModel } from "./prompt-map-model";

export const PROMPT_MAP_DATA_PLACEHOLDER = "/*__PROMPT_MAP_DATA__*/";

/**
 * Serializes the model so it is safe inside a script block: `<` never forms a
 * closing tag and the JavaScript line separators stay escaped.
 */
export function serializePromptMapModel(model: PromptMapModel): string {
  return JSON.stringify(model)
    .replace(/</g, "\\u003c")
    .replace(new RegExp(String.fromCharCode(0x2028), "g"), "\\u2028")
    .replace(new RegExp(String.fromCharCode(0x2029), "g"), "\\u2029");
}

export function renderPromptMapPage(model: PromptMapModel, template: string): string {
  if (!template.includes(PROMPT_MAP_DATA_PLACEHOLDER)) {
    throw new Error("Prompt Map template is missing the data placeholder");
  }
  const json = serializePromptMapModel(model);
  return template.replace(PROMPT_MAP_DATA_PLACEHOLDER, () => json);
}
