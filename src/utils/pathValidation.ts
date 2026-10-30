/**
 * CLI Path Validation Utilities
 * 
 * Security functions to prevent path traversal attacks in CLI commands.
 * All user-provided paths are validated to stay within expected directories.
 */

import path from 'path';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync } from 'fs';

/**
 * Canonicalize a path that may not exist yet: realpath of the deepest existing
 * ancestor, with the not-yet-existing tail appended.
 */
function canonicalize(p: string): string {
    let existing = path.resolve(p);
    const tail: string[] = [];
    for (;;) {
        try {
            return path.join(realpathSync(existing), ...tail);
        } catch {
            // A dangling symlink exists but cannot be resolved — never treat it as missing
            let dangling = false;
            try {
                dangling = lstatSync(existing).isSymbolicLink();
            } catch {
                // Really missing
            }
            if (dangling) throw new Error(`Refusing to follow dangling symbolic link: ${existing}`);
            const parent = path.dirname(existing);
            if (parent === existing) return path.resolve(p);
            tail.unshift(path.basename(existing));
            existing = parent;
        }
    }
}

function isWithin(child: string, parent: string): boolean {
    return child === parent || child.startsWith(parent + path.sep);
}

/**
 * Throw if `target` (after following symlinks in its existing part) is outside
 * `baseDir` (also canonicalized). Catches project-local symlinks that point out.
 */
export function assertRealPathWithin(target: string, baseDir: string): void {
    if (!isWithin(canonicalize(target), canonicalize(baseDir))) {
        throw new Error(`Path "${target}" resolves outside of "${baseDir}" (symbolic link)`);
    }
}

/** lstat every component of relPath under baseDir; throw on any symlink. */
function assertNoSymlinkComponents(baseDir: string, relPath: string, allowMissingLeaf: boolean): void {
    const parts = path.normalize(relPath).split(path.sep).filter((p) => p && p !== '.');
    let current = path.resolve(baseDir);
    for (let i = 0; i < parts.length; i++) {
        current = path.join(current, parts[i]);
        let st;
        try {
            st = lstatSync(current);
        } catch (err: any) {
            if (allowMissingLeaf && i === parts.length - 1 && err.code === 'ENOENT') return;
            throw err;
        }
        if (st.isSymbolicLink()) {
            const e: NodeJS.ErrnoException = new Error(`Refusing to follow symbolic link: ${current}`);
            e.code = 'ELOOP';
            throw e;
        }
    }
}

/**
 * Open `relPath` under `baseDir` without following symlinks anywhere in the path.
 * Every component is checked before and after the open, the leaf is opened with
 * O_NOFOLLOW, and the opened fd must be the same regular file (dev/ino) that is
 * at the in-project path afterwards — so a directory swapped to a symlink and
 * back during the open is detected. Returns the fd; the caller closes it.
 */
export function openNoFollowWithin(baseDir: string, relPath: string, flags: number): number {
    const fullPath = validatePathWithinDir(relPath, baseDir);
    const relative = path.relative(path.resolve(baseDir), fullPath);
    const creating = (flags & constants.O_CREAT) !== 0;
    assertNoSymlinkComponents(baseDir, relative, creating);
    const fd = openSync(fullPath, flags | (constants.O_NOFOLLOW ?? 0), 0o666);
    try {
        const opened = fstatSync(fd);
        if (!opened.isFile()) {
            const e: NodeJS.ErrnoException = new Error(`Not a regular file: ${fullPath}`);
            e.code = 'EISDIR';
            throw e;
        }
        assertNoSymlinkComponents(baseDir, relative, false);
        const atPath = lstatSync(fullPath);
        if (atPath.dev !== opened.dev || atPath.ino !== opened.ino) {
            const e: NodeJS.ErrnoException = new Error(`File changed while opening: ${fullPath}`);
            e.code = 'ELOOP';
            throw e;
        }
        return fd;
    } catch (err) {
        closeSync(fd);
        throw err;
    }
}

/** Read a file under baseDir without following symlinks (see openNoFollowWithin). */
export function readFileNoFollowWithin(baseDir: string, relPath: string): Buffer {
    const fd = openNoFollowWithin(baseDir, relPath, constants.O_RDONLY);
    try {
        return readFileSync(fd);
    } finally {
        closeSync(fd);
    }
}

/** Create/overwrite a file under baseDir without following symlinks (see openNoFollowWithin). */
export function writeFileNoFollowWithin(baseDir: string, relPath: string, data: string): void {
    const fd = openNoFollowWithin(baseDir, relPath, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC);
    try {
        writeFileSync(fd, data);
    } finally {
        closeSync(fd);
    }
}

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
    // Lexical check passed; also reject project-local symlinks that point out
    assertRealPathWithin(resolvedPath, resolvedBase);
    
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
        assertRealPathWithin(normalizedUserPath, resolvedBase);
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
        // safeResolve also checks the real (symlink-resolved) path, comparing
        // against the real base and the nearest existing ancestor when missing
        safeResolve(baseDir, userPath);
        return true;
    } catch {
        return false;
    }
}