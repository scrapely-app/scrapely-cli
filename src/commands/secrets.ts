#!/usr/bin/env node

import chalk from 'chalk';
import { Command } from 'commander';
import inquirer from 'inquirer';
import { getSecrets, saveSecret, deleteSecret } from '../config.js';
import { terminalSafeError } from '../utils/terminal.js';

/**
 * Masked interactive prompt for a secret value (used when the value argument
 * is omitted, so secrets stay out of shell history and the process list).
 */
async function promptSecretValue(name: string): Promise<string> {
    const { promptedValue } = await inquirer.prompt([
        {
            type: 'password',
            name: 'promptedValue',
            message: `Enter the value for secret "${name}"`,
            mask: '*',
            validate: (input: string) => input.length > 0 || 'Please enter a secret value',
        },
    ]);
    return String(promptedValue);
}

/**
 * secrets add - Add a new secret
 */
export async function secretsAddCommand(name: string, value?: string): Promise<void> {
    if (!name) {
        console.error(chalk.red('Error: Secret name is required.'));
        process.exit(1);
    }
    
    // Prompt for the value when it is not supplied so the secret never lands
    // in shell history or the process list.
    const secretValue = value === undefined || value === ''
        ? await promptSecretValue(name)
        : value;
    
    // Validate name format
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
        console.error(chalk.red('Error: Secret name can only contain letters, numbers, underscores, and hyphens.'));
        process.exit(1);
    }
    
    try {
        saveSecret(name, secretValue);
        console.log(chalk.green(`✓ Secret "${name}" added successfully`));
    } catch (err) {
        console.error(chalk.red('Error: Failed to save secret.'));
        console.error(chalk.gray(`Details: ${terminalSafeError(err)}`));
        process.exit(1);
    }
}

/**
 * secrets ls - List all secret names
 */
export async function secretsLsCommand(options?: { json?: boolean }): Promise<void> {
    const secrets = getSecrets();
    const secretNames = Object.keys(secrets);
    
    if (options?.json) {
        console.log(JSON.stringify({ secrets: secretNames }, null, 2));
        return;
    }
    
    if (secretNames.length === 0) {
        console.log(chalk.gray('No secrets found.'));
        console.log(chalk.gray('\nUse `scrapely secrets add <name> <value>` to add a secret.'));
        return;
    }
    
    console.log(chalk.bold('Secrets:'));
    for (const name of secretNames) {
        const secret = secrets[name];
        console.log(`  ${chalk.cyan(name)} ${chalk.gray(`(created: ${secret.createdAt})`)}`);
    }
    console.log(chalk.gray('\nNote: Secret values are never displayed. Use them in the environmentVariables of your actor config with @name prefix.'));
}

/**
 * secrets rm - Remove a secret
 *
 * The upstream CLI deletes immediately without a
 * confirmation prompt and without a `-y` flag, so neither does this command.
 */
export async function secretsRmCommand(name: string): Promise<void> {
    if (!name) {
        console.error(chalk.red('Error: Secret name is required.'));
        process.exit(1);
    }
    
    const secrets = getSecrets();
    
    if (!secrets[name]) {
        console.error(chalk.red(`Error: Secret "${name}" not found.`));
        process.exit(1);
    }

    const deleted = deleteSecret(name);
    
    if (deleted) {
        console.log(chalk.green(`✓ Secret "${name}" removed successfully`));
    } else {
        console.error(chalk.red(`Error: Failed to remove secret "${name}".`));
        process.exit(1);
    }
}

/**
 * Set up the secrets command with subcommands
 */
export function setupSecretsCommand(program: Command): void {
    const secretsCmd = program
        .command('secrets')
        .description('Manage locally stored secrets for environment variables');
    
    secretsCmd
        .command('add <name> [value]')
        .description('Add a new secret for use in actor environment variables (prompts for the value when omitted, so it stays out of shell history)')
        .action((name, value) => secretsAddCommand(name, value));
    
    secretsCmd
        .command('ls')
        .description('List all secret names (values are never shown)')
        .option('--json', 'Format output as JSON')
        .action((options) => secretsLsCommand(options));
    
    secretsCmd
        .command('rm <name>')
        .description('Remove a secret')
        .action((name) => secretsRmCommand(name));
}