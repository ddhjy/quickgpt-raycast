import { useState, useEffect } from "react";
import { BrowserExtension, getApplications } from "@raycast/api";
import { getGitDiff } from "../utils/git-utils";
import { expandPath } from "../utils/path-alias-utils";
import { FINDER_SELECTION_MARKER } from "../utils/placeholder-formatter";
import {
  capturedFinderItemsPromise,
  getCapturedSelectedText,
  sourceApplicationPromise,
  WECHAT_BUNDLE_ID,
} from "../utils/captured-selection";
import * as fs from "fs";

export function useInitialContext(initialSelectionText?: string, target?: string) {
  const [selectionText, setSelectionText] = useState(initialSelectionText ?? "");
  const [selectionPending, setSelectionPending] = useState(!initialSelectionText?.trim());
  const [currentApp, setCurrentApp] = useState("");
  const [allApp, setAllApp] = useState("");
  const [browserContent, setBrowserContent] = useState("");
  const [diff, setDiff] = useState("");

  useEffect(() => {
    const processSelectedText = (text: string): string => {
      if (!text || !text.trim()) {
        return text;
      }

      const trimmedText = text.trim();

      if (trimmedText.startsWith("{{") && trimmedText.endsWith("}}")) {
        return text;
      }

      const lines = trimmedText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      if (lines.length === 0) {
        return text;
      }

      const resolvedPaths: string[] = [];

      for (const line of lines) {
        if (line.startsWith("{{") && line.endsWith("}}")) {
          return text;
        }

        const expandedPath = expandPath(line);
        const candidates = expandedPath === line ? [expandedPath] : [expandedPath, line];

        let foundPath: string | null = null;
        for (const candidate of candidates) {
          try {
            fs.statSync(candidate);
            foundPath = candidate;
            break;
          } catch {
            continue;
          }
        }

        if (foundPath) {
          resolvedPaths.push(foundPath);
        } else {
          return text;
        }
      }

      return resolvedPaths.map((p) => `${FINDER_SELECTION_MARKER}{{file:${p}}}`).join("\n");
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

    let cancelled = false;

    const fetchData = async () => {
      const sourceApplication = await sourceApplicationPromise;
      if (cancelled) return;

      const fetchedFrontmostApp = sourceApplication?.name ?? "";
      setCurrentApp(fetchedFrontmostApp);
      setSelectionPending(sourceApplication?.bundleId === WECHAT_BUNDLE_ID && !initialSelectionText?.trim());

      const browserNames = [
        "Arc",
        "Safari",
        "Chrome",
        "Chromium",
        "Edge",
        "Brave",
        "Firefox",
        "Opera",
        "Vivaldi",
        "Orion",
        "Zen",
        "Dia",
        "DuckDuckGo",
      ];
      if (browserNames.some((browser) => fetchedFrontmostApp.includes(browser))) {
        void (async () => {
          const fetchedBrowserContent = await fetchBrowserContent();
          if (cancelled) return;

          setBrowserContent(fetchedBrowserContent);
        })();
      }

      void (async () => {
        const fetchedAllApps = await fetchAllApps();
        if (cancelled) return;

        setAllApp(fetchedAllApps);
      })();

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

        if (cancelled) return;
        setSelectionText(processed);
        setDiff(initialDiff);
        return;
      }

      let fetchedSelectedText = "";
      let fetchedDiff = "";
      try {
        const selectedItems = fetchedFrontmostApp.includes("Finder") ? await capturedFinderItemsPromise : [];

        if (selectedItems.length > 0) {
          let content = "";
          for (const item of selectedItems) {
            content += `${FINDER_SELECTION_MARKER}{{file:${item.path}}}\n`;
          }
          fetchedSelectedText = content.trim();
          try {
            fetchedDiff = await getGitDiff(selectedItems[0].path);
          } catch {
            fetchedDiff = "";
          }
        } else {
          fetchedSelectedText = processSelectedText(await getCapturedSelectedText(sourceApplication));
        }
      } catch (error) {
        console.info("Failed to use captured selection:", error);
        fetchedSelectedText = "";
      }

      if (cancelled) return;
      setSelectionText(fetchedSelectedText);
      setDiff(fetchedDiff);
      setSelectionPending(false);
    };

    void fetchData();

    return () => {
      cancelled = true;
    };
  }, [initialSelectionText, target]);

  return {
    selectionText,
    selectionPending,
    currentApp,
    allApp,
    browserContent,
    diff,
  };
}
