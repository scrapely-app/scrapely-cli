#!/usr/bin/env node

import chalk from 'chalk';
import { Command } from 'commander';
import { getToken, getCredentials } from '../config.js';

/**
 * auth token - Print the current API token
 */
export async function authTokenCommand(): Promise<void> {
    const token = getToken();
    
    if (!token) {
        console.error(chalk.red('Error: Not logged in. Run `scrapely login` first.'));
        process.exit(1);
    }
    
    console.log(token);
}

/**
 * auth login - Alias for login command (handled separately)
 */
export async function authLoginCommand(options?: { method?: 'console' | 'manual'; token?: string }): Promise<void> {
    // Alias for the main login command — forwards all options
    const { loginCommand } = await import('./login.js');
    await loginCommand(options);
}

/**
 * auth logout - Alias for logout command
 */
export async function authLogoutCommand(): Promise<void> {
    const { logoutCommand } = await import('./logout.js');
    await logoutCommand();
}

/**
 * Set up the auth command with subcommands
 */
export function setupAuthCommand(program: Command): void {
    const authCmd = program
        .command('auth')
        .description('Manage authentication (login, logout, token)');
    
    authCmd
        .command('login')
        .description('Log in to Scrapely')
        .option('-m, --method <method>', 'Login method (browser, console or manual)')
        .option('-t, --token <token>', 'API token for manual login')
        .action((options) => authLoginCommand(options));
    
    authCmd
        .command('logout')
        .description('Log out from Scrapely')
        .action(authLogoutCommand);
    
    authCmd
        .command('token')
        .description('Print the current API token')
        .action(authTokenCommand);
}