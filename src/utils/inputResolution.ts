#!/usr/bin/env node

import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

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
        if (existsSync(localInputPath)) {
            if (!quiet) {
                console.log(chalk.gray('Using input from storage/key_value_stores/default/INPUT.json.'));
            }
            raw = readFileSync(localInputPath, 'utf-8');
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
