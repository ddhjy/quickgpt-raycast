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
} from "@raycast/api";
import path from "path";
import fs from "fs";
import {
  getActiveTemporaryDirectoriesWithExpiry,
  addTemporaryDirectory,
  removeTemporaryDirectory,
  removeAllTemporaryDirectories,
  TemporaryDirectoryWithExpiry,
} from "../stores/temporary-directory-store";
import promptManager from "../managers/prompt-manager";

interface TemporaryDirectoryManagerProps {
  onRefreshNeeded: () => void;
}

/**
 * Component for managing temporary prompt directories.
 * Displays a list of active temporary directories with their expiration times,
 * and provides actions to add, remove, and manage them.
 */
export function TemporaryDirectoryManager({ onRefreshNeeded }: TemporaryDirectoryManagerProps) {
  const [temporaryDirs, setTemporaryDirs] = useState<TemporaryDirectoryWithExpiry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Refresh temporary directories list
  const refreshDirectories = () => {
    setTemporaryDirs(getActiveTemporaryDirectoriesWithExpiry());
  };

  useEffect(() => {
    refreshDirectories();
    setIsLoading(false);

    // Update every second to refresh remaining time
    const timer = setInterval(() => {
      refreshDirectories();
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Handle adding new temporary directory
  const handleAddDirectory = async () => {
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
      onRefreshNeeded();
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

  // Handle removing a temporary directory
  const handleRemoveDirectory = async (dirPath: string) => {
    try {
      removeTemporaryDirectory(dirPath);
      promptManager.reloadPrompts();
      onRefreshNeeded();
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

  // Handle removing all temporary directories
  const handleRemoveAll = async () => {
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
        onRefreshNeeded();
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

  return (
    <List
      isLoading={isLoading}
      navigationTitle="Manage Temporary Directories"
      searchBarPlaceholder="Search temporary directories..."
    >
      {temporaryDirs.length === 0 ? (
        <List.EmptyView
          icon={Icon.Folder}
          title="No Temporary Directories"
          description="Add a temporary directory from Finder to get started"
          actions={
            <ActionPanel>
              <Action title="Add Temporary Directory from Finder" icon={Icon.Plus} onAction={handleAddDirectory} />
            </ActionPanel>
          }
        />
      ) : (
        <>
          {temporaryDirs.map((dir) => (
            <List.Item
              key={dir.path}
              title={path.basename(dir.path)}
              subtitle={dir.path}
              accessories={[
                {
                  tag: {
                    value: dir.remainingText,
                    color: dir.remainingMs < 3600000 ? Color.Red : Color.SecondaryText,
                  },
                },
                { icon: Icon.Clock, tooltip: `Added: ${new Date(dir.addedAt).toLocaleString()}` },
              ]}
              actions={
                <ActionPanel>
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
                  {temporaryDirs.length > 1 && (
                    <Action
                      title="Remove All"
                      icon={Icon.DeleteDocument}
                      style={Action.Style.Destructive}
                      onAction={handleRemoveAll}
                      shortcut={{ modifiers: ["cmd", "shift"], key: "delete" }}
                    />
                  )}
                  <Action.ShowInFinder path={dir.path} shortcut={{ modifiers: ["cmd", "shift"], key: "o" }} />
                </ActionPanel>
              }
            />
          ))}
        </>
      )}
    </List>
  );
}
