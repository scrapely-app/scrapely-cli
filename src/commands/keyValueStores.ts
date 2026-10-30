#!/usr/bin/env node

import chalk from 'chalk';
import { Command } from 'commander';
import inquirer from 'inquirer';
import { getLoggedClientOrThrow } from '../client.js';
import { stdoutSafeText, terminalJson, terminalSafeError } from '../utils/terminal.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a key-value store name or ID to its ID.
 *
 * The upstream API accepts store names on every KVS route; this platform's KVS
 * routes require IDs, so names are resolved through the store listing first.
 */
async function resolveStoreId(nameOrId: string): Promise<string> {
    if (UUID_RE.test(nameOrId)) return nameOrId;
    const { items } = await getLoggedClientOrThrow().keyValueStores().list();
    const found = (items as Array<{ id: string; name?: string }>).find(i => i.name === nameOrId);
    if (!found) {
        throw new Error(`Key-value store "${nameOrId}" not found`);
    }
    return found.id;
}

/**
 * key-value-stores create - Create a new key-value store
 */
export async function createKvsCommand(name?: string, options?: { json?: boolean }): Promise<void> {
    try {
        // key-value store creation is getOrCreate semantics.
        const store = await getLoggedClientOrThrow().keyValueStores().getOrCreate(name);

        if (options?.json) {
            console.log(JSON.stringify(store, null, 2));
            return;
        }

        console.log(chalk.green(`✓ Key-value store created successfully`));
        console.log(chalk.gray(`  ID: ${store.id}`));
        if (store.name) {
            console.log(chalk.gray(`  Name: ${store.name}`));
        }
    } catch (err) {
        console.error(chalk.red('Error: Failed to create key-value store.'));
        console.error(chalk.gray(`Details: ${terminalSafeError(err)}`));
        process.exit(1);
    }
}

/**
 * key-value-stores rm - Delete a key-value store
 */
export async function removeKvsCommand(storeIdOrName: string, options?: { yes?: boolean }): Promise<void> {
    if (!storeIdOrName) {
        console.error(chalk.red('Error: Key-value store ID or name is required.'));
        process.exit(1);
    }

    // Confirm deletion unless --yes flag is set
    if (!options?.yes) {
        const { confirm } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'confirm',
                message: `Are you sure you want to delete key-value store "${storeIdOrName}"?`,
                default: false,
            },
        ]);
        
        if (!confirm) {
            console.log(chalk.gray('Cancelled.'));
            return;
        }
    }
    
    try {
        await getLoggedClientOrThrow().keyValueStore(await resolveStoreId(storeIdOrName)).delete();
        console.log(chalk.green(`✓ Key-value store ${storeIdOrName} deleted successfully`));
    } catch (err) {
        console.error(chalk.red('Error: Failed to delete key-value store.'));
        console.error(chalk.gray(`Details: ${terminalSafeError(err)}`));
        process.exit(1);
    }
}

/**
 * key-value-stores rename - Rename a key-value store
 */
export async function renameKvsCommand(storeIdOrName: string, newName?: string, options?: { unname?: boolean }): Promise<void> {
    if (!storeIdOrName) {
        console.error(chalk.red('Error: Key-value store ID or name is required.'));
        process.exit(1);
    }

    if (options?.unname) {
        try {
            await getLoggedClientOrThrow().keyValueStore(await resolveStoreId(storeIdOrName)).update({ name: null });
            console.log(chalk.green(`✓ Key-value store ${storeIdOrName} unnamed successfully`));
        } catch (err) {
            console.error(chalk.red('Error: Failed to unname key-value store.'));
            console.error(chalk.gray(`Details: ${terminalSafeError(err)}`));
            process.exit(1);
        }
        return;
    }

    if (!newName) {
        console.error(chalk.red('Error: New name is required (or use --unname to remove the name).'));
        process.exit(1);
    }

    try {
        await getLoggedClientOrThrow().keyValueStore(await resolveStoreId(storeIdOrName)).update({ name: newName });
        console.log(chalk.green(`✓ Key-value store renamed to "${newName}" successfully`));
    } catch (err) {
        console.error(chalk.red('Error: Failed to rename key-value store.'));
        console.error(chalk.gray(`Details: ${terminalSafeError(err)}`));
        process.exit(1);
    }
}

/**
 * key-value-stores delete-value - Delete a value from a key-value store
 */
export async function kvsDeleteValueCommand(storeId: string, key: string, options?: { yes?: boolean }): Promise<void> {
    if (!storeId || !key) {
        console.error(chalk.red('Error: Store ID and key are required.'));
        process.exit(1);
    }

    // Confirm deletion unless --yes flag is set
    if (!options?.yes) {
        const { confirm } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'confirm',
                message: `Are you sure you want to delete key "${key}" from store "${storeId}"?`,
                default: false,
            },
        ]);

        if (!confirm) {
            console.log(chalk.gray('Cancelled.'));
            return;
        }
    }

    try {
        await getLoggedClientOrThrow().keyValueStore(await resolveStoreId(storeId)).deleteRecord(key);
        console.log(chalk.green(`✓ Key '${key}' deleted successfully`));
    } catch (err) {
        console.error(chalk.red('Error: Failed to delete key from key-value store.'));
        console.error(chalk.gray(`Details: ${terminalSafeError(err)}`));
        process.exit(1);
    }
}

/**
 * key-value-stores get-value - Get a value from a key-value store
 */
export async function kvsGetValueCommand(storeId: string, key: string, options?: { onlyContentType?: boolean }): Promise<void> {
    if (!storeId || !key) {
        console.error(chalk.red('Error: Store ID and key are required.'));
        process.exit(1);
    }

    try {
        // buffer: true keeps binary payloads intact; JSON/text arrive parsed.
        const record = await getLoggedClientOrThrow().keyValueStore(await resolveStoreId(storeId)).getRecord(key, { buffer: true });

        if (!record) {
            console.error(chalk.red(`Error: Key '${key}' not found in key-value store.`));
            process.exit(1);
        }

        const contentType = record.contentType ?? '';

        // If --only-content-type flag, just print the content type
        if (options?.onlyContentType) {
            console.log(contentType || 'unknown');
            return;
        }

        if (Buffer.isBuffer(record.value)) {
            // On a terminal the payload is decoded and sanitized; piped or
            // redirected output keeps its exact bytes.
            process.stdout.write(process.stdout.isTTY ? stdoutSafeText(record.value.toString('utf-8')) : record.value);
            // Append a trailing newline for text-like payloads so the output
            // doesn't run together with the shell prompt; binary payloads are
            // written verbatim.
            const isTextual = contentType === '' || /^(text\/|application\/(json|xml|javascript|graphql|yaml|x-yaml|toml|csv))/i.test(contentType);
            if (isTextual && record.value.length > 0 && record.value[record.value.length - 1] !== 0x0a) {
                process.stdout.write('\n');
            }
        } else if (typeof record.value === 'string') {
            console.log(stdoutSafeText(record.value));
        } else {
            console.log(terminalJson(JSON.stringify(record.value, null, 2)));
        }
    } catch (err) {
        console.error(chalk.red('Error: Failed to get value from key-value store.'));
        console.error(chalk.gray(`Details: ${terminalSafeError(err)}`));
        process.exit(1);
    }
}

/**
 * key-value-stores set-value - Set a value in a key-value store
 */
export async function kvsSetValueCommand(storeId: string, key: string, value?: string, options?: { contentType?: string }): Promise<void> {
    if (!storeId || !key) {
        console.error(chalk.red('Error: Store ID and key are required.'));
        process.exit(1);
    }

    const kvs = getLoggedClientOrThrow().keyValueStore(await resolveStoreId(storeId));

    // If no value provided, delete the key
    if (value === undefined || value === '') {
        try {
            await kvs.deleteRecord(key);
            console.log(chalk.green(`✓ Key '${key}' deleted successfully`));
        } catch (err) {
            console.error(chalk.red('Error: Failed to delete key.'));
            console.error(chalk.gray(`Details: ${terminalSafeError(err)}`));
            process.exit(1);
        }
        return;
    }

    // Set the value
    const contentType = options?.contentType || 'application/json';

    // If content type is JSON, validate
    if (contentType.includes('application/json')) {
        try {
            JSON.parse(value);
        } catch {
            console.error(chalk.red('Error: Invalid JSON value.'));
            process.exit(1);
        }
    }

    try {
        await kvs.setRecord({ key, value, contentType });
        console.log(chalk.green(`✓ Value set for key '${key}'`));
    } catch (err) {
        console.error(chalk.red('Error: Failed to set value in key-value store.'));
        console.error(chalk.gray(`Details: ${terminalSafeError(err)}`));
        process.exit(1);
    }
}

/**
 * key-value-stores ls - List key-value stores
 */
export async function listKvsCommand(options?: { limit?: number; offset?: number; unnamed?: boolean; desc?: boolean; json?: boolean }): Promise<void> {
    try {
        const result = await getLoggedClientOrThrow().keyValueStores().list({
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
            console.log(chalk.bold('Key-Value Stores:'));
            for (const store of result.items as Array<{ id: string; name?: string }>) {
                const name = store.name || '(unnamed)';
                console.log(`  ${chalk.cyan(store.id)} ${chalk.gray(name)}`);
            }
        } else {
            console.log(chalk.gray('No key-value stores found.'));
        }
    } catch (err) {
        console.error(chalk.red('Error: Failed to list key-value stores.'));
        console.error(chalk.gray(`Details: ${terminalSafeError(err)}`));
        process.exit(1);
    }
}

/**
 * key-value-stores keys - List keys in a key-value store
 */
export async function listKvsKeysCommand(storeId: string, options?: { limit?: number; exclusiveStartKey?: string; json?: boolean }): Promise<void> {
    if (!storeId) {
        console.error(chalk.red('Error: Store ID is required.'));
        process.exit(1);
    }

    try {
        const result = await getLoggedClientOrThrow().keyValueStore(await resolveStoreId(storeId)).listKeys({
            ...(options?.limit !== undefined ? { limit: options.limit } : {}),
            ...(options?.exclusiveStartKey ? { exclusiveStartKey: options.exclusiveStartKey } : {}),
        });

        if (options?.json) {
            console.log(JSON.stringify(result, null, 2));
            return;
        }

        const items = (result.items ?? []) as Array<{ key: string; size?: number }>;
        if (items.length > 0) {
            console.log(chalk.bold('Keys:'));
            for (const item of items) {
                const size = item.size ? ` (${item.size} bytes)` : '';
                console.log(`  ${chalk.cyan(item.key)}${chalk.gray(size)}`);
            }
        } else {
            console.log(chalk.gray('No keys found.'));
        }
    } catch (err) {
        console.error(chalk.red('Error: Failed to list keys.'));
        console.error(chalk.gray(`Details: ${terminalSafeError(err)}`));
        process.exit(1);
    }
}

/**
 * key-value-stores info - Get key-value store info
 */
export async function kvsInfoCommand(storeId: string, options?: { json?: boolean }): Promise<void> {
    if (!storeId) {
        console.error(chalk.red('Error: Store ID is required.'));
        process.exit(1);
    }

    try {
        const store = (await getLoggedClientOrThrow().keyValueStore(await resolveStoreId(storeId)).get()) as
            | { id: string; name?: string; createdAt?: Date }
            | undefined;
        if (!store) {
            console.error(chalk.red(`Error: Key-value store "${storeId}" not found.`));
            process.exit(1);
        }

        if (options?.json) {
            console.log(JSON.stringify(store, null, 2));
            return;
        }

        console.log(chalk.bold('Key-Value Store Info:'));
        console.log(`  ID: ${chalk.cyan(store.id)}`);
        console.log(`  Name: ${store.name || '(unnamed)'}`);
        if (store.createdAt) {
            console.log(`  Created: ${store.createdAt}`);
        }
    } catch (err) {
        console.error(chalk.red('Error: Failed to get key-value store info.'));
        console.error(chalk.gray(`Details: ${terminalSafeError(err)}`));
        process.exit(1);
    }
}

/**
 * Set up the key-value-stores command with subcommands
 */
export function setupKeyValueStoresCommand(program: Command): void {
    const kvsCmd = program
        .command('key-value-stores')
        .alias('kvs')
        .description('Manage key-value stores (create, get-value, set-value, ls, keys, info, rm, rename, delete-value)');
    
    kvsCmd
        .command('create [name]')
        .description('Create a new key-value store')
        .option('--json', 'Format output as JSON')
        .action((name, options) => createKvsCommand(name, options));
    
    kvsCmd
        .command('get-value <storeId> <key>')
        .description('Get a value from a key-value store')
        .option('--only-content-type', 'Only return the content type of the value')
        .action((storeId, key, options) => kvsGetValueCommand(storeId, key, options));
    
    kvsCmd
        .command('set-value <storeId> <key> [value]')
        .description('Set a value in a key-value store')
        .option('-c, --content-type <type>', 'Content type of the value (default: application/json)')
        .action((storeId, key, value, options) => kvsSetValueCommand(storeId, key, value, options));
    
    kvsCmd
        .command('delete-value <storeId> <key>')
        .description('Delete a value from a key-value store')
        .option('-y, --yes', 'Skip confirmation prompt')
        .action((storeId, key, options) => kvsDeleteValueCommand(storeId, key, options));
    
    kvsCmd
        .command('ls')
        .description('List key-value stores')
        .option('--limit <number>', 'Maximum number of stores to return', parseInt)
        .option('--offset <number>', 'Number of stores to skip', parseInt)
        .option('--unnamed', 'List only unnamed stores')
        .option('--desc', 'Sort in descending order')
        .option('--json', 'Format output as JSON')
        .action((options) => listKvsCommand(options));
    
    kvsCmd
        .command('keys <storeId>')
        .description('List keys in a key-value store')
        .option('--limit <number>', 'Maximum number of keys to return', parseInt)
        .option('--exclusive-start-key <key>', 'Key to start listing from')
        .option('--json', 'Format output as JSON')
        .action((storeId, options) => listKvsKeysCommand(storeId, options));
    
    kvsCmd
        .command('info <storeId>')
        .description('Get key-value store info')
        .option('--json', 'Format output as JSON')
        .action((storeId, options) => kvsInfoCommand(storeId, options));
    
    kvsCmd
        .command('rm <storeIdOrName>')
        .description('Permanently delete a key-value store')
        .option('-y, --yes', 'Skip confirmation prompt')
        .action((storeIdOrName, options) => removeKvsCommand(storeIdOrName, options));
    
    kvsCmd
        .command('rename <storeIdOrName> [newName]')
        .description('Rename a key-value store or remove its name with --unname')
        .option('--unname', 'Remove the unique name of the key-value store')
        .action((storeIdOrName, newName, options) => renameKvsCommand(storeIdOrName, newName, options));
}
