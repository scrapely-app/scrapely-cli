#!/usr/bin/env node

import chalk from 'chalk';
import { Command } from 'commander';
import { getWebBaseUrl } from '../config.js';
import { getLoggedClientOrThrow } from '../client.js';
import { resolveRemoteInput } from '../utils/inputResolution.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a task name or ID to its ID.
 *
 * The upstream API accepts task names on every route; this platform's task routes
 * require IDs, so names are resolved through the task listing first.
 */
async function resolveTaskId(nameOrId: string): Promise<string> {
    if (UUID_RE.test(nameOrId)) return nameOrId;
    const { items } = await getLoggedClientOrThrow().tasks().list();
    const found = (items as Array<{ id: string; name?: string }>).find(i => i.name === nameOrId);
    if (!found) {
        throw new Error(`Task "${nameOrId}" not found`);
    }
    return found.id;
}

/**
 * task run - Execute a predefined actor task
 */
export async function taskRunCommand(taskId: string, options?: { build?: string; memory?: number; timeout?: number; json?: boolean }): Promise<void> {
    if (!taskId) {
        console.error(chalk.red('Error: Task ID is required.'));
        console.log(chalk.gray('Usage: scrapely task run <taskId>'));
        process.exit(1);
    }

    // Input comes from the local default key-value store INPUT.json
    // (no --input/--input-file flags)
    const input = await resolveRemoteInput({}, !!options?.json);

    try {
        console.log(chalk.gray(`Starting task ${taskId}...`));

        const run = await getLoggedClientOrThrow().task(await resolveTaskId(taskId)).start(
            (input ?? undefined) as Record<string, unknown> | undefined,
            {
                ...(options?.build !== undefined ? { build: options.build } : {}),
                ...(options?.memory !== undefined ? { memory: options.memory } : {}),
                ...(options?.timeout !== undefined ? { timeout: options.timeout } : {}),
            },
        );

        if (options?.json) {
            console.log(JSON.stringify({ data: run }, null, 2));
            return;
        }

        console.log(chalk.green(`✓ Task run started: ${run.id}`));
        console.log(chalk.gray(`  Status: ${run.status}`));
        if (run.defaultDatasetId) {
            console.log(chalk.gray(`  Dataset ID: ${run.defaultDatasetId}`));
        }
    } catch (err) {
        console.error(chalk.red('Error: Failed to run task.'));
        console.error(chalk.gray(`Details: ${(err as Error).message}`));
        process.exit(1);
    }
}

/**
 * task publish - Publish a task as a public example (SEO landing page)
 */
export async function taskPublishCommand(taskId: string): Promise<void> {
    if (!taskId) {
        console.error(chalk.red('Error: Task ID is required.'));
        console.log(chalk.gray('Usage: scrapely task publish <taskId>'));
        process.exit(1);
    }

    try {
        const client = getLoggedClientOrThrow();
        const task = await client.task(await resolveTaskId(taskId)).publish({});

        console.log(chalk.green(`✓ Task ${taskId} published`));
        {
            const webBaseUrl = getWebBaseUrl();
            const published = task as { publicSlug?: string; publishedAt?: string; actId?: string };
            console.log(chalk.gray(`  Slug: ${published.publicSlug}`));
            if (published.publishedAt) console.log(chalk.gray(`  Published at: ${published.publishedAt}`));
            console.log(chalk.gray(`  Landing page: ${webBaseUrl}/${published.actId}/examples/${published.publicSlug}`));
            console.log(chalk.gray(`  Markdown version: ${client.baseUrl}/acts/${published.actId}/examples/${published.publicSlug}.md`));
        }
    } catch (err) {
        console.error(chalk.red('Error: Failed to publish task.'));
        console.error(chalk.gray(`Details: ${(err as Error).message}`));
        process.exit(1);
    }
}

/**
 * task unpublish - Unpublish a task (SEO fields are kept for later republish)
 */
export async function taskUnpublishCommand(taskId: string): Promise<void> {
    if (!taskId) {
        console.error(chalk.red('Error: Task ID is required.'));
        console.log(chalk.gray('Usage: scrapely task unpublish <taskId>'));
        process.exit(1);
    }

    try {
        await getLoggedClientOrThrow().task(await resolveTaskId(taskId)).unpublish();

        console.log(chalk.green(`✓ Task ${taskId} unpublished`));
        console.log(chalk.gray('  SEO settings were kept — republish anytime with scrapely task publish'));
    } catch (err) {
        console.error(chalk.red('Error: Failed to unpublish task.'));
        console.error(chalk.gray(`Details: ${(err as Error).message}`));
        process.exit(1);
    }
}

/**
 * Set up the task command with subcommands
 *
 * only run, publish, and unpublish. Create and manage
 * tasks in the Scrapely dashboard.
 */
export function setupTaskCommand(program: Command): void {
    const taskCmd = program
        .command('task')
        .description('Run and publish saved Scrapely tasks (named actor configurations). Create and manage tasks in the Scrapely dashboard.');

    taskCmd
        .command('run <taskId>')
        .description('Execute a predefined actor task remotely using your authenticated account')
        .option('-b, --build <tag>', 'Tag or number of the build to run (e.g., "latest" or "1.2.34"; your own actors only)')
        .option('-m, --memory <mb>', 'Amount of memory allocated for the Task run, in megabytes', parseInt)
        .option('-t, --timeout <seconds>', 'Timeout for the Task run in seconds. Zero value means there is no timeout.', parseInt)
        .option('--json', 'Format the command output as JSON')
        .action((taskId, options) => taskRunCommand(taskId, options));

    taskCmd
        .command('publish <taskId>')
        .description('Publish the task on its public landing page')
        .action((taskId) => taskPublishCommand(taskId));

    taskCmd
        .command('unpublish <taskId>')
        .description('Unpublish the task from its public landing page')
        .action((taskId) => taskUnpublishCommand(taskId));
}
