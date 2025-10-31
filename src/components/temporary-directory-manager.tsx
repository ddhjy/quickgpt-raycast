import React, { useState, useEffect } from "react";
import {
  List,
  ActionPanel,
  Action,
  Icon,
  showToast,
  Toast,
  getSelectedFinderItems,
  Alert,
  confirmAlert,
  Color,
  Application,
  closeMainWindow,
  openExtensionPreferences,
} from "@raycast/api";
import { runAppleScript } from "@raycast/utils";
import path from "path";
import fs from "fs";
import {
  getActiveTemporaryDirectoriesWithExpiry,
  addTemporaryDirectory,
  removeTemporaryDirectory,
  removeAllTemporaryDirectories,
} from "../stores/temporary-directory-store";
import promptManager from "../managers/prompt-manager";
import configurationManager from "../managers/configuration-manager";

export type DirectoryManagerType = "temporary" | "scripts" | "prompts";

interface DirectoryManagerProps {
  type: DirectoryManagerType;
  onRefreshNeeded?: () => void;
}

interface DirectoryInfo {
  path: string;
  remainingText?: string;
  remainingMs?: number;
  addedAt?: number;
}

/**
 * Generic component for managing directories (temporary, scripts, or prompts).
 * Displays a list of directories with appropriate actions based on the type.
 */
export function DirectoryManager({ type, onRefreshNeeded }: DirectoryManagerProps) {
  const [directories, setDirectories] = useState<DirectoryInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Refresh directories list based on type
  const refreshDirectories = () => {
    if (type === "temporary") {
      const tempDirs = getActiveTemporaryDirectoriesWithExpiry();
      setDirectories(
        tempDirs.map((dir) => ({
          path: dir.path,
          remainingText: dir.remainingText,
          remainingMs: dir.remainingMs,
          addedAt: dir.addedAt,
        })),
      );
    } else if (type === "scripts" || type === "prompts") {
      const dirs = configurationManager.getDirectories(type);
      setDirectories(dirs.map((dir) => ({ path: dir })));
    }
  };

  useEffect(() => {
    refreshDirectories();
    setIsLoading(false);

    // For temporary directories, update every second to refresh remaining time
    if (type === "temporary") {
      const timer = setInterval(() => {
        refreshDirectories();
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [type]);

  // Handle opening a directory
  const handleOpenDirectory = async (dirPath: string) => {
    try {
      const customEditor = configurationManager.getPreference("customEditor") as unknown as Application;
      let openCommand: string;
      if (customEditor.bundleId && customEditor.bundleId.trim() !== "") {
        openCommand = `open -b '${customEditor.bundleId}' '${dirPath}'`;
      } else {
        openCommand = `open -a '${customEditor.path}' '${dirPath}'`;
      }
      await runAppleScript(`do shell script "${openCommand}"`);
      await closeMainWindow();
    } catch (error) {
      console.error(`Failed to open directory ${dirPath}:`, error);
      await showToast({
        title: "Error",
        message: "Failed to open directory",
        style: Toast.Style.Failure,
      });
    }
  };

  // Handle adding new temporary directory (only for temporary type)
  const handleAddDirectory = async () => {
    if (type !== "temporary") return;

    try {
      const selectedItems = await getSelectedFinderItems();
      if (selectedItems.length === 0) {
        await showToast({
          title: "Error",
          message: "Please select a directory in Finder",
          style: Toast.Style.Failure,
        });
        return;
      }

      const selectedPath = selectedItems[0].path;
      const stats = fs.statSync(selectedPath);
      if (!stats.isDirectory()) {
        await showToast({
          title: "Error",
          message: "Please select a directory instead of a file",
          style: Toast.Style.Failure,
        });
        return;
      }

      addTemporaryDirectory(selectedPath);
      promptManager.reloadPrompts();
      if (onRefreshNeeded) {
        onRefreshNeeded();
      }
      refreshDirectories();

      await showToast({
        title: "Success",
        message: `Added temporary directory: ${path.basename(selectedPath)}`,
        style: Toast.Style.Success,
      });
    } catch (error) {
      console.error("Failed to add temporary directory:", error);
      await showToast({
        title: "Error",
        message: `Failed to add temporary directory: ${String(error)}`,
        style: Toast.Style.Failure,
      });
    }
  };

  // Handle removing a temporary directory (only for temporary type)
  const handleRemoveDirectory = async (dirPath: string) => {
    if (type !== "temporary") return;

    try {
      removeTemporaryDirectory(dirPath);
      promptManager.reloadPrompts();
      if (onRefreshNeeded) {
        onRefreshNeeded();
      }
      refreshDirectories();

      await showToast({
        title: "Success",
        message: `Removed temporary directory: ${path.basename(dirPath)}`,
        style: Toast.Style.Success,
      });
    } catch (error) {
      console.error("Failed to remove temporary directory:", error);
      await showToast({
        title: "Error",
        message: `Failed to remove temporary directory: ${String(error)}`,
        style: Toast.Style.Failure,
      });
    }
  };

  // Handle removing all temporary directories (only for temporary type)
  const handleRemoveAll = async () => {
    if (type !== "temporary") return;

    try {
      const confirmed = await confirmAlert({
        title: "Remove All Temporary Directories",
        message: "Are you sure you want to remove all temporary directories?",
        primaryAction: {
          title: "Remove All",
          style: Alert.ActionStyle.Destructive,
        },
      });

      if (confirmed) {
        removeAllTemporaryDirectories();
        promptManager.reloadPrompts();
        if (onRefreshNeeded) {
          onRefreshNeeded();
        }
        refreshDirectories();

        await showToast({
          title: "Success",
          message: "Removed all temporary directories",
          style: Toast.Style.Success,
        });
      }
    } catch (error) {
      console.error("Failed to remove all temporary directories:", error);
      await showToast({
        title: "Error",
        message: `Failed to remove all temporary directories: ${String(error)}`,
        style: Toast.Style.Failure,
      });
    }
  };

  // Get navigation title and empty view text based on type
  const getNavigationTitle = () => {
    switch (type) {
      case "temporary":
        return "Manage Temporary Directories";
      case "scripts":
        return "Scripts Directories";
      case "prompts":
        return "Prompts Directories";
    }
  };

  const getEmptyTitle = () => {
    switch (type) {
      case "temporary":
        return "No Temporary Directories";
      case "scripts":
        return "No Scripts Directories";
      case "prompts":
        return "No Prompts Directories";
    }
  };

  const getEmptyDescription = () => {
    switch (type) {
      case "temporary":
        return "Add a temporary directory from Finder to get started";
      case "scripts":
        return "Configure scripts directories in extension preferences";
      case "prompts":
        return "Configure prompts directories in extension preferences";
    }
  };

  return (
    <List
      isLoading={isLoading}
      navigationTitle={getNavigationTitle()}
      searchBarPlaceholder={`Search ${type} directories...`}
    >
      {directories.length === 0 ? (
        <List.EmptyView
          icon={Icon.Folder}
          title={getEmptyTitle()}
          description={getEmptyDescription()}
          actions={
            <ActionPanel>
              {type === "temporary" ? (
                <Action title="Add Temporary Directory from Finder" icon={Icon.Plus} onAction={handleAddDirectory} />
              ) : (
                <Action
                  title="Configure"
                  icon={Icon.Gear}
                  onAction={() => {
                    openExtensionPreferences();
                    closeMainWindow();
                  }}
                />
              )}
            </ActionPanel>
          }
        />
      ) : (
        <>
          {directories.map((dir) => {
            const accessories: List.Item.Accessory[] = [];
            if (type === "temporary" && dir.remainingText && dir.remainingMs !== undefined) {
              accessories.push({
                tag: {
                  value: dir.remainingText,
                  color: dir.remainingMs < 3600000 ? Color.Red : Color.SecondaryText,
                },
              });
              if (dir.addedAt) {
                accessories.push({
                  icon: Icon.Clock,
                  tooltip: `Added: ${new Date(dir.addedAt).toLocaleString()}`,
                });
              }
            }

            return (
              <List.Item
                key={dir.path}
                title={path.basename(dir.path)}
                subtitle={dir.path}
                accessories={accessories}
                actions={
                  <ActionPanel>
                    {type === "temporary" ? (
                      <>
                        <Action
                          title="Remove"
                          icon={Icon.Trash}
                          style={Action.Style.Destructive}
                          onAction={() => handleRemoveDirectory(dir.path)}
                        />
                        <Action
                          title="Add New Directory from Finder"
                          icon={Icon.Plus}
                          onAction={handleAddDirectory}
                          shortcut={{ modifiers: ["cmd"], key: "n" }}
                        />
                        {directories.length > 1 && (
                          <Action
                            title="Remove All"
                            icon={Icon.DeleteDocument}
                            style={Action.Style.Destructive}
                            onAction={handleRemoveAll}
                            shortcut={{ modifiers: ["cmd", "shift"], key: "delete" }}
                          />
                        )}
                      </>
                    ) : (
                      <Action title="Open" icon={Icon.Folder} onAction={() => handleOpenDirectory(dir.path)} />
                    )}
                    <Action.ShowInFinder path={dir.path} shortcut={{ modifiers: ["cmd", "shift"], key: "o" }} />
                  </ActionPanel>
                }
              />
            );
          })}
        </>
      )}
    </List>
  );
}

/**
 * Backward compatibility: export TemporaryDirectoryManager as an alias
 */
export function TemporaryDirectoryManager({ onRefreshNeeded }: { onRefreshNeeded: () => void }) {
  return <DirectoryManager type="temporary" onRefreshNeeded={onRefreshNeeded} />;
}
