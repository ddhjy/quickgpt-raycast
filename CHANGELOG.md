# quickgpt Changelog

## [Next Version] - YYYY-MM-DD

### Added

- Added `suffix` property, similar to `prefix`, but appends placeholders to the end of content. Usage is the same as `prefix`, with comma-separated property key list, e.g. `suffix: "finalNote, signature"`.
- Adds the ability to select a temporary directory as a source for prompts.
- Adds a new `{{option:key}}` placeholder allowing users to create dynamic dropdowns within prompts based on prompt attributes. See [README](https://github.com/your-repo/quickgpt-raycast#dynamic-options-placeholder-optionkey) for details.
- Add support for global variables via `config.json`.
- Added an action to remove the temporary directory containing the "Manage Temporary Directory" prompt itself, if it comes from a temporary directory.
- Added action options for all prompts sourced from temporary directories (not just "Manage Temporary Directory" prompt), allowing users to remove the containing temporary directory directly from the prompt's action panel.
- Added "Editor Application" preference setting that allows users to select their preferred application for opening prompt files via an app picker. Defaults to Cursor.

### Fixed

- Fixed an issue where the options configuration page was empty when using `{{option:key}}` placeholder in prompts. Now correctly displays dropdown options generated from prompt property arrays.
- Fix an issue where relative paths (`[Path not found: relative/path]`) in prompts located within a Temporary Directory failed to resolve, causing a 'Root directory not configured for relative path:' error. Relative paths now correctly resolve against their containing temporary directory.
- Fix the issue where the `model` field in `config.json` was not taking effect.
- Fix an issue where the `currentApp` placeholder would not be replaced if the active application changed while Raycast was open.

### Changed

- **Refactored file naming convention**: Adopted kebab-case (hyphen-separated) as the unified file naming convention to improve project consistency
  - Renamed all Component files (e.g., `PromptActions.tsx` → `prompt-actions.tsx`)
  - Renamed all Hook files (e.g., `useInitialContext.ts` → `use-initial-context.ts`)
  - Renamed all Manager files (e.g., `PromptManager.ts` → `prompt-manager.ts`)
  - Renamed all Store files (e.g., `TemporaryPromptDirectoryStore.ts` → `temporary-directory-store.ts`)
  - Renamed all Utils files (e.g., `fileSystemUtils.ts` → `file-system-utils.ts`)
  - Updated all related import statements to match the new file names
- Settings-related options now use system icons instead of emojis, including "Open custom prompts directory", "Open scripts directory", and "Open preferences", for consistency with "Manage Temporary Directory".
- Temporary directory expiration time changed from 1 day to 7 days.
- Improved display of remaining time for temporary directories to show days, hours, and minutes as appropriate.
- **Refactored placeholder parsing logic:**
  - Property reference placeholders (`{{propertyName}}`) and fallback placeholders not starting with standard context (`{{ph1|ph2|...}}`) are now recursively parsed until stable.
  - Standard context placeholders (`{{input}}`, `{{clipboard}}` etc.), **raw** file content placeholders (`{{file:path}}`), and dynamic option placeholders (`{{option:key}}`) are parsed only once after recursive parsing is complete.
  - **Precise file selection handling:** Internally distinguishes the source of `{{selection}}` values using markers. Only `{{file:path}}` generated from **Finder file selections** will be further parsed to load content when needed. If user selects literal text `{{file:path}}`, file parsing is not triggered.
- Changed "Custom Editor Command" preference to "Editor Application", using app picker to let users more conveniently select the editor for editing prompt files.
- **Optimized file ignore logic:**
  - Created unified `IgnoreManager` singleton class to manage all file ignore rules
  - Enhanced `.gitignore` support to recursively find and apply all parent directory `.gitignore` files
  - Implemented ignore rule caching mechanism to improve performance
  - Support for custom ignore rule extensions
  - Unified handling of binary file detection and ignore pattern matching
