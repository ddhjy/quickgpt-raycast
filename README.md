# QuickGPT for Raycast

QuickGPT enhances your workflow by allowing you to quickly apply pre-defined or custom prompts to selected text, clipboard content, or direct input. It integrates seamlessly with Raycast's interface.

**Core Functionality:**

- **Prompt Management:** Define and organize prompts in HJSON format (`.hjson` files) within specified directories.
- **Dynamic Placeholders:** Utilize placeholders like `{input}`, `{selection}`, `{clipboard}`, `{currentApp}`, `{browserContent}`, `{promptTitles}`, `{now}`, and file content (`{file:path/to/file.txt}`) within your prompts for context-aware text generation.
- **Option Placeholders:** Define dropdown options directly within prompt files using property paths (e.g., `{{option:models}}`) or a dedicated `options` object.
- **Action Integration:** Execute actions like Copy, Paste, running AppleScripts, or triggering other applications/extensions via deeplinks.
- **AI Integration (via AI Caller Extension):** Send processed prompt content to various AI providers by leveraging a separate **AI Caller** extension (installation required).

## Setup

1.  **Install QuickGPT:** Install this extension from the Raycast Store or manually.
2.  **Configure Prompt Directories:**
    - Go to QuickGPT's preferences in Raycast (`Raycast Settings -> Extensions -> QuickGPT`).
    - Set the `Custom Prompts` directory (and optionally `Custom Prompts 1-4`) to point to folders containing your `.hjson` prompt definition files.
    - Refer to the `prompt.schema.hjson` for the structure of prompt files.
3.  **(Required for AI Features) Install and Configure AI Caller Extension:**
    - You **must** install a separate extension designed to handle AI API calls (e.g., `ai-caller-extension` or a similar one you create/find).
    - **Configure the AI Caller extension:** Follow its specific instructions to set up API keys and provider details (usually involves setting an `AI Provider Config Path` preference pointing to a `config.json` file).
    - **Link QuickGPT to AI Caller:**
      - In QuickGPT's preferences, find the `AI Caller Extension Target` setting.
      - Enter the target deeplink identifier for your AI Caller extension's command. This usually follows the format `author-name.extension-name.command-name` (e.g., `zengkai.ai-caller-extension.ai-call`). Find the correct value in the AI Caller extension's details or documentation.
      - (Optional) In the `AI Provider Action Names` setting, enter a comma-separated list of AI provider names (e.g., `OpenAI,Claude,Azure`) that you want to appear as direct actions in QuickGPT. These names **must** match the provider names configured in your AI Caller extension's `config.json`.
4.  **(Optional) Configure Scripts Directory:**
    - Set the `Scripts Directory` preference to a folder containing `.applescript` or `.scpt` files you want to use as actions.
5.  **(Optional) Configure Default Actions:**
    - Set the `Actions` preference to define which actions (e.g., `Copy`, `Paste`, `YourScriptName`, `OpenAI`) should appear first or be the default action (⌘+Enter).

## How it Works

1.  Launch QuickGPT via its Raycast command (`prompt-lab`).
2.  A list of available prompts appears, sourced from your configured directories.
3.  **Search Mode:** Initially, you can search through all prompts by title.
4.  **Input Mode:** After selecting a prompt (or by typing text and pressing Space if search ends with a space), you enter Input Mode.
5.  Type your input text (becomes the `{input}` placeholder).
6.  Press `⌘+K` to open the Action Panel.
7.  Choose an action:
    - **Copy/Paste:** Copies or pastes the final formatted prompt content.
    - **Scripts:** Executes an AppleScript from your configured directory. The formatted prompt content is usually copied to the clipboard first.
    - **Send to [ProviderName] / Send to AI:** (Requires AI Caller setup) Triggers the configured AI Caller extension via deeplink, sending the formatted prompt content (and potentially a system prompt from the definition) to the specified AI provider.
    - **Open URL:** (If configured) Opens a predefined URL, copying the formatted prompt content first.
8.  The chosen action is executed.

## Prompt File Structure (`.hjson`)

```json
{
  "title": "My Awesome Prompt {input}", // Title shown in Raycast, can use placeholders
  "content": "Translate the following text to French: {selection}", // The core prompt text, uses placeholders
  "icon": "🇫🇷", // Optional emoji or SF Symbol name
  "pinned": false, // Optional: Set to true to pin to the top
  "model": "gpt-4", // Optional: Suggests a model (used by AI Caller)
  "temperature": 0.8, // Optional: Suggests temperature (used by AI Caller)
  "systemPrompt": "You are a professional translator.", // Optional: System message for AI (used by AI Caller)
  "actions": ["OpenAI", "Copy"], // Optional: Prioritize specific actions for this prompt
  "options": {
    // Optional: Define dropdown choices
    "Tone": ["Formal", "Informal", "Humorous"],
    "Format": ["Paragraph", "Bullet Points"]
  },
  "textInputs": {
    // Optional: Define text input fields
    "Audience": "Specify the target audience"
  },
  // You can also define options via properties and use {{option:propertyName}}
  "models": ["gpt-4", "gpt-3.5-turbo"],
  "exampleUsage": "Translate this {{option:models}} snippet."
}
```

See `prompt.schema.hjson` for full details.

## 安装方法

请确保你已经在 Mac 中安装了 [Raycast](https://www.raycast.com/)。

执行以下命令进行安装：

```bash
git clone https://github.com/ddhjy/quickgpt-raycast.git
cd quickgpt-raycast
npm install
npm run dev
```

安装完成后，请在 Raycast 中打开 `Extensions` 面板，点击导入本地扩展，选择你的 `quickgpt-raycast` 文件夹。

## 快速使用指南

### 启动扩展

在 Raycast 搜索栏输入并运行关键字 `QuickGPT` 即可打开提示模板列表，快速浏览和选择你所需的提示内容。

### 创建与管理 Prompt 模板

在你的提示词目录中创建或修改 `.hjson` 文件来添加新的提示模板数据：

```json
{
  "identifier": "my_unique_prompt",
  "title": "自定义提示标题",
  "content": "问候 {{input}}，剪贴板内容为: {{clipboard}}。",
  "options": {
    "input": ["选项1", "选项2"]
  }
}
```

模板文件修改保存之后可自动载入，无需额外操作。

### 快捷操作方式

- **复制短语**：选中提示后按快捷键 `Cmd + Shift + C` 即可将模板内容复制到剪贴板。
- **快速粘贴**：选中提示后按快捷键 `Cmd + Shift + V` 可直接粘贴到当前应用。
- **调用脚本与自动化**：支持自定义脚本执行，配合提示动态内容实现复杂自动化工作。

## 内置占位符支持

使用以下占位符可以动态替换提示内容中的变量：

| 占位符               | 别名     | 说明                                                 | 示例                          |
| -------------------- | -------- | ---------------------------------------------------- | ----------------------------- |
| `{{input}}`          | `{{i}}`  | Raycast 搜索框输入的文本                             | 输入内容: {{input}}           |
| `{{clipboard}}`      | `{{c}}`  | 当前剪贴板文本                                       | 剪贴板: {{clipboard}}         |
| `{{selection}}`      | `{{s}}`  | 当前前台应用中选中的文本                             | 选中文本: {{selection}}       |
| `{{currentApp}}`     | -        | 当前激活的应用程序名称                               | 应用: {{currentApp}}          |
| `{{browserContent}}` | -        | 浏览器当前标签页面选中的文本 _(需Raycast浏览器插件)_ | 网页内容: {{browserContent}}  |
| `{{now}}`            | `{{n}}`  | 当前日期与时间                                       | 当前时间: {{now}}             |
| `{{promptTitles}}`   | `{{pt}}` | 提供所有提示标题的摘要列表                           | 提示列表:\n{{promptTitles}}   |
| `{{file:filepath}}`  | -        | 读取指定文件或目录的内容                             | 文件内容: {{file:./data.txt}} |

**关于 `{{file:filepath}}`:**

- 支持**绝对路径** (例如 `/Users/user/Documents/file.txt`) 和**相对路径** (例如 `data.txt`, `./subdir/notes.md`)。
- **相对路径**会相对于**包含该提示词的自定义提示目录** (在 QuickGPT 偏好设置中配置的 `customPromptsDirectory` 等) 进行解析。
- 如果 `filepath` 指向一个**文件**，则会读取并插入该文件的 UTF-8 文本内容。
- 如果 `filepath` 指向一个**目录**，则会递归读取该目录的内容（忽略二进制文件和 `.gitignore` 风格的模式），并将其格式化为文本插入。
- 如果路径不存在或无权访问，会插入相应的错误或警告信息。

### 高级用法

- 多个替代选项依次尝试（第一个有数据的占位符将生效）：
  - 如 `{{input|selection|clipboard}}`
- 显示占位符文字而非具体内容（便于模板演示）：
  - 在占位符前添加 `p:` 前缀，如 `{{p:input}}`

## 如何贡献

欢迎通过以下流程贡献代码或提出改进：

1. Fork 项目仓库
2. 创建新分支 (`git checkout -b feature/my-feature`)
3. 修改后提交代码 (`git commit -m '新增特性说明'`)
4. 推送至远端 (`git push origin feature/my-feature`)
5. 提交 Pull Request 并说明贡献内容

## 问题反馈与交流

- 发现软件缺陷或希望获得新功能支持，请前往 [GitHub issues](https://github.com/ddhjy/quickgpt/issues) 提交反馈。
- 邮件联系: your-email@example.com

我们重视各类反馈与建议，持续优化产品体验。

## 开源许可协议

QuickGPT 基于 MIT 协议开源发布，具体详细信息请参考 [LICENSE 文件](LICENSE)。

---

感谢你的关注和支持，如觉得有帮助请给本项目一个 GitHub star，同时欢迎向更多人分享这款工具。
