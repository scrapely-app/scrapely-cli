#!/usr/bin/env node
// Portions derived from apify-cli (Copyright Apify Technologies s.r.o., Apache-2.0).
// Modified by TeraShift GmbH. See the LICENSE and NOTICE files.

import chalk from 'chalk';
import { Command } from 'commander';
import inquirer from 'inquirer';
import { getLocalConfig, getActorConfig } from '../config.js';
import { getLoggedClientOrThrow } from '../client.js';
import { stdoutSafeText, terminalJson, terminalSafeError } from '../utils/terminal.js';

/**
 * builds add-tag - Add a tag to a build
 */
export async function buildAddTagCommand(options: { build: string; tag: string }): Promise<void> {
    if (!options.build || !options.tag) {
        console.error(chalk.red('Error: Build ID and tag are required.'));
        console.error(chalk.gray('Usage: scrapely builds add-tag -b <buildId> -t <tag>'));
        process.exit(1);
    }

    const client = getLoggedClientOrThrow();

    try {
        const build = await client.build(options.build).get();

        if (!build) {
            console.error(chalk.red(`Error: Build with ID "${options.build}" was not found on your account.`));
            process.exit(1);
        }

        if (build.status !== 'SUCCEEDED') {
            console.error(chalk.red(`Error: Build with ID "${options.build}" has status "${build.status}". Only successful builds can be tagged.`));
            process.exit(1);
        }

        const actor = await client.actor(build.actId).get();

        if (!actor) {
            console.error(chalk.red(`Error: Actor with ID "${build.actId}" was not found.`));
            process.exit(1);
        }

        // Check if this tag already points to the same build
        const existingTaggedBuilds = (actor.taggedBuilds ?? {}) as Record<string, { buildId?: string; buildNumber?: string }>;
        const existingTagData = existingTaggedBuilds[options.tag];

        if (existingTagData?.buildId === options.build) {
            console.log(chalk.yellow(`Build "${options.build}" is already tagged as "${options.tag}".`));
            return;
        }

        // Build tags live on the Actor (platform convention): update
        // only the specific tag instead of calling a build-scoped endpoint.
        await client.actor(build.actId).update({
            taggedBuilds: {
                [options.tag]: { buildId: build.id },
            },
        } as never);

        const previousBuildInfo = existingTagData?.buildNumber
            ? ` (previously pointed to build ${existingTagData.buildNumber})`
            : '';
        console.log(chalk.green(`✓ Tag "${options.tag}" added to build ${options.build}${previousBuildInfo}`));
    } catch (err) {
        console.error(chalk.red(`Error: Failed to add tag "${options.tag}" to build "${options.build}".`));
        console.error(chalk.gray(`Details: ${terminalSafeError(err)}`));
        process.exit(1);
    }
}

/**
 * builds remove-tag - Remove a tag from a build
 */
export async function buildRemoveTagCommand(options: { build: string; tag: string; yes?: boolean }): Promise<void> {
    if (!options.build || !options.tag) {
        console.error(chalk.red('Error: Build ID and tag are required.'));
        console.error(chalk.gray('Usage: scrapely builds remove-tag -b <buildId> -t <tag>'));
        process.exit(1);
    }

    const client = getLoggedClientOrThrow();

    try {
        const build = await client.build(options.build).get();

        if (!build) {
            console.error(chalk.red(`Error: Build with ID "${options.build}" was not found on your account.`));
            process.exit(1);
        }

        const actor = await client.actor(build.actId).get();

        if (!actor) {
            console.error(chalk.red(`Error: Actor with ID "${build.actId}" was not found.`));
            process.exit(1);
        }

        const existingTaggedBuilds = (actor.taggedBuilds ?? {}) as Record<string, { buildId?: string; buildNumber?: string }>;
        const existingTagData = existingTaggedBuilds[options.tag];

        // Check if the tag exists
        if (!existingTagData) {
            console.error(chalk.red(`Error: Tag "${options.tag}" does not exist on Actor "${actor.name}".`));
            process.exit(1);
        }

        // Check if the tag points to this build
        if (existingTagData.buildId !== options.build) {
            console.error(chalk.red(`Error: Tag "${options.tag}" is not associated with build "${options.build}". It points to build "${existingTagData.buildNumber}" (${existingTagData.buildId}).`));
            process.exit(1);
        }

        // Confirm removal unless --yes flag is set
        if (!options.yes) {
            const { confirm } = await inquirer.prompt([
                {
                    type: 'confirm',
                    name: 'confirm',
                    message: `Are you sure you want to remove tag "${options.tag}" from build "${options.build}"?`,
                    default: false,
                },
            ]);

            if (!confirm) {
                console.log(chalk.gray('Cancelled.'));
                return;
            }
        }

        // To remove a tag, set it to null (platform convention)
        await client.actor(build.actId).update({
            taggedBuilds: {
                [options.tag]: null,
            },
        } as never);

        console.log(chalk.green(`✓ Tag "${options.tag}" removed from build ${options.build}`));
    } catch (err) {
        console.error(chalk.red(`Error: Failed to remove tag "${options.tag}" from build "${options.build}".`));
        console.error(chalk.gray(`Details: ${terminalSafeError(err)}`));
        process.exit(1);
    }
}

/**
 * builds rm - Delete a build
 */
export async function buildRmCommand(buildId: string, options?: { yes?: boolean }): Promise<void> {
    if (!buildId) {
        console.error(chalk.red('Error: Build ID is required.'));
        process.exit(1);
    }

    // Confirm deletion unless --yes flag is set
    if (!options?.yes) {
        const { confirm } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'confirm',
                message: `Are you sure you want to delete build "${buildId}"?`,
                default: false,
            },
        ]);
        
        if (!confirm) {
            console.log(chalk.gray('Cancelled.'));
            return;
        }
    }
    
    try {
        await getLoggedClientOrThrow().build(buildId).delete();
        console.log(chalk.green(`✓ Build ${buildId} deleted successfully`));
    } catch (err) {
        console.error(chalk.red('Error: Failed to delete build.'));
        console.error(chalk.gray(`Details: ${terminalSafeError(err)}`));
        process.exit(1);
    }
}

/**
 * builds ls - List builds
 */
export async function listBuildsCommand(options?: { actorId?: string; limit?: number; offset?: number; desc?: boolean; compact?: boolean; json?: boolean }): Promise<void> {
    const client = getLoggedClientOrThrow();

    try {
        const listOptions = {
            ...(options?.limit !== undefined ? { limit: options.limit } : {}),
            ...(options?.offset !== undefined ? { offset: options.offset } : {}),
            ...(options?.desc !== undefined ? { desc: options.desc } : {}),
        };
        // listing an Actor's builds goes through the Actor sub-resource.
        const result = options?.actorId
            ? await client.actor(options.actorId).builds().list(listOptions)
            : await client.builds().list(listOptions);

        if (options?.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
        }

        const items = (result.items ?? []) as Array<{ id: string; status: string; buildNumber?: string; createdAt?: string }>;
        if (items.length > 0) {
            if (options?.compact) {
                // Compact: one line per build, IDs only
                for (const build of items) {
                    console.log(build.id);
                }
            } else {
                console.log(chalk.bold('Builds:'));
                for (const build of items) {
                    const status = build.status === 'SUCCEEDED' ? chalk.green(build.status) :
                                   build.status === 'FAILED' ? chalk.red(build.status) :
                                   build.status === 'RUNNING' ? chalk.blue(build.status) :
                                   chalk.yellow(build.status);
                    const buildNum = build.buildNumber ? ` (${build.buildNumber})` : '';
                    console.log(`  ${chalk.cyan(build.id)}${buildNum} [${status}]`);
                }
            }
        } else {
            console.log(chalk.gray('No builds found.'));
        }
    } catch (err) {
        console.error(chalk.red('Error: Failed to list builds.'));
        console.error(chalk.gray(`Details: ${terminalSafeError(err)}`));
        process.exit(1);
    }
}

/**
 * builds info - Get build info
 */
export async function buildInfoCommand(buildId: string, options?: { json?: boolean }): Promise<void> {
    if (!buildId) {
        console.error(chalk.red('Error: Build ID is required.'));
        process.exit(1);
    }

    try {
        const build = await getLoggedClientOrThrow().build(buildId).get();
        if (!build) {
            console.error(chalk.red(`Error: Build "${buildId}" not found.`));
            process.exit(1);
        }

        if (options?.json) {
            console.log(JSON.stringify(build, null, 2));
            return;
        }
        
        {
            const info = build as { id: string; status: string; buildNumber?: string; exitCode?: number; createdAt?: Date; finishedAt?: Date };
            console.log(chalk.bold('Build Info:'));
            console.log(`  ID: ${chalk.cyan(info.id)}`);
            if (info.buildNumber) {
                console.log(`  Build Number: ${info.buildNumber}`);
            }
            const status = info.status === 'SUCCEEDED' ? chalk.green(info.status) :
                           info.status === 'FAILED' ? chalk.red(info.status) :
                           info.status === 'RUNNING' ? chalk.blue(info.status) :
                           chalk.yellow(info.status);
            console.log(`  Status: ${status}`);
            if (info.exitCode !== undefined) {
                console.log(`  Exit Code: ${info.exitCode}`);
            }
            if (info.createdAt) {
                console.log(`  Started: ${info.createdAt}`);
            }
            if (info.finishedAt) {
                console.log(`  Finished: ${info.finishedAt}`);
            }
        }
    } catch (err) {
        console.error(chalk.red('Error: Failed to get build info.'));
        console.error(chalk.gray(`Details: ${terminalSafeError(err)}`));
        process.exit(1);
    }
}

/**
 * builds log - Get build log
 */
export async function buildLogCommand(buildId: string): Promise<void> {
    if (!buildId) {
        console.error(chalk.red('Error: Build ID is required.'));
        process.exit(1);
    }

    try {
        const log = await getLoggedClientOrThrow().build(buildId).log().get();
        console.log(typeof log === 'string' ? stdoutSafeText(log) : terminalJson(JSON.stringify(log)));
    } catch (err) {
        console.error(chalk.red('Error: Failed to get build log.'));
        console.error(chalk.gray(`Details: ${terminalSafeError(err)}`));
        process.exit(1);
    }
}

/**
 * builds wait - Wait for build to complete
 */
export async function buildWaitCommand(buildId: string, options?: { timeout?: number; pollInterval?: number; json?: boolean; quiet?: boolean }): Promise<string | null> {
    if (!buildId) {
        console.error(chalk.red('Error: Build ID is required.'));
        process.exit(1);
    }
    
    const timeout = options?.timeout || 0; // 0 = no timeout
    const pollInterval = options?.pollInterval || 2; // seconds
    const startTime = Date.now();
    // `quiet` is used when another command (e.g. `builds create`) drives the
    // wait and wants to render its own output; json implies quiet plus a JSON
    // status line of its own.
    const quiet = options?.quiet || options?.json;

    if (!quiet) {
        console.log(chalk.gray(`Waiting for build ${buildId}...`));
    }
    
    const getBuild = async () => {
        const build = await getLoggedClientOrThrow().build(buildId).get();
        if (!build) {
            throw new Error(`Failed to get build status: ${buildId} not found`);
        }
        return build as { status: string };
    };
    
    try {
        let build = await getBuild();
        
        while (build?.status === 'RUNNING' || build?.status === 'QUEUED') {
            if (timeout > 0 && (Date.now() - startTime) > timeout * 1000) {
                if (options?.json) {
                    console.log(JSON.stringify({ buildId, status: 'TIMEOUT' }, null, 2));
                }
                console.error(chalk.red(`Error: Timeout waiting for build after ${timeout}s`));
                process.exit(1);
            }
            
            await new Promise(resolve => setTimeout(resolve, pollInterval * 1000));
            build = await getBuild();
        }
        
        const finalStatus = build?.status || 'unknown';

        if (options?.json) {
            console.log(JSON.stringify({ buildId, status: finalStatus }, null, 2));
            if (finalStatus !== 'SUCCEEDED') process.exit(1);
            return finalStatus;
        }
        
        if (quiet) {
            // Caller renders the outcome itself (including the failure exit code).
            return finalStatus;
        }

        if (build?.status === 'SUCCEEDED') {
            console.log(chalk.green(`✓ Build ${buildId} succeeded`));
        } else {
            console.log(chalk.red(`✗ Build ${buildId} ${build?.status || 'unknown'}`));
            process.exit(1);
        }
        return finalStatus;
    } catch (err) {
        console.error(chalk.red('Error: Failed to wait for build.'));
        console.error(chalk.gray(`Details: ${terminalSafeError(err)}`));
        process.exit(1);
    }
}

/**
 * builds create - Create a new build
 */
export async function buildCreateCommand(options?: { actorId?: string; version?: string; tag?: string; wait?: boolean; log?: boolean; json?: boolean }): Promise<void> {
    // Determine actor ID
    let actorId = options?.actorId;
    let localConfig = null;
    if (!actorId) {
        // Try to read from scrapely.json or package.json in current directory
        localConfig = getLocalConfig(process.cwd());
        if (localConfig) {
            actorId = localConfig.actorId;
        }
    }

    if (!actorId) {
        console.error(chalk.red('Error: Actor ID is required. Pass it as an argument or run from an actor directory.'));
        process.exit(1);
    }

    // Determine version - from options or local config
    const version = options?.version || localConfig?.version || '0.0.1';

    try {
        const build = await getLoggedClientOrThrow().actor(actorId).build(version, {
            ...(options?.tag ? { tag: options.tag } : {}),
            useCache: false,
            waitForFinish: 0,
        });

        if (options?.json) {
            // --json: single machine-readable result (final status when --wait)
            let status = (build as { status?: string }).status ?? 'UNKNOWN';
            if (options?.wait) {
                status = (await buildWaitCommand(build.id, { pollInterval: 2, quiet: true })) ?? status;
            }
            console.log(JSON.stringify({ data: { ...build, status } }, null, 2));
            // Without --wait the build was only queued: creating it succeeded.
            // With --wait the exit code reflects the build outcome.
            if (options?.wait && status !== 'SUCCEEDED') process.exit(1);
            return;
        }

        console.log(chalk.green(`✓ Build created: ${build.id}`));

        if (options?.wait) {
            await buildWaitCommand(build.id, { pollInterval: 2 });
        }

        if (options?.log) {
            console.log(chalk.gray('\nBuild log:'));
            await buildLogCommand(build.id);
        }
    } catch (err) {
        console.error(chalk.red('Error: Failed to create build.'));
        console.error(chalk.gray(`Details: ${terminalSafeError(err)}`));
        process.exit(1);
    }
}

/**
 * Set up the builds command with subcommands
 */
export function setupBuildsCommand(program: Command): void {
    const buildsCmd = program
        .command('builds')
        .description('Manage actor builds (ls, info, log, wait, create, add-tag, remove-tag, rm)');
    
    buildsCmd
        .command('ls [actorId]')
        .description('List builds (defaults to the actor in the current directory)')
        .option('--limit <number>', 'Maximum number of builds to return', parseInt)
        .option('--offset <number>', 'Number of builds to skip', parseInt)
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
            listBuildsCommand({ ...options, actorId: resolved });
        });
    
    buildsCmd
        .command('info <buildId>')
        .description('Get build info')
        .option('--json', 'Format output as JSON')
        .action((buildId, options) => buildInfoCommand(buildId, options));
    
    buildsCmd
        .command('log <buildId>')
        .description('Get build log')
        .action((buildId) => buildLogCommand(buildId));
    
    buildsCmd
        .command('wait <buildId>')
        .description('Wait for build to complete')
        .option('-t, --timeout <seconds>', 'Timeout in seconds (0 = no timeout)', parseInt)
        .option('--poll-interval <seconds>', 'Poll interval in seconds', parseInt)
        .option('--json', 'Format output as JSON')
        .action(async (buildId, options) => {
            await buildWaitCommand(buildId, options);
        });
    
    buildsCmd
        .command('create [actorId]')
        .description('Create a new build')
        .option('--version <version>', 'Actor version to build')
        .option('--tag <tag>', 'Build tag')
        .option('--wait', 'Wait for build to complete')
        .option('--log', 'Print build log after completion')
        .option('--json', 'Format output as JSON')
        .action((actorId, options) => buildCreateCommand({ ...options, actorId }));
    
    buildsCmd
        .command('add-tag')
        .description('Add a tag to a build')
        .option('-b, --build <buildId>', 'Build ID')
        .option('-t, --tag <tag>', 'Tag to add')
        .action((options) => buildAddTagCommand(options));
    
    buildsCmd
        .command('remove-tag')
        .description('Remove a tag from a build')
        .option('-b, --build <buildId>', 'Build ID')
        .option('-t, --tag <tag>', 'Tag to remove')
        .option('-y, --yes', 'Skip confirmation prompt')
        .action((options) => buildRemoveTagCommand(options));
    
    buildsCmd
        .command('rm <buildId>')
        .description('Permanently delete a build')
        .option('-y, --yes', 'Skip confirmation prompt')
        .action((buildId, options) => buildRmCommand(buildId, options));
}
