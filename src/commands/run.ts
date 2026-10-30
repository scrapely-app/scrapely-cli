import chalk from 'chalk';
import { spawn } from 'child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'path';
import { findActorConfig, getActorConfig, getPackageConfig, getSecrets } from '../config.js';

/**
 * run — run the actor in the current directory LOCALLY (local run semantics).
 *
 * The SDKs detect local runs automatically: without SCRAPELY_IS_AT_HOME /
 * SCRAPELY_API_URL / ACTOR_RUN_ID the Node and Python SDKs fall back to Crawlee
 * local storage (`./storage`), and without CDP_URL browser crawlers launch a
 * local browser instead of connecting to the remote platform browser. Charging,
 * platform events, and the platform proxy are unavailable locally by design.
 *
 * Before each run the DEFAULT storages are purged (the "default" subdirectories
 * of ./storage/datasets, key_value_stores and request_queues); INPUT.json and
 * named storages are kept. Opt out with --no-purge. Environment variables from
 * the actor config (.actor/actor.json, .actor/scrapely.json, scrapely.json or actor.json) are injected into the run, with @secret
 * references resolved from `scrapely secrets`. Input-schema defaults are merged
 * into the run input and required fields are validated before the actor starts.
 *
 * For remote execution use `scrapely call` (waits) or `scrapely actors start`.
 */
export interface RunCommandOptions {
    input?: string;
    inputFile?: string;
    /** Purge the default local storages before running. Defaults to ON (CLI convention). */
    purge?: boolean;
    entrypoint?: string;
    /**
     * Positional argument kept registered so `scrapely run <actorId>` prints
     * actionable guidance instead of an unknown-argument error. `run` always
     * executes the local project; remote runs go through `scrapely call`.
     */
    actorId?: string;
    allowMissingSecrets?: boolean;
    resurrect?: boolean;
}

function warnRemoteOnlyFlags(options: RunCommandOptions): void {
    if (options.actorId) {
        console.log(chalk.gray('Note: an actorId argument selects a REMOTE actor — use `scrapely call <actorId>` for remote runs; `scrapely run` always runs the local project.'));
    }
    if (options.resurrect) console.log(chalk.gray('Note: `--resurrect` keeps the default local storages for this run (same as `--no-purge`; kept for CLI compatibility).'));
}

/** Resolve `-i` / `--input-file` into the raw input JSON string (or undefined). */
function resolveRawInput(options: RunCommandOptions): string | undefined {
    if (options.input && options.inputFile) {
        throw new Error('Pass either --input or --input-file, not both.');
    }
    if (options.input) return options.input;
    if (options.inputFile) {
        if (options.inputFile === '-') {
            return readFileSync(0, 'utf-8'); // stdin
        }
        const path = resolve(options.inputFile);
        if (!existsSync(path)) throw new Error(`Input file not found: ${path}`);
        return readFileSync(path, 'utf-8');
    }
    return undefined;
}

interface LocalCommand {
    command: string;
    args: string[];
}

/**
 * Ensure a repository-controlled path (--entrypoint, package.json "main")
 * resolves to a file INSIDE the project directory. Local runs must never let
 * actor metadata point at, or traverse into, files outside the project the
 * user explicitly chose to run.
 */
function assertInsideProject(cwd: string, target: string, label: string): string {
    const resolved = resolve(cwd, target);
    const rel = relative(cwd, resolved);
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
        throw new Error(`${label} "${target}" resolves outside the project directory, which is not allowed for local runs.`);
    }
    return resolved;
}

/**
 * Build the command that runs an npm script WITHOUT a shell.
 *
 * On Windows `npm` is a `.cmd` shim, and modern Node refuses to spawn
 * `.cmd`/`.bat` files without `shell: true` (CVE-2024-27980 mitigation), while
 * `shell: true` would let repository-controlled strings be parsed as command
 * text. Instead, run npm's JavaScript entrypoint (`npm-cli.js`, shipped next
 * to the Node binary) with the current Node executable — a real `.exe`, no
 * shell involved. On POSIX `npm` is a plain executable and spawns directly.
 */
function npmRunCommand(scriptName: string): LocalCommand {
    // npm script names come from package.json; only pass names that form a
    // single safe token so they can only ever be looked up, never interpreted.
    if (!/^[A-Za-z0-9._-]+$/.test(scriptName)) {
        throw new Error(
            `npm script name "${scriptName}" contains unsupported characters; `
                + 'run the script with --entrypoint <file.js> or from your own shell instead.',
        );
    }
    if (process.platform === 'win32') {
        const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
        if (existsSync(npmCli)) {
            return { command: process.execPath, args: [npmCli, 'run', scriptName] };
        }
        throw new Error(
            'Could not locate npm-cli.js next to the Node executable, so npm scripts cannot be run safely on Windows. '
                + 'Run your code with `scrapely run --entrypoint <file.js>` instead.',
        );
    }
    return { command: 'npm', args: ['run', scriptName] };
}

/**
 * Purge the DEFAULT local storages (`datasets/default`, `key_value_stores/default`,
 * `request_queues/default`) while preserving the default key-value store's INPUT.json
 * record — local run semantics. Named (non-default) storages are never touched.
 */
function purgeDefaultStorages(cwd: string): boolean {
    const storageDir = join(cwd, 'storage');
    if (!existsSync(storageDir)) return false;

    const kvDefaultDir = join(storageDir, 'key_value_stores', 'default');
    const inputPath = join(kvDefaultDir, 'INPUT.json');
    let savedInput: Buffer | null = null;
    let savedMode = 0o600;
    if (existsSync(inputPath)) {
        savedInput = readFileSync(inputPath);
        savedMode = statSync(inputPath).mode & 0o777;
    }

    for (const dir of [
        join(storageDir, 'datasets', 'default'),
        join(storageDir, 'key_value_stores', 'default'),
        join(storageDir, 'request_queues', 'default'),
    ]) {
        rmSync(dir, { recursive: true, force: true });
    }

    if (savedInput) {
        mkdirSync(kvDefaultDir, { recursive: true });
        // Keep the file's permissions: INPUT.json may hold secrets.
        writeFileSync(inputPath, savedInput, { mode: savedMode });
    }
    return true;
}

/**
 * Platform credentials a shell may carry (e.g. after `export SCRAPELY_TOKEN=...`).
 * A local run must not pick them up implicitly: with a token the SDK can reach
 * platform storage. The actor config's `environmentVariables` can still set them.
 */
export const PLATFORM_CREDENTIAL_ENV_VARS = [
    'SCRAPELY_TOKEN',
    'APIFY_TOKEN',
    'SCRAPELY_PROXY_PASSWORD',
    'APIFY_PROXY_PASSWORD',
    'SCRAPELY_IS_AT_HOME',
    'APIFY_IS_AT_HOME',
];

export function withoutPlatformCredentials(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const kept = { ...env };
    for (const key of PLATFORM_CREDENTIAL_ENV_VARS) delete kept[key];
    return kept;
}

/**
 * Resolve the actor config's `environmentVariables` for the local run.
 * Values referencing secrets (`@secretName`) are resolved from `scrapely secrets`.
 * Missing secrets throw unless --allow-missing-secrets is passed (then the variable
 * is left unset with a warning).
 */
function resolveActorEnv(actorConfig: ReturnType<typeof getActorConfig>, options: RunCommandOptions): Record<string, string> {
    const envVars = actorConfig?.environmentVariables;
    if (!envVars || Object.keys(envVars).length === 0) return {};

    const secrets = getSecrets();
    const resolved: Record<string, string> = {};
    const missing: string[] = [];
    for (const [key, value] of Object.entries(envVars)) {
        if (typeof value === 'string' && value.startsWith('@')) {
            const secret = secrets[value.substring(1)];
            if (secret) {
                resolved[key] = secret.value;
            } else {
                missing.push(`${key} (@${value.substring(1)})`);
            }
        } else {
            resolved[key] = value as string;
        }
    }

    if (missing.length > 0) {
        const detail = `Missing secrets used by environment variables: ${missing.join(', ')}. `
            + 'Add them with `scrapely secrets add <name> <value>` or pass --allow-missing-secrets.';
        if (options.allowMissingSecrets) {
            console.warn(chalk.yellow(`Warning: ${detail}`));
        } else {
            throw new Error(detail);
        }
    }
    return resolved;
}

interface InputSchema {
    properties?: Record<string, { default?: unknown }>;
    required?: string[];
}

/** Load the actor's input schema: actorConfig.input path, or .actor/input_schema.json. */
function loadInputSchema(cwd: string): InputSchema | null {
    const found = findActorConfig(cwd);
    const actorConfig = found?.config;
    if (actorConfig?.input && typeof actorConfig.input === 'object') {
        return actorConfig.input as InputSchema;
    }
    const candidates: string[] = [];
    if (typeof actorConfig?.input === 'string' && actorConfig.input) {
        // Relative to the config file's directory, then the project root
        if (found) candidates.push(resolve(found.dir, actorConfig.input));
        candidates.push(resolve(cwd, actorConfig.input));
        candidates.push(resolve(cwd, '.actor', actorConfig.input));
    }
    candidates.push(join(cwd, '.actor', 'input_schema.json'));
    for (const path of candidates) {
        if (existsSync(path)) {
            try {
                return JSON.parse(readFileSync(path, 'utf-8')) as InputSchema;
            } catch {
                console.warn(chalk.yellow(`Warning: input schema at ${path} is not valid JSON; skipping schema defaults and validation.`));
                return null;
            }
        }
    }
    return null;
}

/**
 * Apply input-schema defaults to the run input and check `required` fields,
 * mirroring what the platform does before an actor run. Throws a descriptive
 * error when required input fields are missing.
 */
function applyInputSchema(input: Record<string, unknown>, schema: InputSchema): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...input };
    for (const [key, property] of Object.entries(schema.properties ?? {})) {
        if (property?.default !== undefined && merged[key] === undefined) {
            merged[key] = property.default;
        }
    }
    const missing = (schema.required ?? []).filter((key) => merged[key] === undefined);
    if (missing.length > 0) {
        throw new Error(
            `Input is missing required field(s): ${missing.join(', ')} (per the actor's input schema). `
                + 'Provide them via --input/--input-file or storage/key_value_stores/default/INPUT.json.',
        );
    }
    return merged;
}

/**
 * Resolve the Python interpreter for a local run. Standard Python actor
 * projects keep their dependencies in a local `.venv` (created by project
 * templates / `python -m venv`); prefer it so `scrapely run` works without a
 * global install, falling back to the system interpreter.
 */
function resolveVenvPython(cwd: string): string {
    const venvPython = process.platform === 'win32'
        ? join(cwd, '.venv', 'Scripts', 'python.exe')
        : join(cwd, '.venv', 'bin', 'python');
    if (existsSync(venvPython)) return venvPython;
    return process.platform === 'win32' ? 'python' : 'python3';
}

/** Detect how to start the local actor: npm start / node entry / python main. */
function detectLocalCommand(options: RunCommandOptions, cwd: string): LocalCommand {
    const packageConfig = getPackageConfig(cwd);

    // Node project
    if (packageConfig) {
        if (options.entrypoint) {
            // --entrypoint may be a JS file, a directory with
            // index.js, or the name of an npm script in package.json. The path
            // must resolve INSIDE the project directory before we ever spawn.
            const entry = assertInsideProject(cwd, options.entrypoint, '--entrypoint');
            if (existsSync(entry)) {
                const target = statSync(entry).isDirectory() ? join(entry, 'index.js') : entry;
                if (existsSync(target)) {
                    return { command: process.execPath, args: [target] };
                }
            }
            if (packageConfig.scripts?.[options.entrypoint]) {
                return npmRunCommand(options.entrypoint);
            }
            throw new Error(
                `--entrypoint "${options.entrypoint}" is neither an existing file/directory (with index.js) `
                    + 'nor an npm script name defined in package.json.',
            );
        }
        if (packageConfig.scripts?.start) {
            return npmRunCommand('start');
        }
        if (packageConfig.main) {
            const mainPath = assertInsideProject(cwd, packageConfig.main, 'package.json "main"');
            return { command: process.execPath, args: [mainPath] };
        }
        throw new Error(
            'package.json has neither a "start" script nor a "main" field. ' +
                'Add one, or pass --entrypoint <file.js>.',
        );
    }

    // Python project
    if (options.entrypoint) {
        // --entrypoint may be a .py file or a Python module
        // name (run with `python -m <name>`).
        if (options.entrypoint.endsWith('.py')) {
            const path = assertInsideProject(cwd, options.entrypoint, '--entrypoint');
            if (existsSync(path) && statSync(path).isFile()) {
                return { command: resolveVenvPython(cwd), args: [path] };
            }
        }
        return { command: resolveVenvPython(cwd), args: ['-m', options.entrypoint] };
    }
    for (const candidate of ['main.py', 'src/main.py']) {
        const path = join(cwd, candidate);
        if (existsSync(path) && statSync(path).isFile()) {
            return { command: resolveVenvPython(cwd), args: [path] };
        }
    }

    throw new Error(
        'No local actor project found in the current directory ' +
            '(expected package.json, main.py, or src/main.py). ' +
            '`scrapely run` executes the local project — for remote execution use `scrapely call`.',
    );
}

export async function runCommand(options: RunCommandOptions = {}): Promise<void> {
    warnRemoteOnlyFlags(options);

    const cwd = process.cwd();
    const actorConfig = getActorConfig(cwd);

    // Purge the DEFAULT storages before every local run (CLI convention),
    // keeping INPUT.json and any named storages. Opt out with --no-purge or
    // --resurrect (resurrect keeps the default request queue,
    // dataset and key-value store before the run starts).
    const shouldPurge = options.purge !== false && !options.resurrect;
    let purged = false;
    if (shouldPurge) {
        purged = purgeDefaultStorages(cwd);
        if (purged) {
            console.log(chalk.blue('Purged default local storages (./storage/{datasets,key_value_stores,request_queues}/default); kept INPUT.json and named storages.'));
        }
    }

    const actorEnv = resolveActorEnv(actorConfig, options);
    const runEnv: NodeJS.ProcessEnv = { ...withoutPlatformCredentials(process.env), ...actorEnv, ACTOR_INPUT_KEY: 'INPUT' };

    const rawInput = resolveRawInput(options);
    const schema = loadInputSchema(cwd);
    let input: Record<string, unknown> | undefined;
    let rawKvRecord = false;
    if (rawInput !== undefined) {
        try {
            input = JSON.parse(rawInput) as Record<string, unknown>;
        } catch (err) {
            throw new Error(`--input is not valid JSON: ${(err as Error).message}`);
        }
    } else {
        // Without -i/-f the SDK reads INPUT from the default local key-value
        // store (storage/key_value_stores/default/INPUT.json)
        const kvInput = join(cwd, 'storage', 'key_value_stores', 'default', 'INPUT.json');
        if (existsSync(kvInput)) {
            try {
                input = JSON.parse(readFileSync(kvInput, 'utf-8')) as Record<string, unknown>;
                console.log(chalk.blue('Using input from storage/key_value_stores/default/INPUT.json.'));
            } catch {
                // Non-JSON INPUT record: leave it for the SDK to consume as-is.
                rawKvRecord = true;
            }
        }
    }

    // Run schema defaulting and required-field validation even when no input
    // source was supplied, so a schema with required fields fails fast with a
    // preflight error instead of letting the actor start with missing data.
    // (A non-JSON INPUT record is the exception: it goes to the SDK untouched.)
    if (!rawKvRecord && schema) {
        input = applyInputSchema(input ?? {}, schema);
    }

    if (input !== undefined) {
        // The platform passes ACTOR_INPUT base64-encoded; mirror that locally so
        // Actor.getInput() takes the same path in local and remote runs. This also
        // carries any schema-defaulted fields when the raw INPUT.json lacks them.
        runEnv.ACTOR_INPUT = Buffer.from(JSON.stringify(input), 'utf-8').toString('base64');
    }

    const { command, args } = detectLocalCommand(options, cwd);
    console.log(chalk.blue(`Running locally: ${command} ${args.join(' ')}`));
    console.log(chalk.gray('Local mode: Crawlee local storage (./storage), local browser launch, no platform proxy/charging. Use `scrapely call` to run remotely.'));

    // shell: false (default) — repository-controlled paths and npm script names
    // are passed as literal argv entries and can never be parsed as shell
    // command text. (Windows npm scripts run via node.exe + npm-cli.js, see
    // npmRunCommand.)
    const child = spawn(command, args, { cwd, env: runEnv, stdio: 'inherit' });

    const forwardSignal = (signal: NodeJS.Signals) => {
        child.kill(signal);
    };
    process.on('SIGINT', () => forwardSignal('SIGINT'));
    process.on('SIGTERM', () => forwardSignal('SIGTERM'));

    const exitCode: number | null = await new Promise((resolveExit, rejectExit) => {
        child.on('error', rejectExit);
        child.on('exit', (code) => resolveExit(code));
    });

    if (exitCode !== null && exitCode !== 0) {
        process.exitCode = exitCode;
    }
}

