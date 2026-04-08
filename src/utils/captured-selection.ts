import { getSelectedFinderItems, getSelectedText } from "@raycast/api";

type FinderItems = Awaited<ReturnType<typeof getSelectedFinderItems>>;

// Capture selection as early as possible, before heavier modules initialize and
// before the Raycast window can steal focus from the source application.
export const capturedSelectionPromise: Promise<{
  finderItems: FinderItems;
  selectedText: string;
}> = Promise.all([getSelectedFinderItems().catch(() => [] as FinderItems), getSelectedText().catch(() => "")]).then(
  ([finderItems, selectedText]) => ({
    finderItems,
    selectedText,
  }),
);
