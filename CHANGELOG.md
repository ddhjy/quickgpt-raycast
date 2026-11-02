# QuickGPT Changelog

## [Prompt Map] - {PR_MERGE_DATE}

- Add Prompt Map: open the whole library as an outline and mind map in the browser, search with Pinyin, and edit prompts in place
- Edits rewrite only the changed span of the `.hjson` file, preserving comments and formatting, with a backup before every write
- Drag and drop to reorder or move prompts across folders and files, multi-select to move or delete several at once, and undo with ⌘Z
- Show the Git status of prompt libraries in Prompt Map: branch and ahead/behind in the footer, change badges on cards and in the detail panel, and a Git panel listing every uncommitted file
- Bind a commit command in the Git panel and run it with one click; output and exit status are shown in the panel

## [Initial Release] - {PR_MERGE_DATE}

- Add Prompt Lab for searching and running HJSON prompt templates
- Include a built-in English prompt library (prompts ask for same-language replies) so the extension works with no extra setup
- Fill placeholders from selected text, clipboard, Finder items, files, and git diffs
- Copy, paste, copy as a file, or run custom AppleScript actions
- Optional custom prompt directories, path aliases, and editor integration
