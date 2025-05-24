# quickgpt Changelog

## [Next Version] - YYYY-MM-DD

### Added

- 新增 `suffix` 属性，类似于 `prefix`，但会将占位符添加到内容的末尾。用法与 `prefix` 相同，通过逗号分隔的属性键列表，如 `suffix: "finalNote, signature"`。
- Adds the ability to select a temporary directory as a source for prompts.
- Adds a new `{{option:key}}` placeholder allowing users to create dynamic dropdowns within prompts based on prompt attributes. See [README](https://github.com/your-repo/quickgpt-raycast#dynamic-options-placeholder-optionkey) for details.
- Add support for global variables via `config.json`.
- 在 "Manage Temporary Directory" 提示词的选项中，如果该提示词本身来自一个临时目录，则新增一个操作以移除其所在的临时目录。
- 为所有来源于临时目录的提示词（而不仅限于 "Manage Temporary Directory" 提示词）添加了操作选项，用户可以直接从该提示词的操作面板中移除其所在的临时目录。
- 新增"编辑器应用"偏好设置，允许用户通过应用选择器选择他们喜欢的应用程序来打开提示文件。默认为 Cursor。

### Fixed

- 修复了当 Prompt 中使用 `{{option:key}}` 占位符时，跳转到的选项配置页面内容为空的问题。现在可以正确显示基于 Prompt 属性数组生成的下拉选项。
- Fix an issue where relative paths (`[Path not found: relative/path]`) in prompts located within a Temporary Directory failed to resolve, causing a 'Root directory not configured for relative path:' error. Relative paths now correctly resolve against their containing temporary directory.
- Fix the issue where the `model` field in `config.json` was not taking effect.
- Fix an issue where the `currentApp` placeholder would not be replaced if the active application changed while Raycast was open.

### Changed

- Settings 相关选项统一使用系统 icon 替代 emoji，包括 "Open custom prompts directory"、"Open scripts directory" 和 "Open preferences"，以保持与 "Manage Temporary Directory" 的一致性。
- Temporary directory expiration time changed from 1 day to 7 days.
- Improved display of remaining time for temporary directories to show days, hours, and minutes as appropriate.
- **重构占位符解析逻辑:**
  - 属性引用占位符 (`{{propertyName}}`) 和不以标准上下文开头的回退占位符 (`{{ph1|ph2|...}}`) 现在会进行循环解析直至稳定。
  - 标准上下文占位符 (`{{input}}`, `{{clipboard}}` 等)、**原始的**文件内容占位符 (`{{file:path}}`) 和动态选项占位符 (`{{option:key}}`) 在循环解析完成后仅进行一次性解析。
  - **精确处理文件选择:** 内部通过标记区分 `{{selection}}` 值的来源。只有当其值来源于 **Finder 中的文件选择**时，其生成的 `{{file:path}}` 才会在需要时被进一步解析加载内容。若用户选中的是字面文本 `{{file:path}}`，则不触发文件解析。
- 将"自定义编辑器命令"偏好设置更改为"编辑器应用"，使用应用选择器（appPicker）让用户更方便地选择用于编辑提示文件的编辑器。
- **优化文件忽略逻辑：**
  - 创建统一的 `IgnoreManager` 单例类来管理所有文件忽略规则
  - 增强 `.gitignore` 支持，递归查找并应用所有父目录的 `.gitignore` 文件
  - 实现忽略规则缓存机制，提升性能
  - 支持自定义忽略规则扩展
  - 统一处理二进制文件检测和忽略模式匹配
