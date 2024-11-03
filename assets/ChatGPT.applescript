#!/usr/bin/osascript

on run {query}
    tell application "ChatGPT"
        activate
        open location "https://chatgpt.com/?&model=gpt-4o&q="
    end tell
    delay 0.3
    pressKeyCommand("v")
    delay 0.1
    my pressKeyReturn()
end run

on pressKeyCommand(key)
    tell application "System Events" to keystroke key using {command down}
end pressKeyCommand

on pressKeyReturn()
    tell application "System Events" to keystroke return
end pressKeyReturn
