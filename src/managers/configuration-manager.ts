import { getPreferenceValues } from "@raycast/api";

/**
 * Configuration types for different directory preferences
 */
export type DirectoryPreferenceType = "prompts" | "scripts";

/**
 * Base preferences interface
 */
interface BasePreferences {
  primaryAction?: string;
  customEditor?: string;
}

/**
 * Prompts directory preferences
 */
interface PromptsPreferences extends BasePreferences {
  customPromptsDirectory?: string;
  customPromptsDirectory1?: string;
  customPromptsDirectory2?: string;
  customPromptsDirectory3?: string;
  customPromptsDirectory4?: string;
}

/**
 * Scripts directory preferences
 */
interface ScriptsPreferences extends BasePreferences {
  scriptsDirectory?: string;
  scriptsDirectory1?: string;
  scriptsDirectory2?: string;
}

/**
 * Complete preferences interface
 */
interface CompletePreferences extends PromptsPreferences, ScriptsPreferences {}

/**
 * Configuration manager for handling directory preferences
 * Eliminates redundant configuration handling across the application
 */
class ConfigurationManager {
  private static instance: ConfigurationManager;
  private cache: Map<string, string[]> = new Map();

  private constructor() {}

  static getInstance(): ConfigurationManager {
    if (!ConfigurationManager.instance) {
      ConfigurationManager.instance = new ConfigurationManager();
    }
    return ConfigurationManager.instance;
  }

  /**
   * Get all configured directories for a specific type
   * @param type The type of directories to retrieve
   * @returns Array of configured directory paths
   */
  getDirectories(type: DirectoryPreferenceType): string[] {
    const cacheKey = `directories_${type}`;

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    let directories: string[] = [];

    switch (type) {
      case "prompts":
        directories = this.getPromptDirectories();
        break;
      case "scripts":
        directories = this.getScriptDirectories();
        break;
    }

    // Filter out empty/undefined values and trim whitespace
    directories = directories.filter((dir): dir is string =>
      typeof dir === "string" && dir.trim() !== ""
    );

    this.cache.set(cacheKey, directories);
    return directories;
  }

  /**
   * Get all configured prompt directories
   * @returns Array of prompt directory paths
   */
  private getPromptDirectories(): string[] {
    const preferences = getPreferenceValues<PromptsPreferences>();
    return [
      preferences.customPromptsDirectory,
      preferences.customPromptsDirectory1,
      preferences.customPromptsDirectory2,
      preferences.customPromptsDirectory3,
      preferences.customPromptsDirectory4,
    ].filter(Boolean) as string[];
  }

  /**
   * Get all configured script directories
   * @returns Array of script directory paths
   */
  private getScriptDirectories(): string[] {
    const preferences = getPreferenceValues<ScriptsPreferences>();
    return [
      preferences.scriptsDirectory,
      preferences.scriptsDirectory1,
      preferences.scriptsDirectory2,
    ].filter(Boolean) as string[];
  }

  /**
   * Get a specific preference value
   * @param key The preference key
   * @returns The preference value
   */
  getPreference<K extends keyof CompletePreferences>(key: K): CompletePreferences[K] {
    const preferences = getPreferenceValues<CompletePreferences>();
    return preferences[key];
  }

  /**
   * Get all preferences
   * @returns Complete preferences object
   */
  getAllPreferences(): CompletePreferences {
    return getPreferenceValues<CompletePreferences>();
  }

  /**
   * Clear the cache (useful when preferences might have changed)
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Refresh cache for a specific type
   * @param type The type to refresh
   */
  refreshCache(type: DirectoryPreferenceType): void {
    const cacheKey = `directories_${type}`;
    this.cache.delete(cacheKey);
  }
}

// Export singleton instance
const configurationManager = ConfigurationManager.getInstance();
export default configurationManager;

// Export types for external use
export type { PromptsPreferences, ScriptsPreferences, CompletePreferences };
