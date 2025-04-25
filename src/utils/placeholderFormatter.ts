/**
 * This file provides utility functions for formatting text with placeholders.
 * It supports both synchronous and asynchronous implementations for replacing:
 * - Simple placeholders (input, clipboard, selection, etc.)
 * - File content placeholders for reading files/directories
 * - Fallback handling with alias support
 * - Property path placeholders (p:property.path) for accessing object properties
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
    input: { literal: '<输入文本>', alias: 'i' },
    selection: { literal: '<选中文本>', alias: 's' },
    clipboard: { literal: '<剪贴板文本>', alias: 'c' },
    currentApp: { literal: '<当前应用>' },
    browserContent: { literal: '<浏览器内容>' },
    now: { literal: '<当前时间>', alias: 'n' },
    promptTitles: { literal: '<提示词标题>', alias: 'pt' },
};

// alias ⇒ key
const ALIAS_TO_KEY = new Map<string, PlaceholderKey>(
    Object.entries(PLACEHOLDERS)
        .filter(([, { alias }]) => alias)
        .map(([key, { alias }]) => [alias as string, key as PlaceholderKey]),
);

/* Utility Functions */

const PH_REG = /{{(file:)?([^}]+)}}/g;     // Single regex for all placeholders
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
function buildEffectiveMap(raw: Partial<SpecificReplacements>) {
    const m = new Map<PlaceholderKey, string>();
    Object.entries(raw).forEach(([k, v]) => {
        if (isNonEmpty(v)) m.set(k as PlaceholderKey, v.trim());
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
function getPropertyByPath(obj: unknown, path: string): unknown {
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
 * @param incoming The replacement values for placeholders
 * @param root The root directory for file placeholder resolution
 * @param options Additional options for formatting
 * @returns The formatted text with all placeholders replaced
 */
export function placeholderFormatter(
    text: string,
    incoming: SpecificReplacements = {},
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

    let result = text.replace(PH_REG, (_, fileFlag: string | undefined, body: string) => {
        /* File placeholders */
        if (fileFlag) {
            // If file resolution is disabled, return placeholder as-is
            if (!options.resolveFile) {
                return `{{file:${body}}}`;
            }

            const result = resolveFilePlaceholderSync(body, root);
            hasResolvedFile = true;
            return result;
        }

        /* Regular placeholders */
        let content = body;
        const isPNotation = content.startsWith('p:');
        if (isPNotation) {
            // Extract property path after 'p:' prefix
            const propertyPath = content.slice(2).trim();
            // Get the property value using the path
            const propValue = getPropertyByPath(incoming, propertyPath);

            // If property exists and is a valid value, return it
            if (propValue !== undefined) {
                if (typeof propValue === 'string') {
                    return propValue;
                }
                // Convert non-string values to string representation
                return String(propValue);
            }

            // If property doesn't exist, continue with normal placeholder processing
            content = content.slice(2);
        }

        for (const part of content.split('|')) {
            const key = toPlaceholderKey(part.trim());
            if (!key) continue;

            const v = map.get(key);
            if (v) {
                const replacement = isPNotation ? PLACEHOLDERS[key].literal : v;

                // Check if replacement text still contains placeholders, if so process recursively
                if (PH_REG.test(replacement)) {
                    // Reset regex state
                    PH_REG.lastIndex = 0;
                    return replacement;
                }

                return replacement;
            }
        }

        return `{{${body}}}`;         // Unresolved: return as-is
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
 * Scans a template and returns the set of placeholder keys that would be used
 * during formatting with the given replacement values.
 * 
 * @param text The text to scan for placeholders
 * @param incoming The available replacement values
 * @returns A Set of placeholder keys that would be used in formatting
 */
export function resolvePlaceholders(
    text: string,
    incoming: Partial<SpecificReplacements> = {},
): Set<PlaceholderKey> {
    const used = new Set<PlaceholderKey>();
    const map = buildEffectiveMap(incoming);

    let m: RegExpExecArray | null;
    while ((m = PH_REG.exec(text))) {
        const [, fileFlag, rawBody] = m as unknown as [string, string | undefined, string];
        if (fileFlag) continue;    // Skip file placeholders

        let body = rawBody;
        if (body.startsWith('p:')) body = body.slice(2);

        let chosen: PlaceholderKey | undefined;

        for (const part of body.split('|')) {
            const key = toPlaceholderKey(part.trim());
            if (!key) continue;

            if (key === 'clipboard' && !chosen) {
                chosen = 'clipboard';          // Rule 1.b
                break;
            }
            if (map.has(key)) {             // Rule 1.a
                chosen = key;
                break;
            }
        }
        if (chosen) used.add(chosen);
    }
    return used;
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
 * @param incoming The replacement values for placeholders
 * @param root The root directory for file placeholder resolution
 * @param options Additional options for formatting
 * @returns Promise resolving to the formatted text
 */
export async function placeholderFormatterAsync(
    text: string,
    incoming: SpecificReplacements = {},
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
        const [whole, fileFlag, body] = match as unknown as [string, string | undefined, string];
        chunks.push(text.slice(lastIdx, match.index));
        lastIdx = match.index + whole.length;

        if (fileFlag) {
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

        let content = body;
        const isPNotation = content.startsWith('p:');
        if (isPNotation) {
            // Extract property path after 'p:' prefix
            const propertyPath = content.slice(2).trim();
            // Get the property value using the path
            const propValue = getPropertyByPath(incoming, propertyPath);

            // If property exists and is a valid value, return it
            if (propValue !== undefined) {
                if (typeof propValue === 'string') {
                    chunks.push(propValue);
                } else {
                    // Convert non-string values to string representation
                    chunks.push(String(propValue));
                }
                continue; // Skip further processing for this placeholder
            }

            // If property doesn't exist, continue with normal placeholder processing
            content = content.slice(2);
        }

        let replaced = false;
        for (const part of content.split('|')) {
            const key = toPlaceholderKey(part.trim());
            if (!key) continue;

            const v = map.get(key);
            if (v) {
                chunks.push(isPNotation ? PLACEHOLDERS[key].literal : v);
                replaced = true;
                break;
            }
        }

        if (!replaced) {
            chunks.push(`{{${body}}}`); // Unresolved: return as-is
        }
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