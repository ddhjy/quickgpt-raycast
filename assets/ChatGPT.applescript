#!/usr/bin/osascript

on run {query}
    tell application "ChatGPT"
        activate
    end tell
    delay 0.2
    pressKeyCommand("n")
    delay 0.5
    pressKeyCommand("v")
    delay 0.5
    pressKeyReturn()
end run

on pressKeyCommand(key)
    tell application "System Events" to keystroke key using {command down}
end pressKeyCommand

on pressKeyReturn()
    tell application "System Events" to keystroke return
end pressKeyReturn