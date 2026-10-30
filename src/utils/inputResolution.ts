#!/usr/bin/env node

import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { readFileNoFollowWithin } from './pathValidation.js';

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
        // The implicit path is project-controlled, so it must be a regular file inside the
        // project with no symlink anywhere in the path (checked against the opened fd, so a
        // directory swapped to a symlink between check and read is detected too).
        let content: Buffer | undefined;
        try {
            content = readFileNoFollowWithin(process.cwd(), join('storage', 'key_value_stores', 'default', 'INPUT.json'));
        } catch (err: any) {
            if (err.code !== 'ENOENT' && err.code !== 'ENOTDIR') {
                console.error(
                    chalk.red(
                        'Error: storage/key_value_stores/default/INPUT.json must be a regular file inside the project ' +
                            '(symbolic links are not followed). Use --input-file to supply an input from another location.',
                    ),
                );
                process.exit(1);
                return undefined; // process.exit never returns in production, but in tests it may
            }
        }
        if (content !== undefined) {
            if (!quiet) {
                console.log(chalk.gray('Using input from storage/key_value_stores/default/INPUT.json.'));
            }
            raw = content.toString('utf-8');
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
