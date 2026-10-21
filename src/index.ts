#!/usr/bin/env node
// Portions derived from apify-cli (src/commands/actors/push.ts, actors/call.ts, actors/pull.ts, src/commands/run.ts, init.ts; Copyright Apify Technologies s.r.o., Apache-2.0).
// Modified by TeraShift GmbH. See the LICENSE and NOTICE files.

import { Command } from 'commander';
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { infoCommand } from './commands/info.js';
import { initCommand } from './commands/init.js';
import { pushCommand } from './commands/push.js';
import { runCommand } from './commands/run.js';
import { actorCallCommand } from './commands/actors.js';
import { pullCommand } from './commands/pull.js';
import { setupActorCommand } from './commands/actor.js';
import { setupDatasetsCommand } from './commands/datasets.js';
import { setupKeyValueStoresCommand } from './commands/keyValueStores.js';
import { setupActorsCommand } from './commands/actors.js';
import { setupRunsCommand } from './commands/runs.js';
import { setupBuildsCommand } from './commands/builds.js';
import { setupSecretsCommand } from './commands/secrets.js';
import { setupAuthCommand } from './commands/auth.js';
import { setupHelpCommand } from './commands/help.js';
import { setupUpgradeCommand } from './commands/upgrade.js';
import { setupApiCommand } from './commands/api.js';
import { setupCreateCommand } from './commands/create.js';
import { setupTemplatesCommand } from './commands/templates.js';
import { setupValidateSchemaCommand } from './commands/validateSchema.js';
import { setupRequestQueuesCommand } from './commands/requestQueues.js';
import { setupTaskCommand } from './commands/task.js';
import { setupMcpCommand } from './commands/mcp.js';
import { addCalculateMemoryCommand } from './commands/calculateMemory.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

/**
 * CLI version read from package.json (src/index.ts and dist/index.js are both
 * one level below the package root). Keeps `--version` in sync with publishes.
 */
function getCliVersion(): string {
    try {
        const packageJsonPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
        const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
        return pkg.version ?? '0.0.0';
    } catch {
        return '0.0.0';
    }
}

const program = new Command();

program
    .name('scrapely')
    .description('CLI tool for Scrapely - manage actors and runs')
    .version(getCliVersion(), '-v, --version', 'output the current version');

// Login command
program
    .command('login')
    .description('Login to Scrapely. Prompts for a method (browser, console or manual token) when run without flags; pass --method or --token to skip the prompt')
    .option('-m, --method <method>', 'Login method (browser, console or manual)')
    .option('-t, --token <token>', 'API token for manual login')
    .action((options) => loginCommand(options));

// Logout command
program
    .command('logout')
    .description('Logout from Scrapely')
    .action(logoutCommand);

// Info command
program
    .command('info')
    .description('Show current user info')
    .action(infoCommand);

// Init command
program
    .command('init [name]')
    .description('Initialize a new Scrapely actor project. Prompts for an actor name when run without one; pass the name or --yes to skip prompts')
    .option('--dockerfile <path>', 'Path to a Dockerfile to use for the actor')
    .option('-y, --yes', 'Automatic yes to prompts; assume "yes" as answer to all prompts')
    .action((name, options) => initCommand(name, options));

// Push command(positional actor ID)
program
    .command('push [actorId]')
    .description('Push actor source code to Scrapely')
    .option('-v, --version <version>', 'Version number')
    .option('-b, --build-tag <tag>', 'Build tag')
    .option('-f, --force', 'Force push without the remote-is-newer confirmation')
    .option('--allow-missing-secrets', 'Allow missing secrets')
    .option('--dir <path>', 'Directory where the actor is located')
    .option('-w, --wait-for-finish [seconds]', 'In seconds, how long to wait for the build to finish. If no value passed, it waits forever. To return as soon as the build is queued (fire-and-forget), pass 0. The exit code reflects the build outcome only.', (v: string) => parseInt(v, 10))
    .option('--open', 'Open the browser automatically to the actor details page')
    .option('--json', 'Format output as JSON')
    .action((actorId, options) => pushCommand({ ...options, waitForFinish: typeof options.waitForFinish === 'number' ? options.waitForFinish : undefined, actorId }));

// Call command (top-level alias of `actors call`
program
    .command('call [actorId]')
    .description('Run an actor remotely (waits for completion; use `actors start` for fire-and-forget)')
    .option('-i, --input <json>', 'JSON input for the actor')
    .option('-f, --input-file <path>', 'Path to JSON input file (use - for stdin)')
    .option('-b, --build <tag>', 'Build tag or number to run (your own actors only)')
    .option('-m, --memory <mb>', 'Memory allocation in MB', parseInt)
    .option('-t, --timeout <seconds>', 'Timeout in seconds (0 means no timeout)', parseInt)
    .option('-o, --output-dataset', 'Prints out the entire default dataset on successful run of the actor')
    .option('-s, --silent', 'Prevents printing the logs of the actor run to the console')
    .option('--json', 'Format output as JSON')
    .action((actorId, options) => actorCallCommand(actorId, options));

// Run command — run the local actor project in the current directory
// (`scrapely call` is the remote equivalent)
program
    .command('run [actorId]')
    .description('Run the actor in the current directory locally (storage in ./storage); use `scrapely call` for remote runs')
    .option('-i, --input <json>', 'JSON input for the actor run')
    .option('-f, --input-file <path>', 'Path to JSON input file (use - for stdin)')
    .option('--entrypoint <path>', 'Optional entrypoint: a JS file path, a directory with index.js, or an npm script name (Node projects); a .py file or Python module name (Python projects)')
    .option('-p, --purge', 'Purge the default local storages before the run (this is the default behavior; kept for CLI compatibility)')
    .option('--no-purge', 'Keep previous run data; by default the default local storages are purged before each run (INPUT.json is always kept)')
    .option('--allow-missing-secrets', 'Warn instead of failing when an environment variable references a secret that is not in `scrapely secrets`')
    .option('--resurrect', 'Keep the default request queue, dataset and key-value store before the run starts (equivalent to --no-purge)')
    .action((actorId, options) => runCommand({ ...options, actorId }));

// Pull command
program
    .command('pull [actorId]')
    .description('Pull actor source code from Scrapely (source files or Git repository)')
    .option('-v, --version <version>', 'Version to pull')
    .option('--dir <dir>', 'Directory where the actor should be pulled to')
    .action((actorId, options) => pullCommand(actorId, options));

// Auth commands (login, logout, token)
setupAuthCommand(program);

// Actor runtime commands (get-input, push-data, get-value, set-value, get-public-url)
setupActorCommand(program);

// Dataset commands (create, get-items, push-items, ls, info, rm, rename)
setupDatasetsCommand(program);

// Key-value store commands (create, get-value, set-value, ls, keys, info, rm, rename, delete-value)
setupKeyValueStoresCommand(program);

// Actor management commands (ls, search, info, call, start, rm)
setupActorsCommand(program);

// Run management commands (ls, info, log, abort, wait, resurrect, rm)
setupRunsCommand(program);

// Build management commands (ls, info, log, wait, create, add-tag, remove-tag, rm)
setupBuildsCommand(program);

// Secrets management commands (add, ls, rm)
setupSecretsCommand(program);

// Help command (with --skill flag for agents)
setupHelpCommand(program);

// Upgrade command
setupUpgradeCommand(program);

// API command (make authenticated API requests)
setupApiCommand(program);

// Create command (template-based actor creation)
setupCreateCommand(program);
setupTemplatesCommand(program);

// Validate-schema command
setupValidateSchemaCommand(program);
addCalculateMemoryCommand(program);

// Request queue commands (ls, create, info, rm)
setupRequestQueuesCommand(program);

// MCP commands (install)
setupMcpCommand(program);

    // Task commands (run)
    setupTaskCommand(program);

    program.parse();
