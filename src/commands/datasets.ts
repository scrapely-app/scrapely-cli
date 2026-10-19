#!/usr/bin/env node

import chalk from 'chalk';
import { Command, Option } from 'commander';
import inquirer from 'inquirer';
import { getLoggedClientOrThrow } from '../client.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a dataset name or ID to its ID.
 *
 * The upstream API accepts dataset names on every route; this platform's dataset
 * routes require IDs, so names are resolved through the dataset listing first.
 */
async function resolveDatasetId(nameOrId: string): Promise<string> {
    if (UUID_RE.test(nameOrId)) return nameOrId;
    const { items } = await getLoggedClientOrThrow().datasets().list();
    const found = (items as Array<{ id: string; name?: string }>).find(i => i.name === nameOrId);
    if (!found) {
        throw new Error(`Dataset "${nameOrId}" not found`);
    }
    return found.id;
}

/**
 * datasets create - Create a new dataset
 */
export async function createDatasetCommand(name?: string, options?: { json?: boolean }): Promise<void> {
    try {
        // dataset creation is getOrCreate semantics.
        const dataset = await getLoggedClientOrThrow().datasets().getOrCreate(name);

        if (options?.json) {
            console.log(JSON.stringify(dataset, null, 2));
            return;
        }

        console.log(chalk.green(`✓ Dataset created successfully`));
        console.log(chalk.gray(`  ID: ${dataset.id}`));
        if (dataset.name) {
            console.log(chalk.gray(`  Name: ${dataset.name}`));
        }
    } catch (err) {
        console.error(chalk.red('Error: Failed to create dataset.'));
        console.error(chalk.gray(`Details: ${(err as Error).message}`));
        process.exit(1);
    }
}

/**
 * datasets rm - Delete a dataset
 */
export async function removeDatasetCommand(datasetIdOrName: string, options?: { yes?: boolean }): Promise<void> {
    if (!datasetIdOrName) {
        console.error(chalk.red('Error: Dataset ID or name is required.'));
        process.exit(1);
    }
    
    // Confirm deletion unless --yes flag is set
    if (!options?.yes) {
        const { confirm } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'confirm',
                message: `Are you sure you want to delete dataset "${datasetIdOrName}"?`,
                default: false,
            },
        ]);

        if (!confirm) {
            console.log(chalk.gray('Cancelled.'));
            return;
        }
    }

    try {
        await getLoggedClientOrThrow().dataset(await resolveDatasetId(datasetIdOrName)).delete();
        console.log(chalk.green(`✓ Dataset ${datasetIdOrName} deleted successfully`));
    } catch (err) {
        console.error(chalk.red('Error: Failed to delete dataset.'));
        console.error(chalk.gray(`Details: ${(err as Error).message}`));
        process.exit(1);
    }
}

/**
 * datasets rename - Rename a dataset
 */
export async function renameDatasetCommand(datasetIdOrName: string, newName?: string, options?: { unname?: boolean }): Promise<void> {
    if (!datasetIdOrName) {
        console.error(chalk.red('Error: Dataset ID or name is required.'));
        process.exit(1);
    }

    if (options?.unname) {
        try {
            await getLoggedClientOrThrow().dataset(await resolveDatasetId(datasetIdOrName)).update({ name: null });
            console.log(chalk.green(`✓ Dataset ${datasetIdOrName} unnamed successfully`));
        } catch (err) {
            console.error(chalk.red('Error: Failed to unname dataset.'));
            console.error(chalk.gray(`Details: ${(err as Error).message}`));
            process.exit(1);
        }
        return;
    }

    if (!newName) {
        console.error(chalk.red('Error: New name is required (or use --unname to remove the name).'));
        process.exit(1);
    }

    try {
        await getLoggedClientOrThrow().dataset(await resolveDatasetId(datasetIdOrName)).update({ name: newName });
        console.log(chalk.green(`✓ Dataset renamed to "${newName}" successfully`));
    } catch (err) {
        console.error(chalk.red('Error: Failed to rename dataset.'));
        console.error(chalk.gray(`Details: ${(err as Error).message}`));
        process.exit(1);
    }
}

/**
 * datasets get-items - Get items from a dataset
 * 
 * Retrieves items from a dataset in various formats.
 */
export async function getItemsCommand(datasetId: string, options?: { format?: string; limit?: number; offset?: number }): Promise<void> {
    if (!datasetId) {
        console.error(chalk.red('Error: Dataset ID is required.'));
        process.exit(1);
    }

    try {
        // Non-JSON formats are downloaded verbatim via the client's download API.
        const format = (options?.format ?? 'json') as Parameters<ReturnType<ReturnType<typeof getLoggedClientOrThrow>['dataset']>['downloadItems']>[0];
        const itemsOptions = {
            ...(options?.limit !== undefined ? { limit: options.limit } : {}),
            ...(options?.offset !== undefined ? { offset: options.offset } : {}),
        };

        let resultText: string;
        if (format === 'json') {
            const { items } = await getLoggedClientOrThrow().dataset(await resolveDatasetId(datasetId)).listItems(itemsOptions);
            resultText = JSON.stringify(items, null, 2);
        } else {
            const data = await getLoggedClientOrThrow().dataset(await resolveDatasetId(datasetId)).downloadItems(format, itemsOptions);
            resultText = Buffer.isBuffer(data) ? data.toString('utf-8') : String(data);
        }

        console.log(resultText);
    } catch (err) {
        console.error(chalk.red('Error: Failed to get dataset items.'));
        console.error(chalk.gray(`Details: ${(err as Error).message}`));
        process.exit(1);
    }
}

/**
 * datasets push-items - Push items to a dataset
 */
export async function pushItemsCommand(datasetId: string, item?: string): Promise<void> {
    if (!datasetId) {
        console.error(chalk.red('Error: Dataset ID is required.'));
        process.exit(1);
    }

    // If item not provided, read from stdin
    let itemData = item || '';

    if (!itemData) {
        // Read from stdin
        itemData = await new Promise<string>((resolve, reject) => {
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

    if (!itemData.trim()) {
        console.error(chalk.red('Error: No item data provided.'));
        process.exit(1);
    }

    // Validate JSON
    try {
        JSON.parse(itemData);
    } catch {
        console.error(chalk.red('Error: Invalid JSON item data.'));
        process.exit(1);
    }

    try {
        await getLoggedClientOrThrow().dataset(await resolveDatasetId(datasetId)).pushItems(itemData);
        console.log(chalk.green('✓ Items pushed successfully'));
    } catch (err) {
        console.error(chalk.red('Error: Failed to push items to dataset.'));
        console.error(chalk.gray(`Details: ${(err as Error).message}`));
        process.exit(1);
    }
}

/**
 * datasets ls - List datasets
 */
export async function listDatasetsCommand(options?: { limit?: number; offset?: number; unnamed?: boolean; desc?: boolean; json?: boolean }): Promise<void> {
    try {
        const result = await getLoggedClientOrThrow().datasets().list({
            ...(options?.limit !== undefined ? { limit: options.limit } : {}),
            ...(options?.offset !== undefined ? { offset: options.offset } : {}),
            ...(options?.unnamed !== undefined ? { unnamed: options.unnamed } : {}),
            ...(options?.desc !== undefined ? { desc: options.desc } : {}),
        });

        if (options?.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
        }

        if (result.items && result.items.length > 0) {
            console.log(chalk.bold('Datasets:'));
            for (const dataset of result.items as Array<{ id: string; name?: string; itemCount?: number }>) {
                const name = dataset.name || '(unnamed)';
                console.log(`  ${chalk.cyan(dataset.id)} ${chalk.gray(name)} (${dataset.itemCount || 0} items)`);
            }
        } else {
            console.log(chalk.gray('No datasets found.'));
        }
    } catch (err) {
        console.error(chalk.red('Error: Failed to list datasets.'));
        console.error(chalk.gray(`Details: ${(err as Error).message}`));
        process.exit(1);
    }
}

/**
 * datasets info - Get dataset info
 */
export async function datasetInfoCommand(datasetId: string, options?: { json?: boolean }): Promise<void> {
    if (!datasetId) {
        console.error(chalk.red('Error: Dataset ID is required.'));
        process.exit(1);
    }

    try {
        const dataset = (await getLoggedClientOrThrow().dataset(await resolveDatasetId(datasetId)).get()) as
            | { id: string; name?: string; itemCount?: number; createdAt?: Date }
            | undefined;
        if (!dataset) {
            console.error(chalk.red(`Error: Dataset "${datasetId}" not found.`));
            process.exit(1);
        }

        if (options?.json) {
            console.log(JSON.stringify(dataset, null, 2));
            return;
        }

        console.log(chalk.bold('Dataset Info:'));
        console.log(`  ID: ${chalk.cyan(dataset.id)}`);
        console.log(`  Name: ${dataset.name || '(unnamed)'}`);
        console.log(`  Items: ${dataset.itemCount || 0}`);
        if (dataset.createdAt) {
            console.log(`  Created: ${dataset.createdAt}`);
        }
    } catch (err) {
        console.error(chalk.red('Error: Failed to get dataset info.'));
        console.error(chalk.gray(`Details: ${(err as Error).message}`));
        process.exit(1);
    }
}

/**
 * Set up the datasets command with subcommands
 */
export function setupDatasetsCommand(program: Command): void {
    const datasetsCmd = program
        .command('datasets')
        .description('Manage datasets (create, get-items, push-items, ls, info, rm, rename)');
    
    datasetsCmd
        .command('create [name]')
        .description('Create a new dataset')
        .option('--json', 'Format output as JSON')
        .action((name, options) => createDatasetCommand(name, options));
    
    datasetsCmd
        .command('get-items <datasetId>')
        .description('Get items from a dataset')
        .addOption(new Option('--format <format>', 'Output format (json, jsonl, csv, html, rss, xml, xlsx)')
            .choices(['json', 'jsonl', 'csv', 'html', 'rss', 'xml', 'xlsx'])
            .default('json'))
        .option('--limit <number>', 'Maximum number of items to return', parseInt)
        .option('--offset <number>', 'Number of items to skip', parseInt)
        .action((datasetId, options) => getItemsCommand(datasetId, options));
    
    datasetsCmd
        .command('push-items <datasetId> [item]')
        .description('Push items to a dataset (reads from stdin if item not provided)')
        .action((datasetId, item) => pushItemsCommand(datasetId, item));
    
    datasetsCmd
        .command('ls')
        .description('List datasets')
        .option('--limit <number>', 'Maximum number of datasets to return', parseInt)
        .option('--offset <number>', 'Number of datasets to skip', parseInt)
        .option('--unnamed', 'List only unnamed datasets')
        .option('--desc', 'Sort in descending order')
        .option('--json', 'Format output as JSON')
        .action((options) => listDatasetsCommand(options));
    
    datasetsCmd
        .command('info <datasetId>')
        .description('Get dataset info')
        .option('--json', 'Format output as JSON')
        .action((datasetId, options) => datasetInfoCommand(datasetId, options));
    
    datasetsCmd
        .command('rm <datasetIdOrName>')
        .description('Permanently delete a dataset')
        .option('-y, --yes', 'Skip confirmation prompt')
        .action((datasetIdOrName, options) => removeDatasetCommand(datasetIdOrName, options));
    
    datasetsCmd
        .command('rename <datasetIdOrName> [newName]')
        .description('Rename a dataset or remove its name with --unname')
        .option('--unname', 'Remove the unique name of the dataset')
        .action((datasetIdOrName, newName, options) => renameDatasetCommand(datasetIdOrName, newName, options));
}
