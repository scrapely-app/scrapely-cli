#!/usr/bin/env node
// Portions derived from apify-cli (Copyright Apify Technologies s.r.o., Apache-2.0).
// Modified by TeraShift GmbH. See the LICENSE and NOTICE files.

import chalk from 'chalk';
import { Command } from 'commander';
import inquirer from 'inquirer';
import { getLocalConfig } from '../config.js';
import { getClient, getLoggedClientOrThrow } from '../client.js';
import { pullCommand } from './pull.js';
import { pushCommand } from './push.js';
import { buildCreateCommand } from './builds.js';
import { resolveRemoteInput } from '../utils/inputResolution.js';
import { terminalSafeLine as line, terminalSafeText, stdoutSafeText } from '../utils/terminal.js';

/**
 * actors ls - List actors
 */
export async function listActorsCommand(options?: { my?: boolean; limit?: number; offset?: number; desc?: boolean; json?: boolean }): Promise<void> {
    const client = getLoggedClientOrThrow();

    try {
        const result = await client.actors().list({
            ...(options?.my !== undefined ? { my: options.my } : {}),
            ...(options?.limit !== undefined ? { limit: options.limit } : {}),
            ...(options?.offset !== undefined ? { offset: options.offset } : {}),
            ...(options?.desc !== undefined ? { desc: options.desc } : {}),
        });

        if (options?.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
        }

        if (result.items && result.items.length > 0) {
            console.log(chalk.bold('Actors:'));
            for (const actor of result.items as Array<{ name: string; username: string; title?: string; isPublic?: boolean }>) {
                const visibility = actor.isPublic ? chalk.green('public') : chalk.yellow('private');
                console.log(`  ${chalk.cyan(line(`${actor.username}/${actor.name}`))} ${chalk.gray(line(actor.title || ''))} [${visibility}]`);
            }
        } else {
            console.log(chalk.gray('No actors found.'));
        }
    } catch (err) {
        console.error(chalk.red('Error: Failed to list actors.'));
        console.error(chalk.gray(`Details: ${(err as Error).message}`));
        process.exit(1);
    }
}

/**
 * actors search - Search actors in the Store (Store listing search)
 */
export async function actorsSearchCommand(query?: string, options?: { category?: string; username?: string; pricingModel?: string; limit?: number; offset?: number; sortBy?: string; json?: boolean }): Promise<void> {
    // store search does not require authentication.
    const client = getClient();

    const pricingModelLabels: Record<string, string> = {
        FREE: 'Free',
        FLAT_PRICE_PER_MONTH: 'Subscription',
        PRICE_PER_DATASET_ITEM: 'Pay per result',
        PAY_PER_EVENT: 'Pay per event',
    };

    try {
        const result = await client.store().list({
            ...(query !== undefined ? { search: query } : {}),
            ...(options?.sortBy !== undefined ? { sortBy: options.sortBy } : {}),
            ...(options?.category !== undefined ? { category: options.category } : {}),
            ...(options?.username !== undefined ? { username: options.username } : {}),
            ...(options?.pricingModel !== undefined ? { pricingModel: options.pricingModel } : {}),
            ...(options?.limit !== undefined ? { limit: options.limit } : {}),
            ...(options?.offset !== undefined ? { offset: options.offset } : {}),
        });

        if (options?.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
        }

        if (result.count === 0) {
            console.log(chalk.gray('No actors found matching your search.'));
            return;
        }

        for (const item of result.items) {
            const pricingModel = (item as { currentPricingInfo?: { pricingModel?: string } }).currentPricingInfo?.pricingModel;
            const stats = (item as { stats?: { totalUsers30Days?: number } }).stats;
            console.log(`  ${chalk.cyan(line(item.title ?? `${item.username}/${item.name}`))} ${chalk.gray(line(`${item.username}/${item.name}`))}`);
            if (item.description) {
                const safe = line(item.description);
                const desc = safe.length > 100 ? `${safe.substring(0, 100)}...` : safe;
                console.log(chalk.gray(`    ${desc}`));
            }
            console.log(chalk.gray(`    Users (30d): ${stats?.totalUsers30Days ?? 0} | Pricing: ${pricingModelLabels[pricingModel ?? ''] ?? pricingModel ?? 'Unknown'}`));
        }
    } catch (err) {
        console.error(chalk.red('Error: Failed to search actors.'));
        console.error(chalk.gray(`Details: ${(err as Error).message}`));
        process.exit(1);
    }
}

/**
 * actors rm - Delete an actor
 */
export async function actorsRmCommand(actorId: string, options?: { yes?: boolean }): Promise<void> {
    if (!actorId) {
        console.error(chalk.red('Error: Actor ID is required.'));
        process.exit(1);
    }

    // Confirm deletion unless --yes flag is set
    if (!options?.yes) {
        const { confirm } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'confirm',
                message: `Are you sure you want to delete actor "${actorId}"?`,
                default: false,
            },
        ]);
        
        if (!confirm) {
            console.log(chalk.gray('Cancelled.'));
            return;
        }
    }
    
    const client = getLoggedClientOrThrow();

    try {
        await client.actor(actorId).delete();
        console.log(chalk.green(`✓ Actor ${actorId} deleted successfully`));
    } catch (err) {
        console.error(chalk.red('Error: Failed to delete actor.'));
        console.error(chalk.gray(`Details: ${(err as Error).message}`));
        process.exit(1);
    }
}

/**
 * actors info - Get actor info
 */
export async function actorInfoCommand(actorId: string, options?: { input?: boolean; readme?: boolean; json?: boolean }): Promise<void> {
    if (!actorId) {
        console.error(chalk.red('Error: Actor ID is required.'));
        process.exit(1);
    }

    const client = getLoggedClientOrThrow();

    try {
        const actor = await client.actor(actorId).get();

        if (!actor) {
            console.error(chalk.red(`Error: Actor "${actorId}" not found.`));
            process.exit(1);
        }

        // The input schema and README of the build the caller runs (default build for owners, User Build for others).
        const definition = (actor as { defaultBuildActorDefinition?: { input?: unknown; inputSchema?: unknown; readme?: unknown } }).defaultBuildActorDefinition;

        // --input: return only the actor input schema
        if (options?.input) {
            const inputSchema = definition?.input ?? definition?.inputSchema;
            if (inputSchema) {
                console.log(JSON.stringify(inputSchema, null, 2));
            } else {
                console.log(chalk.gray('No input schema found for this actor.'));
            }
            return;
        }

        // --readme: print README only
        if (options?.readme) {
            const readme = definition?.readme;
            if (typeof readme === 'string' && readme.length > 0) {
                console.log(terminalSafeText(readme));
            } else {
                console.log(chalk.gray('No README found for this actor.'));
            }
            return;
        }

        if (options?.json) {
            console.log(JSON.stringify(actor, null, 2));
            return;
        }

        console.log(chalk.bold('Actor Info:'));
        console.log(`  ID: ${chalk.cyan(actor.id)}`);
        console.log(`  Name: ${line(`${actor.username}/${actor.name}`)}`);
        if (actor.title) console.log(`  Title: ${line(actor.title)}`);
        if (actor.description) console.log(`  Description: ${line(actor.description)}`);
        console.log(`  Visibility: ${actor.isPublic ? chalk.green('public') : chalk.yellow('private')}`);
        if (actor.versions && actor.versions.length > 0) {
            console.log(`  Versions: ${actor.versions.map(v => v.versionNumber).join(', ')}`);
        }
    } catch (err) {
        console.error(chalk.red('Error: Failed to get actor info.'));
        console.error(chalk.gray(`Details: ${(err as Error).message}`));
        process.exit(1);
    }
}

/**
 * actors call - Execute actor synchronously (waits for completion)
 */
/** Run statuses that are final — everything else (RUNNING, READY, ABORTING,
 * TIMING-OUT, RESURRECTED, ...) must keep being polled so a graceful abort or
 * a resurrection is reported with its true final status. */
const TERMINAL_RUN_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT', 'ZOMBIE']);

/** Stream newly appended run-log bytes to stdout (best-effort); returns the new offset. */
export async function streamNewLogBytes(runId: string, offset: number): Promise<number> {
    try {
        const log = await getLoggedClientOrThrow().run(runId).log().get();
        const logText = typeof log === 'string' ? log : '';
        if (logText.length > offset) {
            process.stdout.write(stdoutSafeText(logText.slice(offset)));
            return logText.length;
        }
        // Log was rotated/truncated — resync to its current length.
        return logText.length;
    } catch {
        return offset; // best-effort streaming: never fail the call on log errors
    }
}

export async function actorCallCommand(actorId?: string, options?: {
    input?: string;
    inputFile?: string;
    build?: string;
    memory?: number;
    timeout?: number;
    outputDataset?: boolean;
    silent?: boolean;
    json?: boolean;
}): Promise<void> {
    // Fall back to the actor in the current directory's configuration (scrapely.json / .actor/actor.json)
    if (!actorId) {
        const localConfig = getLocalConfig(process.cwd());
        actorId = localConfig?.actorId;
    }

    if (!actorId) {
        console.error(chalk.red('Error: Actor ID is required. Run from a directory with a local actor configuration or pass an actor ID.'));
        process.exit(1);
    }

    const jsonMode = !!options?.json;
    const silent = !!options?.silent || jsonMode;

    // Parse input (--input / --input-file, falling back to the local default
    // key-value store INPUT.json
    const input = await resolveRemoteInput({ input: options?.input, inputFile: options?.inputFile }, silent);

    try {
        if (!silent) {
            console.log(chalk.gray(`Starting actor ${actorId}...`));
        }

        const run = await getLoggedClientOrThrow().actor(actorId).start(input, {
            ...(options?.build !== undefined ? { build: options.build } : {}),
            ...(options?.memory !== undefined ? { memory: options.memory } : {}),
            ...(options?.timeout !== undefined ? { timeout: options.timeout } : {}),
        });

        if (!silent) {
            console.log(chalk.green(`✓ Run started: ${run.id}`));
        }

        // Wait for completion, streaming new log bytes unless --silent/--json.
        // Only terminal statuses exit the loop (see TERMINAL_RUN_STATUSES) —
        // transient states like ABORTING keep polling.
        let finalRun = run;
        let runStatus = run.status;
        let logOffset = 0;
        while (!TERMINAL_RUN_STATUSES.has(runStatus)) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            finalRun = (await getLoggedClientOrThrow().run(run.id).get())!;
            runStatus = finalRun.status;
            if (!silent) {
                logOffset = await streamNewLogBytes(run.id, logOffset);
            }
        }

        if (jsonMode) {
            console.log(JSON.stringify({ data: finalRun }, null, 2));
            if (runStatus !== 'SUCCEEDED') {
                process.exit(1);
            }
            return;
        }
        
        if (runStatus === 'SUCCEEDED') {
            console.log(chalk.green(`✓ Run completed successfully`));
            
            if (options?.outputDataset && finalRun.defaultDatasetId) {
                try {
                    const { items } = await getLoggedClientOrThrow().dataset(finalRun.defaultDatasetId).listItems();
                    console.log(JSON.stringify(items, null, 2));
                } catch {
                    console.log(chalk.gray(`Dataset ID: ${finalRun.defaultDatasetId}`));
                }
            }
        } else {
            console.log(chalk.red(`✗ Run ${runStatus}`));
            process.exit(1);
        }
    } catch (err) {
        console.error(chalk.red('Error: Failed to run actor.'));
        console.error(chalk.gray(`Details: ${(err as Error).message}`));
        process.exit(1);
    }
}

/**
 * actors start - Execute actor asynchronously (returns immediately)
 */
export async function actorStartCommand(actorId: string, options?: {
    input?: string;
    inputFile?: string;
    build?: string;
    memory?: number;
    timeout?: number;
    json?: boolean;
}): Promise<void> {
    if (!actorId) {
        console.error(chalk.red('Error: Actor ID is required.'));
        process.exit(1);
    }

    // Parse input (--input / --input-file, falling back to the local default
    // key-value store INPUT.json
    const input = await resolveRemoteInput({ input: options?.input, inputFile: options?.inputFile }, !!options?.json);

    try {
        const run = await getLoggedClientOrThrow().actor(actorId).start(input, {
            ...(options?.build !== undefined ? { build: options.build } : {}),
            ...(options?.memory !== undefined ? { memory: options.memory } : {}),
            ...(options?.timeout !== undefined ? { timeout: options.timeout } : {}),
        });

        if (options?.json) {
            console.log(JSON.stringify({ data: run }, null, 2));
            return;
        }
        
        console.log(chalk.green(`✓ Run started: ${run.id}`));
        console.log(chalk.gray(`Status: ${run.status}`));
    } catch (err) {
        console.error(chalk.red('Error: Failed to start actor.'));
        console.error(chalk.gray(`Details: ${(err as Error).message}`));
        process.exit(1);
    }
}

/**
 * Set up the actors command with subcommands
 */
export function setupActorsCommand(program: Command): void {
    const actorsCmd = program
        .command('actors')
        .description('Manage actors (ls, search, info, call, start, pull, build, push, rm)');
    
    actorsCmd
        .command('ls')
        .description('List actors')
        .option('--my', 'List only my actors')
        .option('--limit <number>', 'Maximum number of actors to return', parseInt)
        .option('--offset <number>', 'Number of actors to skip', parseInt)
        .option('--desc', 'Sort in descending order')
        .option('--json', 'Format output as JSON')
        .action((options) => listActorsCommand(options));
    
    actorsCmd
        .command('search [query]')
        .description('Search actors in the Scrapely Store')
        .option('--category <category>', 'Filter by category')
        .option('--username <username>', 'Filter by author username')
        .option('--pricing-model <model>', 'Filter by pricing model')
        .option('--limit <number>', 'Maximum number of results', parseInt)
        .option('--offset <number>', 'Number of results to skip', parseInt)
        .option('--sort-by <field>', 'Sort order for results')
        .option('--json', 'Format output as JSON')
        .action((query, options) => actorsSearchCommand(query, options));
    
    actorsCmd
        .command('info <actorId>')
        .description('Get actor info')
        .option('--input', 'Return the actor input schema')
        .option('--readme', 'Return the actor README')
        .option('--json', 'Format output as JSON')
        .action((actorId, options) => actorInfoCommand(actorId, options));
    
    actorsCmd
        .command('rm <actorId>')
        .description('Permanently delete an actor')
        .option('-y, --yes', 'Skip confirmation prompt')
        .action((actorId, options) => actorsRmCommand(actorId, options));
    
    actorsCmd
        .command('call [actorId]')
        .description('Run an actor synchronously (waits for completion)')
        .option('-i, --input <json>', 'JSON input for the actor')
        .option('-f, --input-file <path>', 'Path to JSON input file (use - for stdin)')
        .option('-b, --build <tag>', 'Build tag or number to run (your own actors only)')
        .option('-m, --memory <mb>', 'Memory allocation in MB', parseInt)
        .option('-t, --timeout <seconds>', 'Timeout in seconds', parseInt)
        .option('-o, --output-dataset', 'Prints out the entire default dataset on successful run of the actor')
        .option('-s, --silent', 'Prevents printing the logs of the actor run to the console')
        .option('--json', 'Format output as JSON')
        .action((actorId, options) => actorCallCommand(actorId, options));
    
    actorsCmd
        .command('start [actorId]')
        .description('Run an actor asynchronously (returns immediately)')
        .option('-i, --input <json>', 'JSON input for the actor')
        .option('-f, --input-file <path>', 'Path to JSON input file (use - for stdin)')
        .option('-b, --build <tag>', 'Build tag or number to run (your own actors only)')
        .option('-m, --memory <mb>', 'Memory allocation in MB', parseInt)
        .option('-t, --timeout <seconds>', 'Timeout in seconds', parseInt)
        .option('--json', 'Format output as JSON')
        .action((actorId, options) => actorStartCommand(actorId, options));

    // actors push - Deploy actor to platform
    actorsCmd
        .command('push [actorId]')
        .description('Deploy actor to Scrapely platform using settings from the actor config (.actor/actor.json, .actor/scrapely.json or scrapely.json)')
        .option('-b, --build-tag <tag>', 'Build tag to be applied to the successful actor build')
        .option('--dir <path>', 'Directory where the actor is located')
        .option('-f, --force', 'Push an actor even when the local files are older than the actor on the platform')
        .option('-w, --wait-for-finish [seconds]', 'In seconds, how long to wait for the build to finish. If no value passed, it waits forever. To return as soon as the build is queued (fire-and-forget), pass 0.', (v: string) => parseInt(v, 10))
        .option('--json', 'Format the command output as JSON')
        .option('--open', 'Whether to open the browser automatically to the actor details page')
        .option('-v, --version <version>', 'Actor version number to which the files should be pushed')
        .option('--allow-missing-secrets', 'Allow the command to continue even when secret values are not found')
        .action(async (actorId, options) => {
            // Same as the top-level `scrapely push` command (static import, awaited
            // so failures surface as normal command errors, not unhandled rejections)
            await pushCommand({ ...options, waitForFinish: typeof options.waitForFinish === 'number' ? options.waitForFinish : undefined, actorId });
        });

    // actors pull - Alias of top-level `scrapely pull`
    actorsCmd
        .command('pull [actorId]')
        .description('Pull actor source code from Scrapely — source files or Git repository (same as `scrapely pull`)')
        .option('-v, --version <version>', 'Version to pull')
        .option('--dir <dir>', 'Directory where the actor should be pulled to')
        .action((actorId, options) => pullCommand(actorId, options));

    // actors build - Alias of `scrapely builds create`
    actorsCmd
        .command('build [actorId]')
        .description('Create a new build (same as `scrapely builds create`)')
        .option('--version <version>', 'Actor version to build')
        .option('--tag <tag>', 'Build tag')
        .option('--wait', 'Wait for build to complete')
        .option('--log', 'Print build log after completion')
        .option('--json', 'Format output as JSON')
        .action((actorId, options) => buildCreateCommand({ ...options, actorId }));
}
