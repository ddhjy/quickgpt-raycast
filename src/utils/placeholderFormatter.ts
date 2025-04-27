/**
 * This file provides utility functions for formatting text with placeholders.
 * It supports both synchronous and asynchronous implementations for replacing:
 * - Simple placeholders (input, clipboard, selection, etc.)
 * - File content placeholders for reading files/directories
 * - Fallback handling with alias support
 * - Property path access for referencing prompt object properties
 * 
 * The formatter processes all placeholders in a single RegExp scan for efficiency.
 */

import fs from 'fs';
import path from 'path';
import { readDirectoryContentsSync } from './fileSystemUtils';

/* Types & Constants */

export type SpecificReplacements = {
    input?: string;
    clipboard?: string;
    selection?: string;
    currentApp?: string;
    browserContent?: string;
    now?: string;
    promptTitles?: string;
};

type PlaceholderKey = keyof SpecificReplacements;
type PlaceholderInfo = { literal: string; alias?: string };

// Log level definition
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

// Logger configuration
export interface LoggerConfig {
    level: LogLevel;
    enabled: boolean;
}

// Default logger configuration
const defaultLoggerConfig: LoggerConfig = {
    level: 'info',
    enabled: true,
};

// Current logger configuration
let loggerConfig: LoggerConfig = { ...defaultLoggerConfig };

// Log level weights
const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    none: 4,
};

const PLACEHOLDERS: Record<PlaceholderKey, PlaceholderInfo> = {
    input: { literal: '<Input text>', alias: 'i' },
    selection: { literal: '<Selected text>', alias: 's' },
    clipboard: { literal: '<Clipboard text>', alias: 'c' },
    currentApp: { literal: '<Current application>' },
    browserContent: { literal: '<Browser content>' },
    now: { literal: '<Current time>', alias: 'n' },
    promptTitles: { literal: '<Prompt titles>', alias: 'pt' },
};

// alias ⇒ key
const ALIAS_TO_KEY = new Map<string, PlaceholderKey>(
    Object.entries(PLACEHOLDERS)
        .filter(([, { alias }]) => alias)
        .map(([key, { alias }]) => [alias as string, key as PlaceholderKey]),
);

/* Utility Functions */

const PH_REG = /{{(?:(file|option):)?([^}]+)}}/g;     // Modified: Single regex for all placeholders including option
const isNonEmpty = (v: unknown): v is string =>
    typeof v === 'string' && v.trim() !== '';

const toPlaceholderKey = (p: string): PlaceholderKey | undefined =>
    (ALIAS_TO_KEY.get(p) ?? (p as PlaceholderKey)) satisfies PlaceholderKey;

/**
 * Internal logging function
 */
function logInternal(level: LogLevel, message: string, ...args: unknown[]): void {
    if (!loggerConfig.enabled || LOG_LEVEL_WEIGHT[level] < LOG_LEVEL_WEIGHT[loggerConfig.level]) {
        return;
    }

    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${level.toUpperCase()}] [PlaceholderFormatter] ${message}`;

    switch (level) {
        case 'debug':
            console.debug(formattedMessage, ...args);
            break;
        case 'info':
            console.info(formattedMessage, ...args);
            break;
        case 'warn':
            console.warn(formattedMessage, ...args);
            break;
        case 'error':
            console.error(formattedMessage, ...args);
            break;
    }
}

/**
 * Logger object with methods for different log levels
 */
export const logger = {
    debug: (message: string, ...args: unknown[]) => logInternal('debug', message, ...args),
    info: (message: string, ...args: unknown[]) => logInternal('info', message, ...args),
    warn: (message: string, ...args: unknown[]) => logInternal('warn', message, ...args),
    error: (message: string, ...args: unknown[]) => logInternal('error', message, ...args),
};

/**
 * Configure the logging system
 */
export function configureLogger(config: Partial<LoggerConfig>): void {
    const oldLevel = loggerConfig.level;
    const oldEnabled = loggerConfig.enabled;

    loggerConfig = { ...loggerConfig, ...config };

    console.log(`[PlaceholderFormatter] Logger config updated: level=${loggerConfig.level}(was:${oldLevel}), enabled=${loggerConfig.enabled}(was:${oldEnabled})`);
}

/**
 * Builds an effective replacement map from raw replacements.
 * Filters out empty values, trims strings, and adds the current time if not present.
 * 
 * @param raw The raw replacement values to process
 * @returns A Map of valid placeholder keys to their replacement values
 */
function buildEffectiveMap(raw: Partial<SpecificReplacements> & Record<string, unknown>) {
    const m = new Map<PlaceholderKey, string>();
    // Only process standard placeholder keys defined in SpecificReplacements
    Object.entries(raw).forEach(([k, v]) => {
        if (k in PLACEHOLDERS && isNonEmpty(v as string)) m.set(k as PlaceholderKey, (v as string).trim());
    });
    if (!m.has('now')) m.set('now', new Date().toLocaleString());
    return m;
}

/* File Placeholder Handling */

/**
 * Safely resolves a path to an absolute path, with security checks.
 * 
 * @param given The path to resolve
 * @param root The root directory for relative paths
 * @returns The resolved absolute path or an Error if resolution fails
 */
function safeResolveAbsolute(given: string, root?: string): string | Error {
    logger.debug(`Attempting to resolve path: "${given}", root: "${root || 'not set'}"`);

    const trimmed = given.trim();
    if (path.isAbsolute(trimmed)) {
        logger.debug(`Processing absolute path: "${trimmed}"`);
        return trimmed;
    }

    if (!root) {
        const error = `Root directory not configured for relative path: ${trimmed}`;
        logger.error(error);
        return new Error(error);
    }

    const resolved = path.resolve(root, trimmed);
    logger.debug(`Resolved relative path: "${trimmed}" => "${resolved}"`);

    if (!resolved.startsWith(root)) {
        const error = `Path traversal detected for: ${trimmed}`;
        logger.error(error);
        return new Error(error);
    }

    return resolved;
}

/**
 * Resolves a file placeholder synchronously, reading file or directory contents.
 * 
 * @param body The file path to resolve
 * @param root The root directory for relative paths
 * @returns Formatted string containing file/directory content or error message
 */
function resolveFilePlaceholderSync(body: string, root?: string): string {
    const absOrErr = safeResolveAbsolute(body, root);
    if (absOrErr instanceof Error) return `[Error: ${absOrErr.message}]`;

    try {
        const stats = fs.statSync(absOrErr);
        if (stats.isFile())
            return `File: ${body.trim()}\n${fs.readFileSync(absOrErr, 'utf-8')}\n\n`;
        if (stats.isDirectory()) {
            const header = `Directory: ${body.trim()}${path.sep}\n`;
            const content = readDirectoryContentsSync(absOrErr, '');
            return `${header}${content}`;
        }
        return `[Unsupported path type: ${body}]`;
    } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return `[Path not found: ${body}]`;
        if (code === 'EACCES') return `[Permission denied: ${body}]`;
        return `[Error accessing path: ${body}]`;
    }
}

/**
 * Gets a property value from an object using a dot-notation path.
 * Safely traverses the object hierarchy and returns undefined if any path segment is invalid.
 *
 * @param obj The object to get the property from
 * @param path The dot-notation path (e.g., "title", "subprompts.0.title")
 * @returns The property value, or undefined if the path doesn't resolve
 */
export function getPropertyByPath(obj: unknown, path: string): unknown {
    if (!obj || typeof obj !== 'object' || !path) {
        return undefined;
    }

    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
        if (current === null || typeof current !== 'object') {
            return undefined;
        }

        // Handle array indices
        const index = parseInt(part, 10);
        if (!isNaN(index) && Array.isArray(current)) {
            current = current[index];
            continue;
        }

        // Handle object properties
        current = (current as Record<string, unknown>)[part];

        if (current === undefined) {
            return undefined;
        }
    }

    return current;
}

/* Synchronous Placeholder Formatter */

/**
 * Formats a string by replacing placeholders with actual values.
 * Handles both regular placeholders and file content placeholders.
 * 
 * @param text The text containing placeholders to format
 * @param incoming The replacement values for placeholders and any other properties for p: notation
 * @param root The root directory for file placeholder resolution
 * @param options Additional options for formatting
 * @returns The formatted text with all placeholders replaced
 */
export function placeholderFormatter(
    text: string,
    incoming: SpecificReplacements & Record<string, unknown> = {},
    root?: string,
    options: { resolveFile?: boolean; recursionLevel?: number; hasResolvedFile?: boolean } = { resolveFile: false, recursionLevel: 0, hasResolvedFile: false },
): string {
    // Limit recursion depth to prevent infinite recursion
    const MAX_RECURSION = 3;
    const currentLevel = options.recursionLevel || 0;

    if (currentLevel > MAX_RECURSION) {
        logger.warn(`Maximum recursion depth (${MAX_RECURSION}) exceeded, stopping parsing`);
        return text;
    }

    const map = buildEffectiveMap(incoming);

    // Reset regex state
    PH_REG.lastIndex = 0;

    let hasResolvedFile = options.hasResolvedFile || false;

    let result = text.replace(PH_REG, (_, directive: string | undefined, body: string) => {
        /* File placeholders */
        if (directive === 'file') {
            // If file resolution is disabled, return placeholder as-is
            if (!options.resolveFile) {
                return `{{file:${body}}}`;
            }

            const result = resolveFilePlaceholderSync(body, root);
            hasResolvedFile = true;
            return result;
        }

        /* Regular placeholders */
        return processPlaceholder(directive, body, incoming, map);
    });

    // Process nested placeholders if no file has been resolved yet
    if (PH_REG.test(result) && currentLevel < MAX_RECURSION && !hasResolvedFile) {
        // Reset regex state
        PH_REG.lastIndex = 0;
        // Process recursively once
        result = placeholderFormatter(
            result,
            incoming,
            root,
            { ...options, recursionLevel: currentLevel + 1, hasResolvedFile }
        );
    }

    return result;
}

/* Placeholder Resolution */

/**
 * Scans a template and returns the set of *standard* placeholder keys that would be used
 * during formatting with the given replacement values. Ignores property placeholders.
 * 
 * @param text The text to scan for placeholders
 * @param standardReplacements The available replacement values (standard placeholders only for icon resolution)
 * @returns A Set of standard placeholder keys (e.g., 'input', 'clipboard') that would be used
 */
export function resolvePlaceholders(
    text: string,
    standardReplacements: Partial<SpecificReplacements> = {} // Use only standard replacements for icon logic
): Set<PlaceholderKey> {
    const usedStandardKeys = new Set<PlaceholderKey>();
    // Use only standard replacements to build the map for icon determination
    const map = buildEffectiveMap(standardReplacements);

    let m: RegExpExecArray | null;
    // Reset regex state
    PH_REG.lastIndex = 0;
    while ((m = PH_REG.exec(text))) {
        const [, directive, rawBody] = m as unknown as [string, string | undefined, string];
        if (directive === 'file') continue;    // Skip file placeholders

        const body = rawBody.trim();

        // Check ONLY for standard placeholders and their fallbacks
        let chosenStandardKey: PlaceholderKey | undefined;
        for (const part of body.split('|')) {
            const key = toPlaceholderKey(part.trim());
            if (!key) continue;

            // Check if it's a known standard placeholder AND has a non-empty value in the map
            if (key in PLACEHOLDERS && map.has(key)) {
                chosenStandardKey = key;
                break; // Found the first valid standard placeholder in the chain
            }
            // Special case: If clipboard is in the chain, always consider it potentially used,
            // even if empty, because its value is fetched later dynamically in some actions
            if (key === 'clipboard' && !chosenStandardKey) {
                chosenStandardKey = 'clipboard';
                break;
            }
        }

        if (chosenStandardKey) {
            usedStandardKeys.add(chosenStandardKey);
        }
        // IMPORTANT: Do NOT check for property paths here, as this function is for standard placeholder icons
    }
    return usedStandardKeys;
}

/* Asynchronous Implementation */

/**
 * Resolves a file placeholder asynchronously, reading file or directory contents.
 * 
 * @param body The file path to resolve
 * @param root The root directory for relative paths
 * @returns Promise resolving to formatted content or error message
 */
async function resolveFilePlaceholderAsync(body: string, root?: string) {
    const absOrErr = safeResolveAbsolute(body, root);
    if (absOrErr instanceof Error) return `[Error: ${absOrErr.message}]`;

    try {
        const stats = await fs.promises.stat(absOrErr);
        if (stats.isFile()) {
            const content = await fs.promises.readFile(absOrErr, 'utf-8');
            return `File: ${body.trim()}\n${content}\n\n`;
        }
        if (stats.isDirectory()) {
            const header = `Directory: ${body.trim()}${path.sep}\n`;
            const content = readDirectoryContentsSync(absOrErr, '');
            return `${header}${content}`;
        }
        return `[Unsupported path type: ${body}]`;
    } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return `[Path not found: ${body}]`;
        if (code === 'EACCES') return `[Permission denied: ${body}]`;
        return `[Error accessing path: ${body}]`;
    }
}

/**
 * Asynchronously formats a string by replacing placeholders with actual values.
 * Recommended for GUI/WebWorker scenarios to avoid blocking the main thread.
 * 
 * @param text The text containing placeholders to format
 * @param incoming The replacement values for placeholders and any other properties for p: notation
 * @param root The root directory for file placeholder resolution
 * @param options Additional options for formatting
 * @returns Promise resolving to the formatted text
 */
export async function placeholderFormatterAsync(
    text: string,
    incoming: SpecificReplacements & Record<string, unknown> = {},
    root?: string,
    options: { resolveFile?: boolean; recursionLevel?: number; hasResolvedFile?: boolean } = { resolveFile: true, recursionLevel: 0, hasResolvedFile: false },
): Promise<string> {
    // Limit recursion depth to prevent infinite recursion
    const MAX_RECURSION = 3;
    const currentLevel = options.recursionLevel || 0;

    if (currentLevel > MAX_RECURSION) {
        logger.warn(`Maximum recursion depth (${MAX_RECURSION}) exceeded, stopping parsing`);
        return text;
    }

    const map = buildEffectiveMap(incoming);

    // Reset regex state
    PH_REG.lastIndex = 0;

    const chunks: string[] = [];
    let lastIdx = 0;
    let hasResolvedFile = options.hasResolvedFile || false;

    for (let match; (match = PH_REG.exec(text));) {
        const [whole, directive, body] = match as unknown as [string, string | undefined, string];
        chunks.push(text.slice(lastIdx, match.index));
        lastIdx = match.index + whole.length;

        if (directive === 'file') {
            // If file resolution is disabled, return placeholder as-is
            if (!options.resolveFile) {
                chunks.push(`{{file:${body}}}`);
            } else {
                const result = await resolveFilePlaceholderAsync(body, root);
                chunks.push(result);
                hasResolvedFile = true;
            }
            continue;
        }

        // Process regular placeholder
        const processedValue = processPlaceholder(directive, body, incoming, map);
        chunks.push(processedValue);
    }

    chunks.push(text.slice(lastIdx));
    let result = chunks.join('');

    // Process nested placeholders if no file has been resolved yet
    if (PH_REG.test(result) && currentLevel < MAX_RECURSION && !hasResolvedFile) {
        // Reset regex state
        PH_REG.lastIndex = 0;
        // Process recursively once
        result = await placeholderFormatterAsync(
            result,
            incoming,
            root,
            { ...options, recursionLevel: currentLevel + 1, hasResolvedFile }
        );
    }

    return result;
}

/**
 * Helper function to process a single placeholder
 * Used by both sync and async versions to maintain consistent logic
 * 
 * @param directive The directive (file, option, or undefined)
 * @param body The placeholder body text (without {{}})
 * @param incoming The replacement values and properties object
 * @param map The processed map of standard placeholders
 * @returns The processed value for the placeholder
 */
function processPlaceholder(
    directive: string | undefined,
    body: string,
    incoming: SpecificReplacements & Record<string, unknown>,
    map: Map<PlaceholderKey, string>
): string {
    const content = body.trim(); // Trim the placeholder body

    // --- Priority 1: Check incoming replacements first ---
    const providedValue = getPropertyByPath(incoming, content);
    if (providedValue !== undefined) {
        // Check if it's a standard placeholder that has a value in the map
        const standardKey = toPlaceholderKey(content);
        if (standardKey && map.has(standardKey)) {
            return map.get(standardKey)!;
        }

        // Otherwise use the provided value if it's a string
        if (typeof providedValue === 'string') {
            // Don't replace with empty strings
            return providedValue.trim() !== '' ? providedValue : `{{${body}}}`;
        }
        // Convert non-string values to string representation
        return String(providedValue);
    }

    // --- Priority 2: Handle 'option:' directive ---
    if (directive === 'option') {
        // Return the original placeholder - this will be detected by PromptListItem
        return `{{option:${content}}}`;
    }

    // --- Priority 3: Handle 'file:' directive ---
    if (directive === 'file') {
        return `[Path not found: ${content}]`;
    }

    // --- Priority 4: Handle standard placeholder fallback chain ---
    // e.g., {{input|selection}}
    for (const part of content.split('|')) {
        const key = toPlaceholderKey(part.trim());
        if (!key) continue;

        const standardValue = map.get(key);
        if (standardValue !== undefined && standardValue !== '') {
            return standardValue;
        }
    }

    // --- Fallback: No replacement found ---
    return `{{${body}}}`;
}