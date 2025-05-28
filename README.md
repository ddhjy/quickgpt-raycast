# QuickGPT for Raycast

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/AsyncFuncAI/deepwiki-open)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

A professional prompt management extension for Raycast that **streamlines** your workflow by providing efficient access to a comprehensive library of **prompts** with advanced placeholder capabilities.

1. **streamlines**: Integrated with PopClip and Gemini, a prompt is a tool

<video src="https://github.com/user-attachments/assets/e1a222b3-2df2-496f-bf8d-7726f7fab5d0">
</video>

1. **prompts**: Management 200+ prompts with HJSON format and git version control, develop prompts like a project

<img src="https://github.com/user-attachments/assets/d94fc5b5-4e9a-41e9-abd4-ff5c48c601d6" alt="图片描述" >

## Overview

QuickGPT is a sophisticated prompt management tool designed specifically for Raycast. It enables users to organize, access, and utilize extensive prompt libraries directly within the Raycast interface. The extension supports dynamic content injection through an advanced placeholder system and seamlessly integrates with various applications and workflows.

## Key Features

### Advanced Prompt Management

- **HJSON Format Support**: Utilize the human-readable HJSON format (`.hjson`) for defining prompts, enabling version control and collaborative development
- **Hierarchical Organization**: Structure prompts in nested folders for better organization and accessibility
- **Temporary Directories**: Add temporary prompt directories with automatic expiration (7 days)
- **Multiple Source Directories**: Configure up to 5 custom prompt directories for different contexts or projects

### Sophisticated Placeholder System

- **Context-Aware Placeholders**: `{{input}}`, `{{selection}}`, `{{clipboard}}`, `{{currentApp}}`, `{{allApp}}`, `{{browserContent}}`, `{{now}}`, `{{promptTitles}}`
- **File Content Integration**: `{{file:path/to/file}}` for including external file contents
- **Dynamic Options**: `{{option:key}}` for creating interactive dropdown menus
- **Fallback Logic**: `{{selection|clipboard}}` for intelligent placeholder resolution
- **Property References**: Access prompt properties directly using `{{propertyName}}` notation

### Integration Capabilities

- **System-Wide Accessibility**: Invoke QuickGPT from any application via Raycast
- **AppleScript Support**: Execute custom AppleScript files as actions
- **Clipboard Management**: Seamless copy/paste operations with formatted content

## Installation

### Prerequisites

- macOS with [Raycast](https://www.raycast.com/) installed
- Node.js 20.8.10 or higher
- npm or yarn package manager

### Installation Steps

1. **Clone the Repository**

   ```bash
   git clone https://github.com/ddhjy/quickgpt-raycast.git
   cd quickgpt-raycast
   ```

2. **Install Dependencies**

   ```bash
   npm install
   ```

3. **Build the Extension**

   ```bash
   npm run dev
   ```

## Configuration

Configure QuickGPT through Raycast Preferences (`Raycast Settings > Extensions > QuickGPT`):

### Prompt Directories

- **Custom Prompts**: Primary directory for prompt files
- **Custom Prompts 1-4**: Additional directories for organizing prompts by context

**Recommended Setup**: To get started quickly, configure your first prompt directory to point to the included example:

[example/prompt/](example/prompt/)

This directory contains a comprehensive `prompt-template.hjson` file that demonstrates:

- Advanced placeholder usage (`{{input}}`, `{{selection}}`, `{{option:key}}`)
- Nested subprompts with hierarchical organization
- Dynamic dropdown options and property references
- Professional writing assistant templates

### Scripts Directory

- **Scripts Directory**: Location for AppleScript files (`.applescript`, `.scpt`)

**Recommended Setup**: Configure the scripts directory to:

[example/script/](example/script/)

### Actions Configuration

- **Actions**: Comma-separated list of default actions (e.g., `Copy,Paste,OpenAI`)

### Editor Settings

- **Editor Application**: Select the application for editing prompt files

## Usage

### Basic Operation

1. **Launch QuickGPT**

   - Activate Raycast and type the command alias (default: `prompt` or `quickgpt`)

2. **Browse and Search**

   - Navigate through prompts using arrow keys
   - Search by typing (supports Pinyin matching)
   - Pin frequently used prompts with `⌘ + Shift + P`

3. **Input Modes**

   - **Search Mode**: Browse and filter prompts
   - **Input Mode**: Type text followed by space to provide input for `{{input}}` placeholder

4. **Execute Actions**
   - Press `⌘ + K` to open the Action Panel
   - Use `⌘ + Enter` for the default action
   - Available actions include Copy, Paste, Script execution, and AI service calls

### Advanced Features

#### Temporary Directories

Add temporary prompt directories that automatically expire after 7 days:

1. Select a directory in Finder
2. Choose "Manage Temporary Directory" from the Settings menu
3. Select "Add Temporary Directory from Finder"

#### Deeplinks

Access specific prompts directly using deeplinks:

```
raycast://extensions/ddhjy2012/quickgpt/prompt-lab?arguments={"target":"quickgpt-[identifier]"}
```

## Prompt File Format

Prompts are defined in HJSON files with the following structure:

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
  actions: ["Copy", "Paste"]

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

### Nested Prompts

```hjson
{
  title: "Writing Tools"
  icon: "pencil"
  identifier: "writing_tools"

  // Inheritable properties
  prefix: "tone"
  tone: "Professional writing style"

  subprompts: [
    {
      title: "Grammar Check"
      identifier: "grammar_check"
      content: "Check and improve grammar: {{selection}}"
      // Inherits prefix from parent
    }
    {
      title: "Summarize"
      identifier: "summarize"
      content: "Summarize: {{selection}}"
      prefix: "length" // Overrides parent prefix
      length: "Keep it under 100 words"
    }
  ]
}
```

## Placeholder Reference

| Placeholder          | Alias    | Description                                        |
| -------------------- | -------- | -------------------------------------------------- |
| `{{input}}`          | `{{i}}`  | Text entered in Raycast input field                |
| `{{clipboard}}`      | `{{c}}`  | Current clipboard content                          |
| `{{selection}}`      | `{{s}}`  | Selected text or Finder items                      |
| `{{currentApp}}`     |          | Name of frontmost application                      |
| `{{allApp}}`         |          | Comma-separated list of all installed applications |
| `{{browserContent}}` |          | Markdown content from active browser tab           |
| `{{now}}`            | `{{n}}`  | Current date and time                              |
| `{{promptTitles}}`   | `{{pt}}` | Indented list of all prompt titles                 |
| `{{file:path}}`      |          | File or directory content                          |
| `{{option:key}}`     |          | Dropdown selection from array property             |
| `{{property}}`       |          | Value from prompt property                         |
| `{{ph1\|ph2}}`       |          | Fallback chain (first non-empty value)             |

### Fallback Chains with Directives

You can use `option:` and `file:` directives within fallback chains:

- `{{i|option:type}}` - Use input if available, otherwise use the first value from the `type` option array
- `{{i|file:config.txt}}` - Use input if available, otherwise load content from `config.txt`
- `{{selection|file:template.md|clipboard}}` - Try selection first, then file content, finally clipboard

Example in HJSON:

```hjson
{
  title: "Example Prompt"
  content: "Process this: {{i|option:defaultType}}"
  defaultType: ["text", "code", "markdown"]
}
```

Placeholder usage example:

[example/prompt/prompt-template.hjson](example/prompt/prompt-template.hjson)

## Development

### Project Structure

```
quickgpt-raycast/
├── src/
│   ├── components/     # React components
│   ├── hooks/         # Custom React hooks
│   ├── managers/      # Core managers (Prompt, Pins)
│   ├── stores/        # Data stores
│   ├── utils/         # Utility functions
│   └── prompt-lab.tsx # Main entry point
├── assets/            # Static assets and default prompts
├── package.json       # Project configuration
└── tsconfig.json     # TypeScript configuration
```

### Available Scripts

```bash
npm run build    # Build for production
npm run dev      # Development mode with hot reload
npm run lint     # Run ESLint
npm run format   # Format code with Prettier
npm run test     # Run tests
```

### Testing

The project uses Jest for unit testing. Run tests with:

```bash
npm test
```

## Contributing

Contributions are welcome. Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -am 'Add new feature'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Create a Pull Request

### Code Style

- TypeScript with strict mode enabled
- ESLint configuration extends `@raycast`
- Prettier for code formatting
- Comprehensive JSDoc comments

## License

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.

## Support

For bug reports and feature requests, please use the [GitHub Issues](https://github.com/ddhjy/quickgpt-raycast/issues) page.

## Acknowledgments

Built for the Raycast community to enhance productivity and streamline AI-powered workflows.
