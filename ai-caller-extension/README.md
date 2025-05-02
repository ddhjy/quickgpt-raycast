# AI Caller Extension

This Raycast extension receives prompt content via deeplink and sends it to a configured AI provider.

## Setup

1.  Install the extension.
2.  Configure the `AI Provider Config Path` preference in the extension settings, pointing it to your `config.json` file.
3.  The `config.json` should follow the format specified in the original `quickgpt-raycast` extension.
4.  (Optional) Configure the `Default AI Provider` preference if you want a fallback when no provider is specified in the deeplink.

## Usage

This extension is primarily intended to be triggered via deeplink from other extensions like `quickgpt-raycast`.

The deeplink format is:

`raycast://extensions/your-author-name/ai-caller-extension/ai-call?arguments=<encoded_json>`

Where `<encoded_json>` is the URL-encoded JSON string containing:

- `promptContent` (string, required): The main prompt text.
- `systemPrompt` (string, optional): The system message for the AI.
- `providerName` (string, optional): The specific AI provider to use (must match a key in your `config.json`). If omitted, the default provider (if configured) or the first provider in the config will be used.
