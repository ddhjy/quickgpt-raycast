# QuickGPT for Raycast

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

QuickGPT is a powerful prompt management tool designed for Raycast. It enhances your workflow by enabling you to efficiently manage, access, and utilize a vast library of prompts directly within the Raycast interface. Apply prompts instantly to selected text, clipboard content, or direct input, leveraging a sophisticated placeholder system and seamless integration capabilities.

## Key Features

* **Advanced Prompt Management:** Organize and maintain extensive prompt libraries using the human-readable HJSON format (`.hjson`). Treat your prompts like code, enabling versioning and iteration.
* **Rich Placeholder System:** Dynamically inject context into your prompts with placeholders like `{{input}}`, `{{selection}}`, `{{clipboard}}`, `{{currentApp}}`, `{{browserContent}}`, `{{now}}`, `{{promptTitles}}`, file content (`{{file:path/to/file}}`), dropdown options (`{{option:key}}`), and prompt properties (`{{p:key}}`). Supports fallback logic (`{{selection|clipboard}}`).
* **System-Wide Accessibility:** Invoke QuickGPT from anywhere in your system via Raycast for immediate prompt access.
* **Seamless Integration:** Connect QuickGPT with other applications and extensions using deeplinks and configurable actions (e.g., running AppleScripts, triggering external AI callers).
* **Scalability:** Effortlessly manage hundreds or thousands of prompts, facilitating complex prompt engineering workflows.
* **Interactive Prompts:** Define prompts with dropdown menus (`options`) or text input fields (`textInputs`) for user configuration before execution.
* **Pinning & Organization:** Pin frequently used prompts for quick access and organize prompts using nested structures (subprompts).

## Installation

1.  **Prerequisites:** Ensure you have [Raycast](https://www.raycast.com/) installed on your macOS.
2.  **Clone the Repository:**
    ```bash
    git clone https://github.com/ddhjy/quickgpt-raycast.git
    cd quickgpt-raycast
    ```
3.  **Install Dependencies:**
    ```bash
    npm install
    ```
4.  **Build the Extension:**
    ```bash
    npm run build
    # Or for development:
    # npm run dev
    ```
5.  **Import into Raycast:**
    * Open Raycast preferences (`⌘ + ,`).
    * Navigate to the `Extensions` tab.
    * Click the `+` button in the bottom left and select `Import Extension`.
    * Choose the `quickgpt-raycast` directory you cloned.
    * Alternatively, if running `npm run dev`, the extension should load automatically in developer mode.

## Configuration

Configure QuickGPT through Raycast's preferences (`Raycast Settings -> Extensions -> QuickGPT`):

1.  **Prompt Directories (`Custom Prompts`, `Custom Prompts 1-4`):**
    * **Required:** Set at least one directory containing your `.hjson` prompt definition files. QuickGPT will load prompts from these locations.
    * Multiple directories allow for better organization (e.g., separating personal, work, or project-specific prompts).
2.  **Scripts Directory (Optional):**
    * Set a directory containing AppleScript files (`.applescript`, `.scpt`). These scripts will appear as executable actions in QuickGPT.
3.  **Default Actions (`Actions`):**
    * Define a comma-separated list of action names (e.g., `Copy`, `Paste`, `YourScriptName`, `OpenAI`) that should appear first in the Action Panel or be triggered by `⌘ + Enter`.

## Usage

1.  **Launch:** Activate Raycast and type the command alias for `Prompt Lab` (default might be `prompt` or `quickgpt`, check Raycast settings).
2.  **Browse/Search Mode:**
    * A list of your loaded prompts appears.
    * Type to search prompts by title (supports Pinyin matching).
    * Select a prompt using arrow keys and `Enter`.
3.  **Input Mode (Optional):**
    * If you type text in the search bar and end with a space ` `, QuickGPT enters Input Mode, using the typed text for the `{{input}}` placeholder in the subsequently selected prompt.
    * Alternatively, after selecting a prompt directly, you can start typing to provide input for the `{{input}}` placeholder.
    * **Note:** The `{{input}}` placeholder is *only* replaced by the search bar text when in Input Mode, not during Search Mode.
4.  **Action Panel:**
    * After selecting a prompt (or providing input), press `⌘ + K` (or your configured shortcut) to open the Action Panel.
5.  **Execute Action:**
    * Choose an action from the list (e.g., Copy, Paste, Send to OpenAI, Run Script).
    * The default action (topmost or configured via preferences) can often be triggered with `⌘ + Enter`.
    * The selected action executes, using the fully formatted prompt content (with placeholders resolved).

## Prompt File Format (`.hjson`)

Prompts are defined in `.hjson` files. HJSON allows for comments and a more relaxed syntax than JSON.

**Example `prompt.hjson`:**

```hjson
// Example HJSON prompt definition
{
  // Title displayed in Raycast. Can include placeholders.
  title: "Translate"
  // Unique identifier (optional but recommended for pinning and deeplinks)
  identifier: "translate_example_v1"
  // Icon shown in the list (Emoji or SF Symbol name)
  icon: "🌐"
  // The main prompt content. Use placeholders for dynamic data.
  content: '''
  Translate the following text into {{option:languages}}:

  {{selection|clipboard}}
  '''
  // Prioritize specific actions for this prompt (optional)
  actions: ["ChatGPT", "Copy"]
  // Define an array property
  languages: ["French", "Spanish", "German", "Japanese"]
  // Use {{option:languages}} in title or content to create a dropdown
  // from the 'languages' property of this prompt object.
}

// --- Example of nested prompts (folders) ---
{
  title: "Writing Tools"
  icon: "✍️"
  identifier: "writing_tools_folder"
  // Inheritable properties (optional): Children will inherit 'prefixCMD' unless overridden
  prefixCMD: "ne" // No Explanation by default for children

  subprompts: [
    {
      title: "Summarize Text"
      identifier: "summarize_text_child"
      icon: "📄"
      content: "Summarize this: {{selection|clipboard}}"
      // Inherits prefixCMD: "ne" from parent
    }
    {
      title: "Improve Grammar"
      identifier: "improve_grammar_child"
      icon: "✅"
      content: "Improve the grammar of: {{selection|clipboard}}"
      prefixCMD: "c" // Overrides parent's prefixCMD, asks for Chinese response
    }
  ]
}

// --- Example of rootProperty for defaults ---
// Place this at the top level of a .hjson file
{
  rootProperty: {
    // These properties apply as defaults to all prompts defined *after* this
    // in this file, and potentially subsequent files loaded from the same directory,
    // unless overridden by the prompt itself or an inherited parent property.
    icon: "⭐"
    actions: ["Copy", "Paste"]
    prefixCMD: "c" // Default to Chinese responses
  }

  // This prompt will inherit the star icon, Copy/Paste actions, and Chinese prefixCMD
  title: "My Defaulted Prompt"
  content: "This prompt uses defaults from rootProperty."

  // This prompt overrides the icon but inherits actions and prefixCMD
  title: "Override Icon Prompt"
  icon: "🚀"
  content: "This prompt has a custom icon."
}

```

* Refer to `prompt.schema.hjson` (if available in the project) for the complete schema definition.
* Properties like `icon`, `actions`, `prefixCMD` can be inherited from parent prompts (defined via `subprompts`) or set globally via `rootProperty`. Specific prompt properties always override inherited or root properties.

## Placeholders

QuickGPT offers a powerful placeholder system to inject dynamic content:

| Placeholder              | Alias(es) | Description                                                                                                                                                               | Example Usage                      |
| :----------------------- | :-------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :--------------------------------- |
| `{{input}}`              | `{{i}}`   | Text entered in the Raycast input field **after** selecting a prompt or ending search with a space.                                                                       | `Summarize: {{input}}`             |
| `{{clipboard}}`          | `{{c}}`   | Current text content of the system clipboard.                                                                                                                             | `Translate: {{clipboard}}`         |
| `{{selection}}`          | `{{s}}`   | Text currently selected in the frontmost application. If Finder items are selected, formats as `{{file:path}}`.                                                           | `Define: {{selection}}`            |
| `{{currentApp}}`         |           | Name of the frontmost application.                                                                                                                                        | `Instructions for {{currentApp}}`    |
| `{{browserContent}}`     |           | Markdown content of the active browser tab (requires Raycast Browser Extension, works best with Arc).                                                                     | `Analyze page: {{browserContent}}` |
| `{{now}}`                | `{{n}}`   | Current date and time in the system's locale format.                                                                                                                      | `Log entry at {{now}}`             |
| `{{promptTitles}}`       | `{{pt}}`  | An indented list of all available prompt titles.                                                                                                                          | `Available prompts:\n{{promptTitles}}` |
| `{{file:path}}`        |           | Reads content from the specified file or directory. `path` can be absolute or relative (to the `.hjson` file's directory). Reads directories recursively (respects `.gitignore`). | `Context:\n{{file:../notes.txt}}` |
| `{{option:key}}`         |           | Creates a dropdown menu using the array defined in the `key` property of the *same* prompt object. User selects before execution. Value replaces the placeholder.             | `Format: {{option:outputFormats}}` |
| `{{property}}`           |           | Replaced by the value of the `property` key defined within the prompt's `options` object (user selects from dropdown).                                                    | `Translate to {{language}}`        |
| `{{property}}`           |           | Replaced by the value entered by the user for the `property` key defined within the prompt's `textInputs` object.                                                         | `Audience: {{audience}}`           |
| `{{p:key}}`              |           | Accesses the value of the `key` property **of the prompt object itself** (after inheritance and defaults). Can use dot notation (e.g., `{{p:parent.title}}`).               | `Prompt Title: {{p:title}}`        |
| `{{ph1|ph2|...}}`      |           | **Fallback:** Uses the value of the first non-empty placeholder in the list (e.g., `{{selection|clipboard}}` uses selection if available, otherwise clipboard).            | `Input: {{s|c|i}}`                 |

**Notes on Placeholders:**

* **`{{input}}`:** Only populated when QuickGPT is in "Input Mode".
* **`{{file:path}}`:** Relative paths are resolved based on the location of the `.hjson` file containing the placeholder. Directory reading ignores binary files and patterns defined in `.gitignore` files found within the traversed directories.
* **`{{option:key}}` vs `{{property}}` (from `options`):** `{{option:key}}` is a newer way to link a placeholder directly to a top-level array property within the same prompt definition for creating dropdowns. The older method uses the `options` object, where keys automatically become placeholders. Both result in a dropdown form.
* **`{{p:key}}`:** Useful for meta-prompts or referencing inherited values.
* **Fallback Order:** The order matters (e.g., `{{selection|clipboard}}` prioritizes selection).

## Actions

QuickGPT executes actions on the final formatted prompt content:

* **`Copy`:** Copies the formatted content to the clipboard.
* **`Paste`:** Pastes the formatted content into the frontmost application.
* **Scripts (`YourScriptName`):** (Requires `Scripts Directory` setup) Executes the corresponding AppleScript file found in the configured directory. The formatted prompt content is usually copied to the clipboard before script execution.

Actions can be prioritized per-prompt using the `actions` array in the `.hjson` file or globally via the `Actions` preference.

## Contributing

Contributions are welcome! Please follow these steps:

1.  Fork the repository on GitHub.
2.  Create a new branch for your feature or bug fix (`git checkout -b feature/my-new-feature` or `bugfix/issue-fix`).
3.  Make your changes and commit them with clear messages (`git commit -am 'Add some feature'`).
4.  Push your changes to your fork (`git push origin feature/my-new-feature`).
5.  Open a Pull Request on the main repository, clearly describing your changes.

## Reporting Issues

If you encounter bugs or have feature requests, please file an issue on the [GitHub Issues page](https://github.com/ddhjy/quickgpt-raycast/issues).

## License

This project is licensed under the **Apache License 2.0**. See the [LICENSE](LICENSE) file for details.
