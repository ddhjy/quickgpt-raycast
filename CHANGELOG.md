# quickgpt Changelog

## [Next Version] - YYYY-MM-DD

### Fixed

- 修复了当 Prompt 中使用 `{{option:key}}` 占位符时，跳转到的选项配置页面内容为空的问题。现在可以正确显示基于 Prompt 属性数组生成的下拉选项。

### Removed

- 移除了 "Open URL" 功能及其相关配置。
- **移除了内置的前缀命令定义**（如 `c`, `ne` 等对应的文本）及相关常量 `SUPPORTED_PREFIX_COMMANDS`。

### Changed

- **统一并完全由 HJSON 配置驱动的 `prefixCMD` 逻辑:**
  - `prefixCMD` 属性现在包含一个逗号分隔的**属性键**列表（例如 `prefixCMD: "myDirective, languageSetting"`）。
  - 系统会将 `prefixCMD` 中列出的每个键转换为对应的占位符（例如 `{{myDirective}}\n{{languageSetting}}\n`）并前置到 `content`。
  - 这些占位符将由标准的 `{{placeholder}}` 解析器处理，其值**必须**在 Prompt 的属性中定义（直接定义、通过 `rootProperty` 或继承）。
  - **完全移除了内置的命令列表（如 `c`, `ne`）和它们的默认文本。** 所有前缀文本现在必须由用户在 HJSON 文件中通过定义相应属性来提供。如果 `prefixCMD` 列出的键在 Prompt 属性中找不到，对应的占位符将不会被替换。
  - 如果 `prefixCMD` 未设置或为空，则不会添加任何前缀占位符。
  - 移除了 `prefixCMD` 中对 `!` 否定前缀和 `none` 关键字的支持。
- 优化了搜索模式（Search Mode）下的结果排序，现在会优先显示匹配的提示词（Prompts），然后才显示匹配的目录（Folders）。
- 优化了搜索模式（Search Mode）下多级目录 Prompt 标题的显示方式。现在最多只显示顶级目录名，如果原始层级超过两级（如：`顶级目录 / 子目录 / Prompt标题`），则显示为 `顶级目录 ... / Prompt标题`，以保持列表简洁性。
- 移除对JSON格式提示词文件的支持。QuickGPT现在仅支持HJSON格式(`.hjson`)文件来定义提示词，提供更好的可读性和注释支持。请确保所有提示词文件使用`.hjson`扩展名。
- 修复了在 Search Mode（搜索模式）下 `{{input}}` 占位符会被搜索框文本错误替换的问题。现在仅在 Input Mode（输入模式）下才会使用用户输入替换 `{{input}}`。

## [Initial Version] - 2023-08-19
