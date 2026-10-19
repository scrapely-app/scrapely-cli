#!/usr/bin/env node

import { addCalculateMemoryCommand } from './calculateMemory.js';
import chalk from 'chalk';
import { Command } from 'commander';
import { join, dirname } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { getApiBaseUrl, getToken } from '../config.js';
import { getRuntimeClient } from '../client.js';
import { safeResolve, validatePathWithinDir } from '../utils/pathValidation.js';

/**
 * Resolve API base URL: actor-runtime env first, then CLI config.
 */
function resolveApiBaseUrl(): string {
    return (
        process.env.APIFY_API_BASE_URL ||
        process.env.SCRAPELY_API_BASE_URL ||
        process.env.SCRAPELY_API_URL ||
        getApiBaseUrl()
    );
}

/**
 * Check if a runtime API base URL is being used (from env vars).
 * This is used to prevent credential exfiltration to attacker-controlled hosts.
 */
function isUsingRuntimeApiBaseUrl(): boolean {
    return Boolean(
        process.env.APIFY_API_BASE_URL ||
        process.env.SCRAPELY_API_BASE_URL ||
        process.env.SCRAPELY_API_URL
    );
}

/**
 * Resolve auth token: actor-runtime env first, then CLI credentials.
 * 
 * Security: Only use saved CLI credentials when using the CLI's configured
 * API URL. If a runtime API base URL is set via env vars, we require an
 * explicit runtime token to prevent credential exfiltration.
 */
function resolveToken(): string | null {
    // Runtime tokens always take precedence
    const runtimeToken = 
        process.env.ACTOR_TOKEN ||
        process.env.APIFY_TOKEN ||
        process.env.SCRAPELY_TOKEN;
    
    if (runtimeToken) {
        return runtimeToken;
    }
    
    // Only use saved CLI credentials when using the CLI's configured API URL.
    // This prevents sending long-lived bearer tokens to attacker-controlled hosts.
    if (!isUsingRuntimeApiBaseUrl()) {
        return getToken();
    }
    
    // Runtime URL is set but no runtime token - require explicit token
    return null;
}

/**
 * Build auth headers, merging any extra headers with the Authorization bearer.
 */
function authHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    const token = resolveToken();
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

/**
 * Decode ACTOR_INPUT which may be base64-encoded JSON or plain JSON.
 */
function decodeActorInput(raw: string): unknown {
    // Try plain JSON first
    try {
        return JSON.parse(raw);
    } catch {
        // fall through
    }

    // Try base64-encoded JSON
    try {
        const decoded = Buffer.from(raw, 'base64').toString('utf-8');
        return JSON.parse(decoded);
    } catch (err) {
        throw new Error(`Failed to decode ACTOR_INPUT: ${(err as Error).message}`);
    }
}

/**
 * Where `actor get-input` should read the input from: the default key-value
 * store via the API when running on the platform (platform equivalent), or the ACTOR_INPUT env var injected by `scrapely run` locally.
 */
export type ActorInputSource =
    | { mode: 'key-value-store'; storeId: string }
    | { mode: 'env' }
    | null;

export function resolveActorInputSource(env: NodeJS.ProcessEnv = process.env): ActorInputSource {
    const defaultKvsId =
        env.ACTOR_DEFAULT_KEY_VALUE_STORE_ID ||
        env.APIFY_DEFAULT_KEY_VALUE_STORE_ID;
    if (defaultKvsId) {
        return { mode: 'key-value-store', storeId: defaultKvsId };
    }
    if (env.ACTOR_INPUT) {
        return { mode: 'env' };
    }
    return null;
}

/**
 * actor get-input - Get the Actor input from the default key-value store
 * (API), falling back to the ACTOR_INPUT env var for local
 * runs started via `scrapely run` (plain or base64-encoded JSON).
 */
export async function getInputCommand(): Promise<void> {
    const inputSource = resolveActorInputSource();

    if (inputSource?.mode === 'key-value-store') {
        try {
            const record = await getRuntimeClient().keyValueStore(inputSource.storeId).getRecord('INPUT');
            if (record) {
                console.log(typeof record.value === 'string' ? record.value : JSON.stringify(record.value, null, 2));
                return;
            }
            console.error(chalk.gray(`No INPUT record found in key-value store "${inputSource.storeId}", falling back to the ACTOR_INPUT environment variable.`));
        } catch (err) {
            console.error(chalk.yellow(`Warning: Could not fetch the INPUT record from key-value store "${inputSource.storeId}".`));
            console.error(chalk.gray(`Details: ${(err as Error).message}`));
        }
    }

    const actorInput = process.env.ACTOR_INPUT;

    if (!actorInput) {
        console.error(chalk.red('Error: No actor input available.'));
        console.error(chalk.gray('Running on the platform, ACTOR_DEFAULT_KEY_VALUE_STORE_ID selects the default key-value store;'));
        console.error(chalk.gray('locally, `scrapely run` injects the ACTOR_INPUT environment variable (plain or base64-encoded JSON).'));
        process.exit(1);
    }

    try {
        const parsed = decodeActorInput(actorInput);
        console.log(JSON.stringify(parsed, null, 2));
    } catch (err) {
        console.error(chalk.red('Error: Failed to decode ACTOR_INPUT.'));
        console.error(chalk.gray(`Details: ${(err as Error).message}`));
        process.exit(1);
    }
}

/**
 * actor push-data - Push data to the actor's default dataset
 */
export async function pushDataCommand(item?: string): Promise<void> {
    const readStdin = (): Promise<string> =>
        new Promise((resolve) => {
            let input = '';
            process.stdin.setEncoding('utf-8');
            process.stdin.on('data', (chunk: string) => {
                input += chunk;
            });
            process.stdin.on('end', () => resolve(input));
            // If stdin is a TTY and no data is coming, resolve empty quickly
            if (process.stdin.isTTY) {
                resolve('');
            }
        });

    const inputData = item ?? (await readStdin());

    if (!inputData.trim()) {
        console.error(chalk.red('Error: No data provided.'));
        console.error(chalk.gray('Usage: scrapely actor push-data \'{"key":"value"}\''));
        process.exit(1);
    }

    try {
        JSON.parse(inputData);
    } catch (err) {
        console.error(chalk.red('Error: Invalid JSON input.'));
        console.error(chalk.gray(`Details: ${(err as Error).message}`));
        process.exit(1);
    }

    const defaultDatasetId =
        process.env.ACTOR_DEFAULT_DATASET_ID || process.env.APIFY_DEFAULT_DATASET_ID;
    const runId = process.env.ACTOR_RUN_ID || process.env.APIFY_ACTOR_RUN_ID;

    if (!defaultDatasetId && !runId) {
        console.error(chalk.red('Error: No dataset ID or run ID available.'));
        console.error(
            chalk.gray('Set ACTOR_DEFAULT_DATASET_ID or ACTOR_RUN_ID environment variable.')
        );
        process.exit(1);
    }

    try {
        const datasetId = defaultDatasetId || runId;
        if (!datasetId) {
            console.error(chalk.red('Error: No dataset ID or run ID available.'));
            process.exit(1);
        }
        await getRuntimeClient().dataset(datasetId).pushItems(inputData);
        console.log(chalk.green('✓ Data pushed successfully'));
    } catch (err) {
        console.error(chalk.red('Error: Failed to push data to dataset.'));
        console.error(chalk.gray(`Details: ${(err as Error).message}`));
        process.exit(1);
    }
}

/**
 * actor get-value - Get a value from the default key-value store
 */
export async function getValueCommand(key: string): Promise<void> {
    if (!key) {
        console.error(chalk.red('Error: Key is required.'));
        process.exit(1);
    }

    const defaultKvsId =
        process.env.ACTOR_DEFAULT_KEY_VALUE_STORE_ID ||
        process.env.APIFY_DEFAULT_KEY_VALUE_STORE_ID;

    if (!defaultKvsId) {
        console.error(chalk.red('Error: No key-value store ID available.'));
        console.error(
            chalk.gray('Set ACTOR_DEFAULT_KEY_VALUE_STORE_ID environment variable.')
        );
        process.exit(1);
    }

    try {
        const record = await getRuntimeClient().keyValueStore(defaultKvsId).getRecord(key);

        if (!record) {
            console.error(chalk.red(`Error: Key '${key}' not found in key-value store.`));
            process.exit(1);
        }

        if (typeof record.value === 'string') {
            console.log(record.value);
        } else {
            console.log(JSON.stringify(record.value, null, 2));
        }
    } catch (err) {
        console.error(chalk.red(`Error: Key '${key}' not found in key-value store.`));
        console.error(chalk.gray(`Details: ${(err as Error).message}`));
        process.exit(1);
    }
}

/**
 * actor set-value - Set or delete a value in the default key-value store
 */
export async function setValueCommand(
    key: string,
    value?: string,
    options?: { contentType?: string }
): Promise<void> {
    if (!key) {
        console.error(chalk.red('Error: Key is required.'));
        process.exit(1);
    }

    const defaultKvsId =
        process.env.ACTOR_DEFAULT_KEY_VALUE_STORE_ID ||
        process.env.APIFY_DEFAULT_KEY_VALUE_STORE_ID;

    if (!defaultKvsId) {
        console.error(chalk.red('Error: No key-value store ID available.'));
        console.error(
            chalk.gray('Set ACTOR_DEFAULT_KEY_VALUE_STORE_ID environment variable.')
        );
        process.exit(1);
    }

    try {
        const kvs = getRuntimeClient().keyValueStore(defaultKvsId);

        // If no value provided, delete the key
        if (value === undefined || value === '') {
            await kvs.deleteRecord(key);
            console.log(chalk.green(`✓ Key '${key}' deleted successfully`));
            return;
        }

        const contentType = options?.contentType || 'application/json';
        if (contentType.includes('application/json')) {
            try {
                JSON.parse(value);
            } catch {
                console.error(chalk.red('Error: Invalid JSON value.'));
                process.exit(1);
            }
        }

        await kvs.setRecord({ key, value, contentType });
        console.log(chalk.green(`✓ Value set for key '${key}'`));
    } catch (err) {
        console.error(chalk.red('Error: Failed to set value in key-value store.'));
        console.error(chalk.gray(`Details: ${(err as Error).message}`));
        process.exit(1);
    }
}

/**
 * actor get-public-url - Get a public URL for a key-value store record
 */
export async function getPublicUrlCommand(key: string): Promise<void> {
    if (!key) {
        console.error(chalk.red('Error: Key is required.'));
        process.exit(1);
    }

    const apiBaseUrl = resolveApiBaseUrl();
    const defaultKvsId =
        process.env.ACTOR_DEFAULT_KEY_VALUE_STORE_ID ||
        process.env.APIFY_DEFAULT_KEY_VALUE_STORE_ID;

    if (!defaultKvsId) {
        console.error(chalk.red('Error: No key-value store ID available.'));
        console.error(
            chalk.gray('Set ACTOR_DEFAULT_KEY_VALUE_STORE_ID environment variable.')
        );
        process.exit(1);
    }

    const publicUrl = `${apiBaseUrl}/v2/key-value-stores/${defaultKvsId}/records/${encodeURIComponent(key)}?enablePublicUrl=true`;
    console.log(publicUrl);
}

/**
 * actor charge - Charge for a specific event in a pay-per-event actor run
 */
export async function chargeCommand(
    eventName: string,
    options?: { count?: number; idempotencyKey?: string; testPayPerEvent?: boolean }
): Promise<void> {
    if (!eventName) {
        console.error(chalk.red('Error: Event name is required.'));
        console.log(chalk.gray('Usage: scrapely actor charge <eventName> [--count <n>]'));
        process.exit(1);
    }

    // --test-pay-per-event is a client-side no-op (platform convention):
    // it never sends an HTTP request, so no charge can ever be recorded — not
    // even a run ID is needed. (The server ignores unknown body fields, so
    // sending the flag over the wire would have produced a REAL charge.)
    if (options?.testPayPerEvent) {
        console.log(chalk.green(
            `PPE test mode: would charge ${options.count ?? 1} event(s) of type "${eventName}" ` +
            `with idempotency key "${options.idempotencyKey ?? 'not-provided'}" (no actual charge).`,
        ));
        return;
    }

    const runId = process.env.ACTOR_RUN_ID || process.env.APIFY_ACTOR_RUN_ID;

    if (!runId) {
        console.error(chalk.red('Error: No run ID available.'));
        console.error(chalk.gray('Set ACTOR_RUN_ID environment variable.'));
        process.exit(1);
    }

    try {
        await getRuntimeClient().run(runId).charge({
            eventName,
            ...(options?.count !== undefined ? { count: options.count } : {}),
            ...(options?.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
        });

        console.log(chalk.green(`✓ Charged for event "${eventName}"`));
    } catch (err) {
        console.error(chalk.red('Error: Failed to charge for event.'));
        console.error(chalk.gray(`Details: ${(err as Error).message}`));
        process.exit(1);
    }
}

// ─── JSON Schema → TypeScript generation ─────────────────────────────────────

type JsonSchema = {
    type?: string | string[];
    title?: string;
    description?: string;
    properties?: Record<string, JsonSchema>;
    items?: JsonSchema | JsonSchema[];
    required?: string[];
    enum?: unknown[];
    const?: unknown;
    anyOf?: JsonSchema[];
    oneOf?: JsonSchema[];
    allOf?: JsonSchema[];
    additionalProperties?: boolean | JsonSchema;
    $ref?: string;
    definitions?: Record<string, JsonSchema>;
    $defs?: Record<string, JsonSchema>;
    default?: unknown;
};

function toPascalCase(name: string): string {
    return name
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .split(' ')
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('')
        .replace(/^[0-9]/, '_$&');
}

function toSafeIdent(name: string): string {
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) return name;
    return JSON.stringify(name);
}

function schemaTypeToTs(
    schema: JsonSchema | undefined,
    name: string,
    interfaces: Map<string, string>,
    allOptional: boolean,
    strict: boolean
): string {
    if (!schema || typeof schema !== 'object') return 'unknown';

    if (schema.enum && Array.isArray(schema.enum) && schema.enum.length > 0) {
        return schema.enum
            .map((v) => (typeof v === 'string' ? JSON.stringify(v) : String(v)))
            .join(' | ');
    }

    if (schema.const !== undefined) {
        return typeof schema.const === 'string'
            ? JSON.stringify(schema.const)
            : String(schema.const);
    }

    if (schema.anyOf || schema.oneOf) {
        const variants = (schema.anyOf || schema.oneOf)!;
        return variants
            .map((v, i) => schemaTypeToTs(v, `${name}Option${i + 1}`, interfaces, allOptional, strict))
            .join(' | ');
    }

    if (schema.allOf && schema.allOf.length > 0) {
        return schema.allOf
            .map((v, i) => schemaTypeToTs(v, `${name}Part${i + 1}`, interfaces, allOptional, strict))
            .join(' & ');
    }

    const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];

    if (types.includes('object') || schema.properties) {
        const ifaceName = toPascalCase(name) || 'GeneratedType';
        if (!interfaces.has(ifaceName)) {
            // Reserve name to avoid recursion loops
            interfaces.set(ifaceName, '');
            const props = schema.properties || {};
            const required = new Set(schema.required || []);
            const lines: string[] = [];
            if (schema.description) {
                lines.push(`  /** ${schema.description.replace(/\*\//g, '*\\/')} */`);
            }
            for (const [propName, propSchema] of Object.entries(props)) {
                const optional = allOptional || !required.has(propName);
                const propType = schemaTypeToTs(
                    propSchema,
                    `${ifaceName}${toPascalCase(propName)}`,
                    interfaces,
                    allOptional,
                    strict
                );
                const desc = propSchema.description
                    ? `  /** ${propSchema.description.replace(/\*\//g, '*\\/')} */\n`
                    : '';
                lines.push(
                    `${desc}  ${toSafeIdent(propName)}${optional ? '?' : ''}: ${propType};`
                );
            }

            if (
                schema.additionalProperties &&
                typeof schema.additionalProperties === 'object'
            ) {
                const addType = schemaTypeToTs(
                    schema.additionalProperties,
                    `${ifaceName}Additional`,
                    interfaces,
                    allOptional,
                    strict
                );
                lines.push(`  [key: string]: ${addType};`);
            } else if (schema.additionalProperties === true && !strict) {
                lines.push('  [key: string]: unknown;');
            } else if (Object.keys(props).length === 0) {
                lines.push('  [key: string]: unknown;');
            }

            interfaces.set(
                ifaceName,
                `export interface ${ifaceName} {\n${lines.join('\n')}\n}\n`
            );
        }
        return ifaceName;
    }

    if (types.includes('array') || schema.items) {
        const items = Array.isArray(schema.items) ? schema.items[0] : schema.items;
        const itemType = schemaTypeToTs(items, `${name}Item`, interfaces, allOptional, strict);
        return `${itemType}[]`;
    }

    if (types.includes('string')) return 'string';
    if (types.includes('integer') || types.includes('number')) return 'number';
    if (types.includes('boolean')) return 'boolean';
    if (types.includes('null')) return 'null';

    // No type — if properties exist we already handled object; otherwise unknown
    if (schema.properties) {
        return schemaTypeToTs(
            { ...schema, type: 'object' },
            name,
            interfaces,
            allOptional,
            strict
        );
    }

    return 'unknown';
}

function extractInputSchema(raw: unknown, filePath: string): JsonSchema {
    if (!raw || typeof raw !== 'object') {
        throw new Error(`Schema file is not an object: ${filePath}`);
    }
    const obj = raw as Record<string, unknown>;

    // Direct JSON schema (actor configs also carry $schema, so exclude them)
    if (obj.actorSpecification === undefined && (obj.type === 'object' || obj.properties || obj.$schema)) {
        return obj as JsonSchema;
    }

    // scrapely.json / actor.json with embedded or referenced input
    if (obj.input && typeof obj.input === 'object') {
        return obj.input as JsonSchema;
    }

    if (typeof obj.input === 'string') {
        // SECURITY: Keep referenced schema paths within the schema file's directory
        let refPath: string;
        try {
            refPath = safeResolve(dirname(filePath), obj.input);
        } catch (err) {
            throw new Error(`Invalid referenced input schema path: ${(err as Error).message}`);
        }
        if (!existsSync(refPath)) {
            throw new Error(`Referenced input schema not found: ${refPath}`);
        }
        return JSON.parse(readFileSync(refPath, 'utf-8')) as JsonSchema;
    }


    // Fallback: treat whole file as schema-ish object
    return obj as JsonSchema;
}

/**
 * actor generate-schema-types - Generate TypeScript types from actor schemas
 */
export async function generateSchemaTypesCommand(
    path?: string,
    options?: { allOptional?: boolean; output?: string; strict?: boolean }
): Promise<void> {
    const cwd = process.cwd();

    let inputSchemaPath: string;
    if (path) {
        // SECURITY: Validate user-provided schema path stays within cwd
        try {
            inputSchemaPath = safeResolve(cwd, path);
        } catch (err) {
            console.error(chalk.red(`Error: Invalid schema path: ${(err as Error).message}`));
            process.exit(1);
        }
    } else {
        const defaultPaths = [
            join(cwd, 'INPUT_SCHEMA.json'),
            join(cwd, '.actor', 'INPUT_SCHEMA.json'),
            join(cwd, '.actor', 'input_schema.json'),
            join(cwd, 'input_schema.json'),
            join(cwd, '.actor', 'actor.json'),
            join(cwd, '.actor', 'scrapely.json'),
            join(cwd, 'scrapely.json'),
            join(cwd, 'actor.json'),
        ];
        inputSchemaPath = defaultPaths.find((p) => existsSync(p)) || join(cwd, 'scrapely.json');
    }

    if (!existsSync(inputSchemaPath)) {
        console.error(chalk.red(`Error: Schema file not found at ${inputSchemaPath}`));
        process.exit(1);
    }

    let raw: unknown;
    try {
        raw = JSON.parse(readFileSync(inputSchemaPath, 'utf-8'));
    } catch (err) {
        console.error(chalk.red(`Error: Failed to parse schema file.`));
        console.error(chalk.gray(`Details: ${(err as Error).message}`));
        process.exit(1);
    }

    let schema: JsonSchema;
    try {
        schema = extractInputSchema(raw, inputSchemaPath);
    } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
    }

    console.log(chalk.gray(`Generating TypeScript types from ${inputSchemaPath}...`));

    const interfaces = new Map<string, string>();
    const rootName =
        toPascalCase((schema.title as string) || 'ActorInput') || 'ActorInput';
    const allOptional = Boolean(options?.allOptional);
    const strict = Boolean(options?.strict);

    // Ensure root is emitted as an interface
    const rootType = schemaTypeToTs(
        { ...schema, type: schema.type || 'object' },
        rootName,
        interfaces,
        allOptional,
        strict
    );

    // If root collapsed to a non-interface type, wrap it
    if (!interfaces.has(rootName) && rootType !== rootName) {
        interfaces.set(rootName, `export type ${rootName} = ${rootType};\n`);
    }

    // SECURITY: Keep generated output under cwd
    let outputDir: string;
    try {
        outputDir = options?.output
            ? safeResolve(cwd, options.output)
            : join(cwd, 'src', '__generated__', 'actor');
        // Ensure default path is also validated as within cwd
        validatePathWithinDir(outputDir, cwd);
    } catch (err) {
        console.error(chalk.red(`Error: Invalid output path: ${(err as Error).message}`));
        process.exit(1);
    }
    mkdirSync(outputDir, { recursive: true });

    const header = `/* eslint-disable */\n/**\n * Auto-generated from ${inputSchemaPath}\n * Do not edit manually — run: scrapely actor generate-schema-types\n */\n\n`;
    const body = Array.from(interfaces.values()).filter(Boolean).join('\n');
    const outFile = join(outputDir, 'input.ts');
    writeFileSync(outFile, header + body + `\nexport type { ${rootName} as Input };\n`);

    // Also write an index barrel
    writeFileSync(
        join(outputDir, 'index.ts'),
        `export type { ${rootName}, ${rootName} as Input } from './input.js';\n`
    );


    console.log(chalk.green(`✓ TypeScript types generated to: ${outputDir}`));
    console.log(chalk.gray(`  - input.ts (${rootName})`));
    console.log(chalk.gray(`  - index.ts`));
}

/**
 * Set up the actor command with subcommands
 */
export function setupActorCommand(program: Command): void {
    const actorCmd = program
        .command('actor')
        .description(
            'Actor runtime commands: read input, push data, get/set records, charge, generate schema types'
        );

    addCalculateMemoryCommand(actorCmd);

    actorCmd
        .command('get-input')
        .description('Get the actor input from the default key-value store (falls back to the ACTOR_INPUT env var for local runs)')
        .action(getInputCommand);

    actorCmd
        .command('push-data [item]')
        .description("Push JSON data to the actor's default dataset")
        .action((item) => pushDataCommand(item));

    actorCmd
        .command('get-value <key>')
        .description('Get a value from the default key-value store')
        .action(getValueCommand);

    actorCmd
        .command('set-value <key> [value]')
        .description('Set or delete a value in the default key-value store (omit value to delete)')
        .option('-c, --content-type <type>', 'Content type of the value (default: application/json)')
        .action((key, value, options) => setValueCommand(key, value, options));

    actorCmd
        .command('get-public-url <key>')
        .description('Get a public URL for a key-value store record')
        .action(getPublicUrlCommand);

    actorCmd
        .command('charge <eventName>')
        .description('Charge for a specific event in a pay-per-event actor run')
        .option('--count <number>', 'Number of events to charge', parseInt)
        .option('--idempotency-key <key>', 'Idempotency key for the charge request')
        .option('--test-pay-per-event', 'Test pay-per-event charging without actually charging')
        .action((eventName, options) => chargeCommand(eventName, options));


    actorCmd
        .command('generate-schema-types [path]')
        .description('Generate TypeScript types from actor schemas')
        .option('--all-optional', 'Mark all properties as optional in generated types')
        .option('-o, --output <dir>', 'Output directory for generated files')
        .option('--strict', 'Whether generated interfaces should be strict')
        .action((path, options) => generateSchemaTypesCommand(path, options));
}
