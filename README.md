# QuickGPT – Raycast 智能提示管理工具

QuickGPT 是一款专门为 Raycast 设计的高效提示模板管理工具，致力于为用户提供快速的提示访问与自动化内容生成能力。通过灵活配置的提示结构和丰富的动态占位符机制，QuickGPT 能够优化你的工作流程并显著提升生产力，特别适合于开发、文档撰写、日常办公以及其他需要频繁内容重复输入的场景。

## 核心功能

- **自定义 Prompt 模板**  
  使用简单的 JSON 格式文件，自由创建和管理符合你特定需求的提示模板，一次设置持续受用。

- **动态占位符替换能力**  
  提供强大的占位符引擎，可自动插入剪贴板内容、选中文本、应用程序信息、当前时间等动态数据，避免重复劳动。

- **快捷键与操作整合**  
  深度集成 Raycast，支持一键快速复制提示内容、粘贴到指定位置以及调用自定义脚本，实现自动化操作闭环。

- **提示持久保存与管理**  
  所有用户定义的提示模板都会自动保存并永久可用，便于长期和重复调用。

- **国际化语言支持**  
  原生支持中文及其他多语言，方便不同语言环境下的高效提示管理。

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

在默认路径（`assets/prompts.pm.json`）下添加新的提示模板数据：

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
