# quickgpt Changelog

## [Next Version] - YYYY-MM-DD

### Changed

- 移除对JSON格式提示词文件的支持。QuickGPT现在仅支持HJSON格式(`.hjson`)文件来定义提示词，提供更好的可读性和注释支持。请确保所有提示词文件使用`.hjson`扩展名。
- 修复了在 Search Mode（搜索模式）下 `{{input}}` 占位符会被搜索框文本错误替换的问题。现在仅在 Input Mode（输入模式）下才会使用用户输入替换 `{{input}}`。

## [Initial Version] - 2023-08-19
