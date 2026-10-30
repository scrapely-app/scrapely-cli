#!/usr/bin/env node

import chalk from 'chalk';
import { Command } from 'commander';
import inquirer from 'inquirer';
import { getActorConfig } from '../config.js';
import { getLoggedClientOrThrow } from '../client.js';
import { stdoutSafeText, terminalJson, terminalSafeError } from '../utils/terminal.js';

/**
 * runs ls - List runs
 */
export async function listRunsCommand(options?: { actorId?: string; limit?: number; offset?: number; desc?: boolean; compact?: boolean; json?: boolean }): Promise<void> {
    const client = getLoggedClientOrThrow();

    try {
        const listOptions = {
            ...(options?.limit !== undefined ? { limit: options.limit } : {}),
            ...(options?.offset !== undefined ? { offset: options.offset } : {}),
            ...(options?.desc !== undefined ? { desc: options.desc } : {}),
        };
        // listing an Actor's runs goes through the Actor sub-resource.
        const result = options?.actorId
            ? await client.actor(options.actorId).runs().list(listOptions)
            : await client.runs().list(listOptions);

        if (options?.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
        }

        if (result.items && result.items.length > 0) {
            console.log(chalk.bold('Runs:'));
            for (const run of result.items as Array<{ id: string; status: string; exitCode?: number }>) {
                const status = run.status === 'SUCCEEDED' ? chalk.green(run.status) :
                               run.status === 'FAILED' ? chalk.red(run.status) :
                               run.status === 'RUNNING' ? chalk.blue(run.status) :
                               chalk.yellow(run.status);
                const exitCode = run.exitCode !== undefined ? ` (exit: ${run.exitCode})` : '';
                if (options?.compact) {
                    console.log(`${chalk.cyan(run.id)} [${status}]${exitCode}`);
                } else {
                    console.log(`  ${chalk.cyan(run.id)} [${status}]${exitCode}`);
                }
            }
        } else {
            console.log(chalk.gray('No runs found.'));
        }
    } catch (err) {
        console.error(chalk.red('Error: Failed to list runs.'));
        console.error(chalk.gray(`Details: ${terminalSafeError(err)}`));
        process.exit(1);
    }
}

/**
 * runs info - Get run info
 */
export async function runInfoCommand(runId: string, options?: { verbose?: boolean; json?: boolean }): Promise<void> {
    if (!runId) {
        console.error(chalk.red('Error: Run ID is required.'));
        process.exit(1);
    }
    
    try {
        const run = (await getLoggedClientOrThrow().run(runId).get())!;
        if (!run) {
            console.error(chalk.red(`Error: Run "${runId}" not found.`));
            process.exit(1);
        }

        if (options?.json) {
            console.log(JSON.stringify({ data: run }, null, 2));
            return;
        }
        
        console.log(chalk.bold('Run Info:'));
        console.log(`  ID: ${chalk.cyan(run.id)}`);
        const status = run.status === 'SUCCEEDED' ? chalk.green(run.status) :
                       run.status === 'FAILED' ? chalk.red(run.status) :
                       run.status === 'RUNNING' ? chalk.blue(run.status) :
                       chalk.yellow(run.status);
        console.log(`  Status: ${status}`);
        if (run.exitCode !== undefined) {
            console.log(`  Exit Code: ${run.exitCode}`);
        }
        if (run.defaultDatasetId) {
            console.log(`  Dataset ID: ${run.defaultDatasetId}`);
        }
        if (run.defaultKeyValueStoreId) {
            console.log(`  KVS ID: ${run.defaultKeyValueStoreId}`);
        }
        // -v/--verbose: dump every field of the run object, not just the summary
        if (options?.verbose) {
            console.log(chalk.bold('  All fields:'));
            for (const [key, value] of Object.entries(run)) {
                console.log(`    ${key}: ${chalk.cyan(typeof value === 'object' ? JSON.stringify(value) : String(value))}`);
            }
        }
    } catch (err) {
        console.error(chalk.red('Error: Failed to get run info.'));
        console.error(chalk.gray(`Details: ${terminalSafeError(err)}`));
        process.exit(1);
    }
}

/**
 * runs log - Get run log
 */
export async function runLogCommand(runId: string): Promise<void> {
    if (!runId) {
        console.error(chalk.red('Error: Run ID is required.'));
        process.exit(1);
    }
    
    try {
        const log = await getLoggedClientOrThrow().run(runId).log().get();
        // An empty/missing body (e.g. logs expired per data-retention policy)
        // must not be printed as "undefined".
        const hasContent = typeof log === 'string' ? log.trim().length > 0 : Boolean(log);
        if (hasContent) {
            console.log(typeof log === 'string' ? stdoutSafeText(log) : terminalJson(JSON.stringify(log)));
        } else {
            console.log(chalk.gray('No log available for this run (it may have expired per the data-retention policy).'));
        }
    } catch (err) {
        console.error(chalk.red('Error: Failed to get run logs.'));
        console.error(chalk.gray(`Details: ${terminalSafeError(err)}`));
        process.exit(1);
    }
}

/**
 * runs abort - Abort a run
 */
export async function runAbortCommand(runId: string, options?: { force?: boolean; json?: boolean }): Promise<void> {
    if (!runId) {
        console.error(chalk.red('Error: Run ID is required.'));
        process.exit(1);
    }
    
    try {
        await getLoggedClientOrThrow().run(runId).abort({ gracefully: !options?.force });

        if (options?.json) {
            const run = (await getLoggedClientOrThrow().run(runId).get())!;
            console.log(JSON.stringify({ data: run }, null, 2));
            return;
        }

        console.log(chalk.green(`✓ Run ${runId} aborted`));
    } catch (err) {
        console.error(chalk.red('Error: Failed to abort run.'));
        console.error(chalk.gray(`Details: ${terminalSafeError(err)}`));
        process.exit(1);
    }
}

/**
 * Run statuses that are final — everything else (RUNNING, READY, ABORTING,
 * TIMING-OUT, ...) must keep being polled so a graceful abort or timeout is
 * reported with the run's actual terminal status.
 */
const TERMINAL_RUN_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT', 'ZOMBIE']);

/**
 * runs wait - Wait for run to complete
 */
export async function runWaitCommand(runId: string, options?: { timeout?: number; pollInterval?: number; json?: boolean }): Promise<void> {
    if (!runId) {
        console.error(chalk.red('Error: Run ID is required.'));
        process.exit(1);
    }
    
    const timeout = options?.timeout || 0; // 0 = no timeout
    const pollInterval = options?.pollInterval || 2; // seconds
    const startTime = Date.now();
    
    if (!options?.json) {
        console.log(chalk.gray(`Waiting for run ${runId}...`));
    }
    
    try {
        let run = (await getLoggedClientOrThrow().run(runId).get())!;
        if (!run) {
            console.error(chalk.red(`Error: Run "${runId}" not found.`));
            process.exit(1);
        }

        // Only terminal statuses exit the loop — transient states like ABORTING
        // and TIMING-OUT must keep polling so a graceful abort is reported with
        // its final status (same terminal set as `scrapely call`).
        while (!TERMINAL_RUN_STATUSES.has(run.status)) {
            if (timeout > 0 && (Date.now() - startTime) > timeout * 1000) {
                console.error(chalk.red(`Error: Timeout waiting for run after ${timeout}s`));
                process.exit(1);
            }

            await new Promise(resolve => setTimeout(resolve, pollInterval * 1000));
            run = (await getLoggedClientOrThrow().run(runId).get())!;
        }
        
        if (options?.json) {
            // Emit the JSON result, but mirror the human-readable branch (and
            // `scrapely call --json`): exit nonzero for any terminal status
            // other than SUCCEEDED so CI scripts can detect failed runs.
            console.log(JSON.stringify({ runId, status: run.status }, null, 2));
            if (run.status !== 'SUCCEEDED') {
                process.exit(1);
            }
            return;
        }
        
        if (run.status === 'SUCCEEDED') {
            console.log(chalk.green(`✓ Run ${runId} succeeded`));
        } else {
            console.log(chalk.red(`✗ Run ${runId} ${run.status}`));
            process.exit(1);
        }
    } catch (err) {
        console.error(chalk.red('Error: Failed to wait for run.'));
        console.error(chalk.gray(`Details: ${terminalSafeError(err)}`));
        process.exit(1);
    }
}

/**
 * runs resurrect - Resurrect an aborted or finished run
 */
export async function runResurrectCommand(runId: string, options?: { json?: boolean }): Promise<void> {
    if (!runId) {
        console.error(chalk.red('Error: Run ID is required.'));
        process.exit(1);
    }
    
    try {
        const run = await getLoggedClientOrThrow().run(runId).resurrect();

        if (options?.json) {
            console.log(JSON.stringify({ data: run }, null, 2));
            return;
        }

        console.log(chalk.green(`✓ Run ${runId} resurrected successfully`));
        console.log(chalk.gray(`  New status: ${run.status}`));
    } catch (err) {
        console.error(chalk.red('Error: Failed to resurrect run.'));
        console.error(chalk.gray(`Details: ${terminalSafeError(err)}`));
        process.exit(1);
    }
}

/**
 * runs rm - Delete a run
 */
export async function runRmCommand(runId: string, options?: { yes?: boolean }): Promise<void> {
    if (!runId) {
        console.error(chalk.red('Error: Run ID is required.'));
        process.exit(1);
    }
    
    // Confirm deletion unless --yes flag is set
    if (!options?.yes) {
        const { confirm } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'confirm',
                message: `Are you sure you want to delete run "${runId}"?`,
                default: false,
            },
        ]);

        if (!confirm) {
            console.log(chalk.gray('Cancelled.'));
            return;
        }
    }

    try {
        await getLoggedClientOrThrow().run(runId).delete();
        console.log(chalk.green(`✓ Run ${runId} deleted successfully`));
    } catch (err) {
        console.error(chalk.red('Error: Failed to delete run.'));
        console.error(chalk.gray(`Details: ${terminalSafeError(err)}`));
        process.exit(1);
    }
}

/**
 * Set up the runs command with subcommands
 */
export function setupRunsCommand(program: Command): void {
    const runsCmd = program
        .command('runs')
        .description('Manage actor runs (ls, info, log, abort, wait, resurrect, rm)');
    
    runsCmd
        .command('ls [actorId]')
        .description('List runs (defaults to the actor in the current directory)')
        .option('--limit <number>', 'Maximum number of runs to return', parseInt)
        .option('--offset <number>', 'Number of runs to skip', parseInt)
        .option('--desc', 'Sort in descending order')
        .option('-c, --compact', 'Display compact output')
        .option('--json', 'Format output as JSON')
        .action((actorId, options) => {
            let resolved = actorId;
            if (!resolved) {
                // default to the actor in the current directory.
                const actorConfig = getActorConfig(process.cwd());
                resolved = actorConfig?.actorId || actorConfig?.name;
            }
            listRunsCommand({ ...options, actorId: resolved });
        });
    
    runsCmd
        .command('info <runId>')
        .description('Get run info')
        .option('-v, --verbose', 'Show more details')
        .option('--json', 'Format output as JSON')
        .action((runId, options) => runInfoCommand(runId, options));
    
    runsCmd
        .command('log <runId>')
        .description('Get run log')
        .action((runId) => runLogCommand(runId));
    
    runsCmd
        .command('abort <runId>')
        .description('Abort a run')
        .option('-f, --force', 'Force immediate abort (not graceful)')
        .option('--json', 'Format output as JSON')
        .action((runId, options) => runAbortCommand(runId, options));
    
    runsCmd
        .command('wait <runId>')
        .description('Wait for run to complete')
        .option('-t, --timeout <seconds>', 'Timeout in seconds (0 = no timeout)', parseInt)
        .option('--poll-interval <seconds>', 'Poll interval in seconds', parseInt)
        .option('--json', 'Format output as JSON')
        .action((runId, options) => runWaitCommand(runId, options));
    
    runsCmd
        .command('resurrect <runId>')
        .description('Resurrect an aborted or finished run')
        .option('--json', 'Format output as JSON')
        .action((runId, options) => runResurrectCommand(runId, options));
    
    runsCmd
        .command('rm <runId>')
        .description('Delete a run')
        .option('-y, --yes', 'Skip confirmation prompt')
        .action((runId, options) => runRmCommand(runId, options));
}
