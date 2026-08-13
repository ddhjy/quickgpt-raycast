# QuickGPT for Raycast

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/ddhjy/quickgpt-raycast)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A Raycast extension for managing prompts like code. Load `.hjson` libraries, inject live context through placeholders, then copy, paste, or hand the result to your own AppleScript.

QuickGPT does **not** call an LLM API. It prepares the prompt; you send it to ChatGPT, Claude, or any other app.

<img src="https://github.com/user-attachments/assets/d94fc5b5-4e9a-41e9-abd4-ff5c48c601d6" alt="QuickGPT prompt list">

## Quick Start

1. Install [Raycast](https://www.raycast.com/) and [Node.js 22.14.0](https://nodejs.org/) or later.
2. Clone and run the extension:

   ```bash
   git clone https://github.com/ddhjy/quickgpt-raycast.git
   cd quickgpt-raycast
   npm install
   npm run dev
   ```

3. In Raycast, open **Prompt Lab**. A built-in bilingual library is available immediately: Ask, Translate, Writing, Summarize, Code, and What is this. Copy or Paste works with no extra setup.

### Next steps (optional)

- **Your own library**: open Settings → **Create My Prompt Library**. This creates `~/Documents/QuickGPT Prompts/` with a starter template, then opens Preferences so you can set **Custom Prompts** to that folder.
- **Send prompts to an app**: point **Scripts Directory** at [`example/script/`](example/script/) (or your own `.applescript` files). Grant Accessibility permission to Raycast and the target app.
- **Edit prompts in your editor**: set **Editor Application** in Preferences. Leave it empty to open files with the system default app.

## Overview

QuickGPT lets you organize, search, and run an extensive prompt library from Raycast. Prompts are HJSON files you can version with git. At run time, placeholders pull in selected text, clipboard, Finder items, git diffs, and more.

## Key Features

### Prompt management

- **HJSON format**: human-readable `.hjson` files with nested `subprompts`
- **Built-in starter library**: usable on first launch, no directory required
- **Up to 5 custom prompt directories** plus temporary directories (expire after 30 days)
- **Pin, search, and deeplink** prompts, including Pinyin matching

### Placeholder system

- Context: `{{input}}`, `{{selection}}`, `{{clipboard}}`, `{{currentApp}}`, `{{allApp}}`, `{{browserContent}}`, `{{now}}`, `{{promptTitles}}`
- Files: `{{file:path}}`, `{{content:path}}`
- Options: `{{option:key}}` for dropdowns
- Fallbacks: `{{selection|clipboard}}`
- Prompt properties: `{{propertyName}}`

### Actions

- Built-in: Copy, Copy as File, Paste, Edit, Pin, Share
- Custom AppleScript actions from configured script directories

## Configuration

Open Raycast Preferences → Extensions → QuickGPT (or Settings → Extension Preferences inside Prompt Lab).

### Prompt directories

- **Custom Prompts** / **Custom Prompts 1–4**: folders of `.hjson` files
- If none are set, the bundled `assets/prompts.hjson` library is used
- **Create My Prompt Library** writes a starter file to `~/Documents/QuickGPT Prompts/`

A larger example lives in [`example/prompt/prompt-template.hjson`](example/prompt/prompt-template.hjson). Point a custom directory at `example/prompt/` if you want to load it.

### Scripts directory

- **Scripts Directory** / **Scripts Directory 1–2**: folders of `.applescript` or `.scpt` files
- Each file becomes an action named after the filename (without extension)
- Example: [`example/script/ChatGPT.applescript`](example/script/ChatGPT.applescript)

Script conventions:

- QuickGPT copies the formatted prompt to the clipboard, then runs the script
- Scripts whose name ends with `ChatGPT` receive the prompt text as an argument
- A script named exactly `Notion Chat` runs in a detached process
- Scripts whose name contains `Raycast` keep the Raycast window open
- macOS Accessibility permission is required for scripts that control other apps

### Path aliases (JSON)

Map short codes to absolute directories so Finderlink-style paths resolve:

```json
{ "work": "~/Documents/Work", "notes": "~/Documents/Notes" }
```

Used for `{{file:...}}` and Finder selections such as `fk:work` or `📁 work.**notes**`.

### Actions preference

Comma-separated pinned action names. Matching uses the internal action name, not the menu title:

- Built-in: `copyToClipboard`, `paste`, `copyAsFile`
- Scripts: the AppleScript filename without extension (for example `ChatGPT`)

### Editor application

Optional. Used to open `.hjson` files. If empty, files and folders open with the system default app.

## Usage

1. Activate Raycast and run **Prompt Lab**.
2. Search prompts (Pinyin is supported) or press Space to enter input mode for `{{input}}`.
3. Pin frequently used prompts with `⌘ + Shift + P`.
4. Open the Action Panel with `⌘ + K`. `⌘ + Enter` runs the first action.

### Temporary directories

Temporary prompt directories expire after 30 days:

1. Select a folder in Finder
2. Settings → Temporary Prompts Directory → Add Temporary Directory from Finder

### Input and clipboard history

- `⌘ + Y` in input mode: last 50 unique inputs
- `⌘ + Shift + Y`: up to 6 recent clipboard items

### Deeplinks

```
raycast://extensions/ddhjy2012/quickgpt/prompt-lab?arguments={"target":"quickgpt-[identifier]"}
```

Any extra argument becomes a placeholder value and overrides context:

```
raycast://extensions/ddhjy2012/quickgpt/prompt-lab?arguments={"target":"quickgpt-translate","input":"Hello","language":"Chinese"}
```

## Prompt file format

```hjson
{
  // Required: Display title
  title: "Translation Assistant"

  // Optional: Unique identifier for pinning and deeplinks
  identifier: "translate_v1"

  // Optional: Icon (emoji or SF Symbol)
  icon: "globe"

  // Required: Main prompt content with placeholders
  content: '''
  Translate the following text into {{option:languages}}:

  {{selection|clipboard}}
  '''

  // Optional: Preferred actions for this prompt
  actions: ["copyToClipboard", "paste"]

  // Optional: Array property for dropdown options
  languages: ["French", "Spanish", "German", "Japanese"]

  // Optional: Property key references for prefix/suffix
  prefix: "responseFormat,tone"
  suffix: "signature"

  // Optional: Properties referenced by prefix/suffix
  responseFormat: "Provide a clear and concise response"
  tone: "Professional tone"
  signature: "Generated by QuickGPT"
}
```

### Nested prompts

```hjson
{
  title: "Writing Tools"
  icon: "pencil"
  identifier: "writing_tools"

  prefix: "tone"
  tone: "Professional writing style"

  subprompts: [
    {
      title: "Grammar Check"
      identifier: "grammar_check"
      content: "Check and improve grammar: {{selection}}"
    }
    {
      title: "Summarize"
      identifier: "summarize"
      content: "Summarize: {{selection}}"
      prefix: "length"
      length: "Keep it under 100 words"
    }
  ]
}
```

## Placeholder reference

| Placeholder          | Alias    | Description                                          |
| -------------------- | -------- | ---------------------------------------------------- |
| `{{input}}`          | `{{i}}`  | Text entered in Raycast input field                  |
| `{{clipboard}}`      | `{{c}}`  | Current clipboard content                            |
| `{{selection}}`      | `{{s}}`  | Selected text or Finder items                        |
| `{{currentApp}}`     |          | Name of frontmost application                        |
| `{{allApp}}`         |          | Comma-separated list of all installed applications   |
| `{{browserContent}}` |          | Markdown from the active tab (Raycast Browser Extension) |
| `{{now}}`            | `{{n}}`  | Current date and time                                |
| `{{promptTitles}}`   | `{{pt}}` | Indented list of all prompt titles                   |
| `{{prompts}}`        | `{{ps}}` | Indented list of all prompt titles and their content |
| `{{diff}}`           |          | Git diff of selected file or current repository      |
| `{{file:path}}`      |          | File or directory content                            |
| `{{content:path}}`   |          | Raw file content without filename header             |
| `{{option:key}}`     |          | Dropdown selection from array property               |
| `{{property}}`       |          | Value from prompt property                           |
| `{{ph1\|ph2}}`       |          | Fallback chain (first non-empty value)               |

`{{browserContent}}` is fetched when the frontmost app is a common browser (Safari, Chrome, Arc, Edge, Brave, Firefox, and similar) and the [Raycast Browser Extension](https://www.raycast.com/browser-extension) is installed. Failures are ignored.

### Fallback chains with directives

- `{{i|option:type}}` — input, otherwise the first `type` option
- `{{i|file:config.txt}}` — input, otherwise `config.txt`
- `{{selection|file:template.md|clipboard}}` — selection, then file, then clipboard

```hjson
{
  title: "Example Prompt"
  content: "Process this: {{i|option:defaultType}}"
  defaultType: ["text", "code", "markdown"]
}
```

See [`example/prompt/prompt-template.hjson`](example/prompt/prompt-template.hjson) for a fuller example.

### Ignoring files in directory placeholders

When `{{file:path}}` or `{{content:path}}` reads a directory, QuickGPT respects `.quickgptignore` files (gitignore syntax):

```gitignore
node_modules/
dist/
.env
*.log
```

## Development

```
quickgpt-raycast/
├── src/
│   ├── components/     # React components
│   ├── hooks/          # Custom React hooks
│   ├── managers/       # Prompt, pins, and configuration
│   ├── stores/         # LocalStorage / cache stores
│   ├── utils/          # Placeholder, editor, script helpers
│   ├── tests/          # Jest unit tests
│   └── prompt-lab.tsx  # Command entry point
├── assets/             # Icon, built-in prompts, starter library
├── example/            # Sample prompts and AppleScripts
├── package.json
└── tsconfig.json
```

```bash
npm run build    # Production build
npm run dev      # Development mode with hot reload
npm run lint     # ESLint
npm run format   # Prettier
npm test         # Jest
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -am 'Add new feature'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

Code style: TypeScript strict mode, `@raycast` ESLint config, Prettier. Comments in English.

## License

MIT. See [LICENSE](LICENSE).

## Support

Bug reports and feature requests: [GitHub Issues](https://github.com/ddhjy/quickgpt-raycast/issues).
