import { useState, useEffect } from "react";
import {
  getSelectedText,
  getFrontmostApplication,
  BrowserExtension,
  getSelectedFinderItems,
  getApplications,
} from "@raycast/api";
import { getGitDiff } from "../utils/git-utils";
import { expandPath } from "../utils/path-alias-utils";
import * as fs from "fs";

type FinderItems = Awaited<ReturnType<typeof getSelectedFinderItems>>;

const capturedSelectionPromise: Promise<{
  finderItems: FinderItems;
  selectedText: string;
}> = Promise.all([getSelectedFinderItems().catch(() => [] as FinderItems), getSelectedText().catch(() => "")]).then(
  ([finderItems, selectedText]) => ({
    finderItems,
    selectedText,
  }),
);

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

        const expandedPath = expandPath(potentialPath);
        const candidates = expandedPath === potentialPath ? [expandedPath] : [expandedPath, potentialPath];

        for (const candidate of candidates) {
          try {
            fs.statSync(candidate);
            return `${finderMarker}{{file:${candidate}}}`;
          } catch {
            continue;
          }
        }
      }
      return text;
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
      const [fetchedFrontmostApp, fetchedAllApps] = await Promise.all([fetchFrontmostApp(), fetchAllApps()]);

      let fetchedBrowserContent = "";
      const browserNames = ["Arc"];
      if (browserNames.some((browser) => fetchedFrontmostApp.includes(browser))) {
        fetchedBrowserContent = await fetchBrowserContent();
      }

      if (initialSelectionText && initialSelectionText.trim()) {
        const rawInitial = initialSelectionText.trim();
        const processed = processSelectedText(rawInitial);

        let initialDiff = "";
        try {
          let pathCandidate: string | undefined;

          const match = processed.match(/\{\{file:([^}]+)\}\}/);
          if (match && match[1]) {
            pathCandidate = match[1];
          } else {
            try {
              fs.statSync(rawInitial);
              pathCandidate = rawInitial;
            } catch {
              // ignore
            }
          }

          if (pathCandidate) {
            initialDiff = await getGitDiff(pathCandidate);
          }
        } catch {
          // ignore
        }

        setSelectionText(processed);
        setCurrentApp(fetchedFrontmostApp);
        setAllApp(fetchedAllApps);
        setBrowserContent(fetchedBrowserContent);
        setDiff(initialDiff);
        return;
      }

      let fetchedSelectedText = "";
      let fetchedDiff = "";
      try {
        const { finderItems: selectedItems, selectedText: capturedSelectedText } = await capturedSelectionPromise;

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
