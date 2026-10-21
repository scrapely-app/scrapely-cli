#!/usr/bin/env node

import chalk from 'chalk';
import {
    closeSync,
    constants,
    existsSync,
    fstatSync,
    lstatSync,
    openSync,
    readFileSync,
    realpathSync,
} from 'fs';
import { isAbsolute, join, relative } from 'path';

export interface RemoteInputOptions {
    input?: string;
    inputFile?: string;
}

/**
 * Read stdin fully as a string (used by `--input-file -`).
 */
function readStdin(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        let data = '';
        process.stdin.setEncoding('utf-8');
        process.stdin.on('readable', () => {
            let chunk;
            while ((chunk = process.stdin.read()) !== null) {
                data += chunk;
            }
        });
        process.stdin.on('end', () => resolve(data));
        process.stdin.on('error', reject);
    });
}

/**
 * Resolve run input for remote run commands (`call`, `actors call`, `actors start`, `task run`).
 *
 * input passed via --input / --input-file takes precedence;
 * otherwise the default local key-value store INPUT.json
 * (storage/key_value_stores/default/INPUT.json) is used when present.
 */
export async function resolveRemoteInput(options: RemoteInputOptions, quiet = false): Promise<unknown> {
    // Use !== undefined (not truthiness) so an explicitly empty --input "" is
    // treated as "input supplied" and never falls back to the local INPUT.json
    // record, which could upload local (possibly sensitive) data to the remote API.
    if (options.input !== undefined && options.inputFile !== undefined) {
        console.error(chalk.red('Error: Pass either --input or --input-file, not both.'));
        process.exit(1);
    }

    let raw: string | undefined;
    if (options.input !== undefined) {
        raw = options.input;
    } else if (options.inputFile) {
        if (options.inputFile === '-') {
            raw = await readStdin();
        } else {
            if (!existsSync(options.inputFile)) {
                console.error(chalk.red(`Error: Input file not found: ${options.inputFile}`));
                process.exit(1);
            }
            raw = readFileSync(options.inputFile, 'utf-8');
        }
    } else {
        // fall back to the default local key-value store INPUT.json.
        const localInputPath = join(process.cwd(), 'storage', 'key_value_stores', 'default', 'INPUT.json');
        // The implicit path is project-controlled, so it must be a regular file located
        // inside the project directory (no symlinks) to avoid reading arbitrary local files.
        let stat: ReturnType<typeof lstatSync> | undefined;
        try {
            stat = lstatSync(localInputPath);
        } catch {
            stat = undefined;
        }
        if (stat) {
            const refuse = (): never => {
                console.error(
                    chalk.red(
                        'Error: storage/key_value_stores/default/INPUT.json must be a regular file inside the project ' +
                            '(symbolic links are not followed). Use --input-file to supply an input from another location.',
                    ),
                );
                process.exit(1);
            };
            if (stat.isSymbolicLink() || !stat.isFile()) {
                refuse();
                return undefined; // refuse() calls process.exit(1), but in tests it may return
            }

            // Reject symlinked parent directories that resolve outside the project.
            try {
                const projectRoot = realpathSync(process.cwd());
                const resolved = realpathSync(localInputPath);
                const rel = relative(projectRoot, resolved);
                // Reject if the path escapes the project directory:
                // - starts with '..' (parent directory traversal)
                // - is absolute (completely outside)
                // - is empty string (would be the project root itself, not a file inside it)
                if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
                    refuse();
                    return undefined; // refuse() calls process.exit(1), but in tests it may return
                }
            } catch (err: any) {
                // realpathSync can fail if there are permission issues or broken symlinks
                refuse();
                return undefined; // refuse() calls process.exit(1), but in tests it may return
            }

            if (!quiet) {
                console.log(chalk.gray('Using input from storage/key_value_stores/default/INPUT.json.'));
            }
            // O_NOFOLLOW closes the race between the check above and the read.
            try {
                const fd = openSync(localInputPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
                try {
                    if (!fstatSync(fd).isFile()) {
                        refuse();
                        return undefined; // refuse() calls process.exit(1), but in tests it may return
                    }
                    raw = readFileSync(fd, 'utf-8');
                } finally {
                    closeSync(fd);
                }
            } catch (err: any) {
                // ELOOP means a symlink was encountered (O_NOFOLLOW behavior)
                // EISDIR means the path is a directory, not a file
                if (err.code === 'ELOOP' || err.code === 'EISDIR') {
                    refuse();
                    // refuse() calls process.exit(1), which never returns in production.
                    // In tests where process.exit is mocked, we return here to prevent
                    // the error from propagating.
                    return undefined;
                }
                throw err;
            }
        }
    }

    if (raw === undefined) return undefined;

    try {
        return JSON.parse(raw);
    } catch {
        console.error(chalk.red('Error: Invalid JSON input.'));
        process.exit(1);
    }
}
