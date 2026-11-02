import React from "react";
import { Action, Icon, Toast, closeMainWindow, openExtensionPreferences, showToast } from "@raycast/api";
import configurationManager from "../managers/configuration-manager";
import { getActiveTemporaryDirectories } from "../stores/temporary-directory-store";
import { createPromptLibrary } from "../utils/prompt-library-onboarding";
import { openPromptMap } from "../utils/prompt-map-launcher";
import { PromptStats } from "./prompt-stats";
import { DirectoryManager } from "./temporary-directory-manager";

/** How a settings entry from `assets/system_prompts.hjson` is presented in the list. */
export interface SettingsItem {
  icon: Icon;
  /** Replaces the title from the prompt file. */
  title?: string;
  /** Number of directories behind the entry, shown as an accessory. */
  directoryCount?: number;
  action: React.ReactElement;
}

function openPreferences() {
  openExtensionPreferences();
  closeMainWindow();
}

async function createLibrary() {
  try {
    const result = await createPromptLibrary();
    const createdAnything = result.createdDirectory || result.copiedFile;
    await showToast({
      style: Toast.Style.Success,
      title: createdAnything ? "Prompt library created" : "Prompt library already exists",
      message: `Set Custom Prompts to ${result.directory}`,
    });
    await openExtensionPreferences();
    await closeMainWindow();
  } catch (error) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Couldn't create prompt library",
      message: String(error),
    });
  }
}

async function showPromptMap() {
  const toast = await showToast({ style: Toast.Style.Animated, title: "Opening Prompt Map…" });
  try {
    const result = await openPromptMap();
    toast.style = Toast.Style.Success;
    toast.title = result.mode === "server" ? "Prompt Map opened" : "Prompt Map opened (read-only)";
    if (result.mode === "static") {
      toast.message = "The local server couldn't start, so editing is unavailable.";
    }
    await closeMainWindow();
  } catch (error) {
    toast.style = Toast.Style.Failure;
    toast.title = "Couldn't open Prompt Map";
    toast.message = String(error);
  }
}

/**
 * Settings entries are ordinary prompts in the library, recognized by their
 * identifier. Returns undefined for every other prompt.
 */
export function resolveSettingsItem(identifier: string, onRefreshNeeded: () => void): SettingsItem | undefined {
  switch (identifier) {
    case "manage-temporary-directory": {
      const count = getActiveTemporaryDirectories().length;
      return {
        icon: count > 0 ? Icon.Folder : Icon.Plus,
        title: count > 0 ? "Temporary Prompts Directory" : "Add Temporary Directory",
        directoryCount: count || undefined,
        action: (
          <Action.Push
            title="Open"
            icon={Icon.List}
            target={<DirectoryManager type="temporary" onRefreshNeeded={onRefreshNeeded} />}
          />
        ),
      };
    }
    case "open-custom-prompts-dir":
      return {
        icon: Icon.Folder,
        directoryCount: configurationManager.getDirectories("prompts").length || undefined,
        action: <Action.Push title="Open" icon={Icon.List} target={<DirectoryManager type="prompts" />} />,
      };
    case "open-scripts-dir": {
      const count = configurationManager.getDirectories("scripts").length;
      return {
        icon: Icon.Code,
        directoryCount: count || undefined,
        action:
          count === 0 ? (
            <Action title="Configure" icon={Icon.Gear} onAction={openPreferences} />
          ) : (
            <Action.Push title="Open" icon={Icon.List} target={<DirectoryManager type="scripts" />} />
          ),
      };
    }
    case "open-preferences":
      return { icon: Icon.Gear, action: <Action title="Open" icon={Icon.Gear} onAction={openPreferences} /> };
    case "create-prompt-library":
      return {
        icon: Icon.NewDocument,
        action: <Action title="Create" icon={Icon.NewDocument} onAction={createLibrary} />,
      };
    case "prompt-usage-stats":
      return {
        icon: Icon.BarChart,
        action: <Action.Push title="Open" icon={Icon.BarChart} target={<PromptStats />} />,
      };
    case "prompt-map":
      return { icon: Icon.Network, action: <Action title="Open" icon={Icon.Network} onAction={showPromptMap} /> };
    default:
      return undefined;
  }
}
