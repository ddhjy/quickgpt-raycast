import { useState, useEffect } from "react";
import {
    Clipboard,
    getSelectedText,
    getFrontmostApplication,
    BrowserExtension,
    getSelectedFinderItems,
} from "@raycast/api";
import fsPromises from "fs/promises";
import path from "path";
import { isBinaryOrMediaFile, readDirectoryContents } from "../utils/fileSystemUtils";

interface InitialContextResult {
    clipboardText: string;
    selectionText: string;
    currentApp: string;
    browserContent: string;
    isLoading: boolean;
}

export function useInitialContext(
    initialClipboardText?: string,
    initialSelectionText?: string,
    target?: string,
    activateOCR?: string
): InitialContextResult {
    const [clipboardText, setClipboardText] = useState(initialClipboardText ?? "");
    const [selectionText, setSelectionText] = useState(initialSelectionText ?? "");
    const [currentApp, setCurrentApp] = useState("");
    const [browserContent, setBrowserContent] = useState("");
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchClipboardText = async (): Promise<string> => {
            if (initialClipboardText && initialClipboardText.length > 0) {
                return initialClipboardText;
            }
            try {
                const text = await Clipboard.readText();
                return text ?? "";
            } catch (error) {
                console.info("Failed to read clipboard text. Returning empty string.", error);
                return "";
            }
        };

        const fetchSelectedText = async (): Promise<string> => {
            if (initialSelectionText && initialSelectionText.length > 0) {
                return initialSelectionText;
            }

            try {
                try {
                    const selectedItems = await getSelectedFinderItems();
                    if (selectedItems.length > 0) {
                        let content = '';
                        for (const item of selectedItems) {
                            const itemPath = item.path;
                            const stats = await fsPromises.stat(itemPath);

                            if (stats.isFile()) {
                                if (!isBinaryOrMediaFile(itemPath)) {
                                    const fileContent = await fsPromises.readFile(itemPath, 'utf-8');
                                    content += `File: ${path.basename(itemPath)}\n${fileContent}\n\n`;
                                } else {
                                    content += `File: ${path.basename(itemPath)} (binary or media file, content ignored)\n\n`;
                                }
                            } else if (stats.isDirectory()) {
                                content += await readDirectoryContents(itemPath);
                            }
                        }
                        return content;
                    }
                } catch (finderError) {
                    // Continue execution
                }

                const text = await getSelectedText();
                if (text) {
                    return text;
                }

                return "";
            } catch (error) {
                console.info("No text selected");
                return "";
            }
        };

        const fetchFrontmostApp = async (): Promise<string> => {
            const app = await getFrontmostApplication();
            return app.name;
        };

        const fetchBrowserContent = async (): Promise<string> => {
            try {
                const content = await BrowserExtension.getContent({ format: "markdown" });
                return content;
            } catch (error) {
                console.info("Failed to fetch browser content:", error);
                return "";
            }
        };

        const fetchData = async () => {
            setIsLoading(true);

            // First get the foreground application name
            const frontmostApp = await fetchFrontmostApp();

            // Get other content in parallel
            const [fetchedClipboardText, fetchedSelectedText] = await Promise.all([
                fetchClipboardText(),
                fetchSelectedText(),
            ]);

            // Only get browser content if the foreground app is a browser
            let fetchedBrowserContent = "";
            // Check if the foreground app is a browser (may need to adjust browser name list based on actual situation)
            const browserNames = ["Safari", "Google Chrome", "Firefox", "Edge", "Arc"];
            if (browserNames.some(browser => frontmostApp.includes(browser))) {
                fetchedBrowserContent = await fetchBrowserContent();
            }

            setClipboardText(fetchedClipboardText);
            setSelectionText(fetchedSelectedText);
            setCurrentApp(frontmostApp);
            setBrowserContent(fetchedBrowserContent);
            setIsLoading(false);
        };

        fetchData();
    }, [initialClipboardText, initialSelectionText, target, activateOCR]);

    return {
        clipboardText,
        selectionText,
        currentApp,
        browserContent,
        isLoading
    };
} 