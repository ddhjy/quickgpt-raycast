import { useState, useEffect } from "react";
import { getSelectedText, getFrontmostApplication, BrowserExtension, getSelectedFinderItems } from "@raycast/api";

/**
 * Custom hook to fetch initial context information needed for prompts.
 * This includes selected text, frontmost application name,
 * and content from the active browser tab (if applicable).
 *
 * @param initialClipboardText Optional pre-fetched clipboard text (no longer used).
 * @param initialSelectionText Optional pre-fetched selection text.
 * @param target Optional target identifier, used as a dependency to refetch context if needed.
 * @returns An object containing the fetched context data and a loading state indicator:
 *          { selectionText, currentApp, browserContent, isLoading }
 */
export function useInitialContext(initialSelectionText?: string, target?: string) {
  const [selectionText, setSelectionText] = useState(initialSelectionText ?? "");
  const [currentApp, setCurrentApp] = useState("");
  const [browserContent, setBrowserContent] = useState("");

  useEffect(() => {
    /**
     * Fetches the currently selected text or selected Finder items.
     * Uses initial value if provided.
     * Prioritizes selected Finder items, formatting them as `{{file:path}}` placeholders.
     * Falls back to `getSelectedText()`.
     * Handles potential errors gracefully by returning an empty string.
     *
     * @returns A promise resolving to the selected text/Finder items or an empty string.
     */
    const fetchSelectedText = async (): Promise<string> => {
      if (initialSelectionText && initialSelectionText.length > 0) {
        return initialSelectionText;
      }

      try {
        const selectedItems = await getSelectedFinderItems();
        if (selectedItems.length > 0) {
          let content = "";
          const finderMarker = "__IS_FINDER_SELECTION__";
          for (const item of selectedItems) {
            content += `${finderMarker}{{file:${item.path}}}\n`;
          }
          return content.trim();
        }
      } catch (finderError) {
        console.debug("Failed to get selected Finder items");
      }

      try {
        const text = await getSelectedText();
        return text || "";
      } catch (error) {
        console.info("No text selected or failed to get text");
        return "";
      }
    };

    /**
     * Fetches the name of the frontmost application.
     *
     * @returns A promise resolving to the application name.
     */
    const fetchFrontmostApp = async (): Promise<string> => {
      const app = await getFrontmostApplication();
      return app.name;
    };

    /**
     * Fetches the content (Markdown format) of the active browser tab using BrowserExtension API.
     * Handles potential errors (e.g., no browser active, extension not available) gracefully
     * by returning an empty string.
     *
     * @returns A promise resolving to the browser tab content (Markdown) or an empty string.
     */
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
      // Get frontmost app and selected text first
      const [fetchedFrontmostApp, fetchedSelectedText] = await Promise.all([fetchFrontmostApp(), fetchSelectedText()]);

      // Only fetch browser content if the frontmost app is a browser
      let fetchedBrowserContent = "";
      const browserNames = ["Arc"];
      if (browserNames.some((browser) => fetchedFrontmostApp.includes(browser))) {
        fetchedBrowserContent = await fetchBrowserContent();
      }

      setSelectionText(fetchedSelectedText);
      setCurrentApp(fetchedFrontmostApp);
      setBrowserContent(fetchedBrowserContent);
    };

    const timer = setTimeout(() => {
      fetchData();
    }, 10); // Add a small delay

    // Cleanup function to clear the timeout
    return () => {
      clearTimeout(timer);
    };
  }, [initialSelectionText, target]);

  return {
    selectionText,
    currentApp,
    browserContent,
  };
}
