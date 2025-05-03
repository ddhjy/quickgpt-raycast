# quickgpt Changelog

## [Next Version] - YYYY-MM-DD

### Added

- 新增 `suffix` 属性，类似于 `prefix`，但会将占位符添加到内容的末尾。用法与 `prefix` 相同，通过逗号分隔的属性键列表，如 `suffix: "finalNote, signature"`。
- Adds the ability to select a temporary directory as a source for prompts.
- Adds a new `{{option:key}}` placeholder allowing users to create dynamic dropdowns within prompts based on prompt attributes. See [README](https://github.com/your-repo/quickgpt-raycast#dynamic-options-placeholder-optionkey) for details.
- Add support for global variables via `config.json`.

### Fixed

- 修复了当 Prompt 中使用 `{{option:key}}` 占位符时，跳转到的选项配置页面内容为空的问题。现在可以正确显示基于 Prompt 属性数组生成的下拉选项。
- Fix an issue where relative paths (`[Path not found: relative/path]`) in prompts located within a Temporary Directory failed to resolve, causing a 'Root directory not configured for relative path:' error. Relative paths now correctly resolve against their containing temporary directory.
- Fix the issue where the `model` field in `config.json` was not taking effect.
- Fix an issue where the `currentApp` placeholder would not be replaced if the active application changed while Raycast was open.

### Changed

- 将 HJSON 配置中的 `
