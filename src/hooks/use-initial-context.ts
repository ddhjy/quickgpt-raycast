import { useState, useEffect } from "react";
import {
  getSelectedText,
  getFrontmostApplication,
  BrowserExtension,
  getSelectedFinderItems,
  getApplications,
} from "@raycast/api";
import { getGitDiff } from "../utils/git-utils";
import * as fs from "fs";

type FinderItems = Awaited<ReturnType<typeof getSelectedFinderItems>>;

// Capture Finder selection and text before the Raycast window steals focus.
const capturedSelectionPromise: Promise<{
  finderItems: FinderItems;
  selectedText: string;
}> = Promise.all([
  getSelectedFinderItems().catch(() => [] as FinderItems),
  getSelectedText().catch(() => ""),
]).then(([finderItems, selectedText]) => ({
  finderItems,
  selectedText,
}));

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
  const [allApp, setAllApp] = useState("");
  const [browserContent, setBrowserContent] = useState("");
  const [diff, setDiff] = useState("");

  useEffect(() => {
    const finderMarker = "__IS_FINDER_SELECTION__";

    const processSelectedText = (text: string): string => {
      if (text && text.trim()) {
        const potentialPath = text.trim();
        if (potentialPath.startsWith("{{") && potentialPath.endsWith("}}")) {
          return text;
        }
        try {
          fs.statSync(potentialPath);
          return `${finderMarker}{{file:${potentialPath}}}`;
        } catch {
          return text;
        }
      }
      return text;
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

    /**
     * Fetches the list of all installed applications.
     * Handles potential errors gracefully by returning an empty string.
     *
     * @returns A promise resolving to a comma-separated list of application names.
     */
    const fetchAllApps = async (): Promise<string> => {
      try {
        const apps = await getApplications();
        return apps.map((app) => app.name).join(", ");
      } catch (error) {
        console.info("Failed to fetch all applications:", error);
        return "";
      }
    };

    const fetchData = async () => {
      const [fetchedFrontmostApp, fetchedAllApps] = await Promise.all([
        fetchFrontmostApp(),
        fetchAllApps(),
      ]);

      let fetchedBrowserContent = "";
      const browserNames = ["Arc"];
      if (browserNames.some((browser) => fetchedFrontmostApp.includes(browser))) {
        fetchedBrowserContent = await fetchBrowserContent();
      }

      // If an initial selection text is provided (e.g., from URL arguments),
      // prefer it and attempt to parse as a file path just like Finder selection.
      if (initialSelectionText && initialSelectionText.trim()) {
        const rawInitial = initialSelectionText.trim();
        const processed = processSelectedText(rawInitial);

        let initialDiff = "";
        try {
          // Try to extract path from placeholder/wrapped form or validate raw path
          let pathCandidate: string | undefined;

          const match = processed.match(/\{\{file:([^}]+)\}\}/);
          if (match && match[1]) {
            pathCandidate = match[1];
          } else {
            try {
              fs.statSync(rawInitial);
              pathCandidate = rawInitial;
            } catch {
              // Not a valid path; leave pathCandidate undefined
            }
          }

          if (pathCandidate) {
            initialDiff = await getGitDiff(pathCandidate);
          }
        } catch {
          // Ignore diff errors
        }

        setSelectionText(processed);
        setCurrentApp(fetchedFrontmostApp);
        setAllApp(fetchedAllApps);
        setBrowserContent(fetchedBrowserContent);
        setDiff(initialDiff);
        return; // Short-circuit: we've handled initialSelectionText
      }

      // Get selection text and diff
      let fetchedSelectedText = "";
      let fetchedDiff = "";
      try {
        const { finderItems: selectedItems, selectedText: capturedSelectedText } =
          await capturedSelectionPromise;

        if (selectedItems.length > 0) {
          let content = "";
          for (const item of selectedItems) {
            content += `${finderMarker}{{file:${item.path}}}\n`;
          }
          fetchedSelectedText = content.trim();
          try {
            fetchedDiff = await getGitDiff(selectedItems[0].path);
          } catch {
            fetchedDiff = "";
          }
        } else {
          fetchedSelectedText = processSelectedText(capturedSelectedText || "");
        }
      } catch (error) {
        console.info("Failed to use captured selection:", error);
        try {
          const fallbackText = (await getSelectedText()) || "";
          fetchedSelectedText = processSelectedText(fallbackText);
        } catch {
          fetchedSelectedText = "";
        }
      }

      setSelectionText(fetchedSelectedText);
      setCurrentApp(fetchedFrontmostApp);
      setAllApp(fetchedAllApps);
      setBrowserContent(fetchedBrowserContent);
      setDiff(fetchedDiff);
    };

    const timer = setTimeout(() => {
      fetchData();
    }, 10);

    return () => {
      clearTimeout(timer);
    };
  }, [initialSelectionText, target]);

  return {
    selectionText,
    currentApp,
    allApp,
    browserContent,
    diff,
  };
}
