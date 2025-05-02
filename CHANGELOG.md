# quickgpt Changelog

## [Next Version] - YYYY-MM-DD

### Removed

- 移除了 "Open URL" 功能及其相关配置。

### Changed

- 优化了搜索模式（Search Mode）下多级目录 Prompt 标题的显示方式。现在最多只显示顶级目录名，如果原始层级超过两级（如：`顶级目录 / 子目录 / Prompt标题`），则显示为 `顶级目录 ... / Prompt标题`，以保持列表简洁性。
- 移除对JSON格式提示词文件的支持。QuickGPT现在仅支持HJSON格式(`.hjson`)文件来定义提示词，提供更好的可读性和注释支持。请确保所有提示词文件使用`.hjson`扩展名。
- 修复了在 Search Mode（搜索模式）下 `{{input}}` 占位符会被搜索框文本错误替换的问题。现在仅在 Input Mode（输入模式）下才会使用用户输入替换 `{{input}}`。

## [Initial Version] - 2023-08-19
