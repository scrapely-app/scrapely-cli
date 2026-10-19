/**
 * CLI Path Validation Utilities
 * 
 * Security functions to prevent path traversal attacks in CLI commands.
 * All user-provided paths are validated to stay within expected directories.
 */

import path from 'path';
import { realpathSync } from 'fs';

/**
 * Validate that a path stays within the allowed base directory.
 * Prevents path traversal attacks (e.g., "../../../etc/passwd").
 * 
 * @param userPath - The user-provided path to validate
 * @param baseDir - The base directory the path should stay within
 * @returns The resolved, validated absolute path
 * @throws Error if path traversal is detected
 */
export function validatePathWithinDir(userPath: string, baseDir: string): string {
    // Resolve both paths to absolute form
    const resolvedBase = path.resolve(baseDir);
    const resolvedPath = path.resolve(baseDir, userPath);
    
    // Check if the resolved path is within the base directory
    // Use startsWith with path separator to prevent partial matches
    if (!resolvedPath.startsWith(resolvedBase + path.sep) && resolvedPath !== resolvedBase) {
        throw new Error(`Path traversal detected: "${userPath}" resolves outside of "${baseDir}"`);
    }
    
    return resolvedPath;
}

/**
 * Validate a filename to prevent path traversal.
 * Removes path separators and traversal sequences.
 * 
 * @param filename - The filename to validate
 * @returns The sanitized filename
 * @throws Error if the filename is invalid
 */
export function validateFilename(filename: string): string {
    if (!filename || typeof filename !== 'string') {
        throw new Error('Filename must be a non-empty string');
    }
    
    // Check for null bytes
    if (filename.includes('\0')) {
        throw new Error('Filename contains null byte');
    }
    
    // Check for path separators
    if (filename.includes('/') || filename.includes('\\')) {
        throw new Error('Filename must not contain path separators');
    }
    
    // Check for traversal sequences
    if (filename.includes('..')) {
        throw new Error('Filename must not contain traversal sequences');
    }
    
    return filename;
}

/**
 * Safely resolve a user-provided path relative to a base directory.
 * Returns the resolved path if it's within the base directory, otherwise throws.
 * 
 * @param baseDir - The trusted base directory
 * @param userPath - The user-provided relative path
 * @returns The resolved absolute path
 */
export function safeResolve(baseDir: string, userPath: string): string {
    // Normalize the user path to handle any ./ or ../ sequences
    const normalizedUserPath = path.normalize(userPath);
    
    // Check if it's an absolute path (could be an attempt to escape)
    if (path.isAbsolute(normalizedUserPath)) {
        // For absolute paths, verify it's within the base directory
        const resolvedBase = path.resolve(baseDir);
        if (!normalizedUserPath.startsWith(resolvedBase + path.sep)) {
            throw new Error(`Absolute path "${userPath}" is outside of "${baseDir}"`);
        }
        return normalizedUserPath;
    }
    
    // Resolve relative to base and validate
    return validatePathWithinDir(normalizedUserPath, baseDir);
}

/**
 * Check if a path exists and is within the allowed directory.
 * Combines validation with existence check.
 */
export function isValidPathWithinDir(userPath: string, baseDir: string): boolean {
    try {
        const resolved = safeResolve(baseDir, userPath);
        // Try to get the real path (will throw if doesn't exist)
        try {
            const realPath = realpathSync(resolved);
            const resolvedBase = path.resolve(baseDir);
            return realPath.startsWith(resolvedBase + path.sep) || realPath === resolvedBase;
        } catch {
            // Path doesn't exist, but the resolved path is still valid
            return true;
        }
    } catch {
        return false;
    }
}