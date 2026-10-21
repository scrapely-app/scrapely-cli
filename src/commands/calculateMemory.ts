#!/usr/bin/env node
// Portions derived from apify-cli (Copyright Apify Technologies s.r.o., Apache-2.0).
// Modified by TeraShift GmbH. See the LICENSE and NOTICE files.

import chalk from 'chalk';
import { Command } from 'commander';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
    addDependencies,
    andDependencies,
    compareTextDependencies,
    compileDependencies,
    create,
    divideDependencies,
    equalDependencies,
    evaluateDependencies,
    maxDependencies,
    minDependencies,
    multiplyDependencies,
    notDependencies,
    nullishDependencies,
    orDependencies,
    subtractDependencies,
    unequalDependencies,
    xorDependencies,
} from 'mathjs';
import { findActorConfig } from '../config.js';

/**
 * `scrapely calculate-memory` / `scrapely actor calculate-memory`.
 *
 * Evaluates the Actor's dynamic memory expression (`defaultMemoryMbytes` in
 * .actor/actor.json) against an input and prints the result. Expression
 * language, rounding and clamping follow the reference CLI: a restricted
 * math.js (get(), min, max, comparisons, ?:, ??, compareText), `{{input.x}}` /
 * `{{runOptions.x}}` placeholders, result rounded to the closest power of 2 and
 * clamped to 128..32768 MB, then to minMemoryMbytes / maxMemoryMbytes.
 */

export const MIN_RUN_MEMORY_MBYTES = 128;
export const MAX_RUN_MEMORY_MBYTES = 32768;
export const MEMORY_EXPRESSION_MAX_LENGTH = 1000;

const ALLOWED_RUN_OPTION_KEYS = new Set([
    'build',
    'timeoutSecs',
    'memoryMbytes',
    'diskMbytes',
    'maxItems',
    'maxTotalChargeUsd',
    'restartOnError',
]);

export type RunOptionsContext = {
    build?: string;
    timeoutSecs?: number;
    memoryMbytes?: number;
    diskMbytes?: number;
    maxItems?: number;
    maxTotalChargeUsd?: number;
    restartOnError?: boolean;
};

const math = create({
    compileDependencies,
    evaluateDependencies,
    addDependencies,
    subtractDependencies,
    multiplyDependencies,
    divideDependencies,
    maxDependencies,
    minDependencies,
    andDependencies,
    notDependencies,
    orDependencies,
    xorDependencies,
    nullishDependencies,
    equalDependencies,
    unequalDependencies,
    compareTextDependencies,
});

// Keep a handle on compile() before it is disabled for use inside expressions.
const { compile } = math;

// Disable the functions that could run user-supplied code (math.js security guidance).
math.import(
    {
        evaluate() {
            throw new Error('Function evaluate is disabled.');
        },
        compile() {
            throw new Error('Function compile is disabled.');
        },
        parse() {
            throw new Error('Function parse is disabled.');
        },
    },
    { override: true },
);

const FORBIDDEN_PATH_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Resolve a dotted path using own, non-function data properties only. Inherited
 * properties (e.g. `constructor.constructor`, which reaches `Function`) are never
 * followed, so expressions cannot obtain executable references through this helper.
 */
function getByPath(obj: unknown, path: unknown, defaultVal: unknown): unknown {
    if (typeof path !== 'string') return defaultVal;
    let current: unknown = obj;
    for (const key of path.split('.')) {
        if (current === null || current === undefined) return defaultVal;
        if (FORBIDDEN_PATH_KEYS.has(key)) return defaultVal;
        if (typeof current !== 'object' && typeof current !== 'string') return defaultVal;
        if (!Object.prototype.hasOwnProperty.call(Object(current), key)) return defaultVal;
        current = (current as any)[key];
        if (typeof current === 'function') return defaultVal;
    }
    return current ?? defaultVal;
}

function processTemplateVariables(expression: string): string {
    return expression.replace(/{{\s*([a-zA-Z0-9_.]+)\s*}}/g, (_match, name: string) => {
        if (name.startsWith('input.')) return name;
        if (name.startsWith('runOptions.')) {
            const key = name.slice('runOptions.'.length);
            if (!ALLOWED_RUN_OPTION_KEYS.has(key)) {
                throw new Error(
                    `Invalid variable '{{${name}}}' in expression. Only the following runOptions are allowed: ${[...ALLOWED_RUN_OPTION_KEYS]
                        .map((k) => `runOptions.${k}`)
                        .join(', ')}.`,
                );
            }
            return name;
        }
        throw new Error(`Invalid variable '{{${name}}}' in expression.`);
    });
}

function roundToClosestPowerOf2(num: unknown): number {
    if (typeof num !== 'number' || Number.isNaN(num) || !Number.isFinite(num)) {
        throw new Error(`Calculated memory value is not a valid number: ${String(num)}.`);
    }
    if (num <= 0) {
        throw new Error(`Calculated memory value must be a positive number, greater than 0, got: ${num}.`);
    }
    const result = 2 ** Math.round(Math.log2(num));
    return Math.max(MIN_RUN_MEMORY_MBYTES, Math.min(result, MAX_RUN_MEMORY_MBYTES));
}

/** Evaluate a dynamic memory expression; returns MB (power of 2, 128..32768). */
export function calculateDynamicMemory(
    expression: string,
    context: { input: Record<string, unknown>; runOptions: RunOptionsContext },
): number {
    if (expression.length > MEMORY_EXPRESSION_MAX_LENGTH) {
        throw new Error(
            `The defaultMemoryMbytes expression is too long. Max length is ${MEMORY_EXPRESSION_MAX_LENGTH} characters.`,
        );
    }
    const compiled = compile(processTemplateVariables(expression));
    let result: any = compiled.evaluate({ ...context, get: getByPath });
    // Multi-line expressions come back wrapped; the last entry is the value.
    if (result && typeof result === 'object' && 'entries' in result) {
        const { entries } = result as { entries: unknown[] };
        result = entries[entries.length - 1];
    }
    return roundToClosestPowerOf2(result);
}

/** Clamp to the Actor's min/max (reference defaults: 0 and Infinity). */
export function clampMemory(value: number, min = 0, max = Infinity): number {
    return Math.min(Math.max(value, min), max);
}

export interface CalculateMemoryOptions {
    build?: string;
    defaultMemoryMbytes?: string;
    input?: string;
    maxItems?: string;
    maxTotalChargeUsd?: string;
    timeoutSecs?: string;
}

function parseNumberFlag(name: string, value: string | undefined): number | undefined {
    if (value === undefined) return undefined;
    const n = Number(value);
    if (value.trim() === '' || !Number.isFinite(n)) {
        console.error(chalk.red(`Error: --${name} must be a number, got "${value}".`));
        process.exit(1);
    }
    return n;
}

export async function calculateMemoryCommand(options: CalculateMemoryOptions = {}): Promise<void> {
    const cwd = process.cwd();
    let expression = options.defaultMemoryMbytes;
    let minMemory = 0;
    let maxMemory = Infinity;

    const found = findActorConfig(cwd);
    if (expression === undefined) {
        if (!found) {
            console.error(
                chalk.red('Error: No actor config found in the current directory and no --default-memory-mbytes given.'),
            );
            process.exit(1);
        }
        const cfg = found.config as Record<string, unknown>;
        if (cfg.defaultMemoryMbytes !== undefined && cfg.defaultMemoryMbytes !== null) {
            expression = String(cfg.defaultMemoryMbytes);
        }
    }
    if (found) {
        const cfg = found.config as Record<string, unknown>;
        if (typeof cfg.minMemoryMbytes === 'number') minMemory = cfg.minMemoryMbytes;
        if (typeof cfg.maxMemoryMbytes === 'number') maxMemory = cfg.maxMemoryMbytes;
    }

    if (expression === undefined || expression === '') {
        console.error(
            chalk.red(
                'Error: No memory expression found. Set "defaultMemoryMbytes" in .actor/actor.json or pass --default-memory-mbytes.',
            ),
        );
        process.exit(1);
    }

    // Input: --input file, else the default local key-value store INPUT.json, else {}.
    const inputPath = options.input ?? join(cwd, 'storage', 'key_value_stores', 'default', 'INPUT.json');
    let input: Record<string, unknown> = {};
    if (existsSync(inputPath)) {
        try {
            const parsed = JSON.parse(readFileSync(inputPath, 'utf-8'));
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) input = parsed;
        } catch {
            console.error(chalk.red(`Error: Input file is not valid JSON: ${inputPath}`));
            process.exit(1);
        }
    } else if (options.input !== undefined) {
        console.error(chalk.red(`Error: Input file not found: ${inputPath}`));
        process.exit(1);
    }

    const runOptions: RunOptionsContext = {
        ...(options.build !== undefined ? { build: options.build } : {}),
        ...(options.timeoutSecs !== undefined ? { timeoutSecs: parseNumberFlag('timeout-secs', options.timeoutSecs) } : {}),
        ...(options.maxItems !== undefined ? { maxItems: parseNumberFlag('max-items', options.maxItems) } : {}),
        ...(options.maxTotalChargeUsd !== undefined
            ? { maxTotalChargeUsd: parseNumberFlag('max-total-charge-usd', options.maxTotalChargeUsd) }
            : {}),
    };

    try {
        const calculated = calculateDynamicMemory(expression, { input, runOptions });
        const memory = clampMemory(calculated, minMemory, maxMemory);
        console.log(`Calculated memory: ${memory} MB`);
    } catch (err) {
        console.error(chalk.red(`Error: Failed to calculate memory: ${(err as Error).message}`));
        process.exitCode = 1;
    }
}

/** Register `calculate-memory` on a command (top-level program or the `actor` group). */
export function addCalculateMemoryCommand(parent: Command): void {
    parent
        .command('calculate-memory')
        .description(
            "Calculates the Actor's dynamic memory usage from the memory expression in actor.json, the input and run options",
        )
        .option('--build <value>', 'Actor build version or tag to evaluate the expression with')
        .option('--default-memory-mbytes <value>', 'Memory expression to evaluate (default: from actor.json)')
        .option('--input <value>', 'Path to the input JSON file (default: storage/key_value_stores/default/INPUT.json)')
        .option('--max-items <value>', 'Maximum number of items the Actor may output')
        .option('--max-total-charge-usd <value>', 'Maximum total charge in USD')
        .option('--timeout-secs <value>', 'Run timeout in seconds')
        .action((options) => calculateMemoryCommand(options));
}
