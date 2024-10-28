#!/usr/bin/osascript

on run {query}
    tell application "ChatGPT"
        activate
        open location "https://chatgpt.com/?&model=gpt-4o&hints=search&q=" & query
    end tell
    delay 0.5
    my pressKeyReturn()
end run

on pressKeyCommand(key)
    tell application "System Events" to keystroke key using {command down}
end pressKeyCommand

on pressKeyReturn()
    tell application "System Events" to keystroke return
end pressKeyReturn
