import { getSelectedFinderItems, getSelectedText } from "@raycast/api";

export type FinderItems = Awaited<ReturnType<typeof getSelectedFinderItems>>;

// Capture selection as early as possible, before heavier modules initialize and
// before the Raycast window can steal focus from the source application.
export const capturedFinderItemsPromise: Promise<FinderItems> = getSelectedFinderItems().catch(() => [] as FinderItems);

export const capturedSelectedTextPromise: Promise<string> = getSelectedText().catch(() => "");
