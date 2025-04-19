import { useState, useEffect } from "react";
import {
    Clipboard,
    getSelectedText,
    getFrontmostApplication,
    BrowserExtension,
    getSelectedFinderItems,
} from "@raycast/api";

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
) {
    const [clipboardText, setClipboardText] = useState<string>("");
    const [selectionText, setSelectionText] = useState(initialSelectionText ?? "");
    const [currentApp, setCurrentApp] = useState("");
    const [browserContent, setBrowserContent] = useState("");
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let isMounted = true;

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
                            content += `{{file:${item.path}}}` + "\n";
                        }
                        return content.trim();
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

            // Get all content concurrently
            const [
                fetchedFrontmostApp,
                fetchedClipboardText,
                fetchedSelectedText,
                potentiallyFetchedBrowserContent,
            ] = await Promise.all([
                fetchFrontmostApp(),
                fetchClipboardText(),
                fetchSelectedText(),
                fetchBrowserContent(), // Always fetch, handle conditionally later
            ]);

            // Determine final browser content based on the frontmost app
            let fetchedBrowserContent = "";
            const browserNames = ["Safari", "Google Chrome", "Firefox", "Edge", "Arc"];
            if (browserNames.some(browser => fetchedFrontmostApp.includes(browser))) {
                fetchedBrowserContent = potentiallyFetchedBrowserContent;
            }

            setClipboardText(fetchedClipboardText);
            setSelectionText(fetchedSelectedText);
            setCurrentApp(fetchedFrontmostApp);
            setBrowserContent(fetchedBrowserContent); // Set the determined value
            isMounted && setIsLoading(false);
        };

        const timer = setTimeout(() => {
            fetchData();
        }, 10); // Add a small delay

        // Cleanup function to clear the timeout
        return () => {
            isMounted = false;
            clearTimeout(timer);
        };
    }, [initialClipboardText, initialSelectionText, target]);

    return {
        clipboardText,
        selectionText,
        currentApp,
        browserContent,
        isLoading
    };
} 