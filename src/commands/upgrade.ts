#!/usr/bin/env node

import chalk from 'chalk';
import { Command } from 'commander';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { PACKAGE_NAMES } from '../packageNames.js';

const execFileAsync = promisify(execFile);

/**
 * Valid version specifiers for `scrapely upgrade --version`: a semver string
 * (optionally prefixed with "v", with prerelease/build suffixes) or "latest".
 * SECURITY: anything else — including shell metacharacter payloads — is
 * rejected before the value can reach npm.
 */
const VERSION_SPECIFIER_PATTERN = /^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

export function isValidVersionSpecifier(value: string): boolean {
    return value === 'latest' || VERSION_SPECIFIER_PATTERN.test(value);
}

/**
 * Get the current CLI version from package.json
 */
function getCurrentVersion(): string {
    try {
        // dist/commands -> package root is ../.. ; src/commands -> package root is ..
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const candidates = [
            join(__dirname, '..', '..', 'package.json'), // dist/commands/upgrade.js
            join(__dirname, '..', 'package.json'),       // src/commands/upgrade.ts via tsx
        ];
        for (const packageJsonPath of candidates) {
            try {
                const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
                if (packageJson.version) {
                    return packageJson.version;
                }
            } catch {
                // try next
            }
        }
        return '0.0.0';
    } catch {
        return '0.0.0';
    }
}

/**
 * Check for the latest version on npm
 */
async function getLatestVersion(): Promise<string | null> {
    const candidates = [PACKAGE_NAMES.cli, PACKAGE_NAMES.cliUnscoped];
    for (const pkg of candidates) {
        try {
            const { stdout } = await execFileAsync('npm', ['view', pkg, 'version'], {
                timeout: 10000
            });
            return stdout.trim();
        } catch {
            // try next package name
        }
    }
    return null;
}

/**
 * Compare two semantic versions
 * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareVersions(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 > p2) return 1;
        if (p1 < p2) return -1;
    }
    return 0;
}

/**
 * upgrade command - Check and update CLI to latest version
 */
export async function upgradeCommand(options?: { force?: boolean; version?: string }): Promise<void> {
    const currentVersion = getCurrentVersion();
    
    console.log(chalk.gray(`Current version: ${currentVersion}`));
    
    // If a specific version is requested
    if (options?.version) {
        // SECURITY: validate the user-supplied version before passing it to npm.
        if (!isValidVersionSpecifier(options.version)) {
            console.error(chalk.red('Error: --version must be a valid version (e.g. 1.2.3, v1.2.3-beta.1) or "latest".'));
            process.exit(1);
        }
        console.log(chalk.gray(`Installing version ${options.version}...`));
        const candidates = [PACKAGE_NAMES.cli, PACKAGE_NAMES.cliUnscoped];
        let lastErr: unknown;
        for (const pkg of candidates) {
            try {
                // SECURITY: execFile with an argument array — the version is
                // never interpolated into a shell command string.
                await execFileAsync('npm', ['install', '-g', `${pkg}@${options.version}`], {
                    timeout: 60000
                });
                console.log(chalk.green(`✓ Installed ${pkg}@${options.version}`));
                return;
            } catch (err) {
                lastErr = err;
            }
        }
        console.error(chalk.red('Error: Failed to install specified version.'));
        console.error(chalk.gray(`Details: ${(lastErr as Error).message}`));
        process.exit(1);
    }
    
    // Check for latest version
    console.log(chalk.gray('Checking for updates...'));
    
    const latestVersion = await getLatestVersion();
    
    if (!latestVersion) {
        console.error(chalk.red('Error: Could not check for updates. Please check your internet connection.'));
        process.exit(1);
    }
    
    console.log(chalk.gray(`Latest version: ${latestVersion}`));
    
    // Compare versions
    const comparison = compareVersions(currentVersion, latestVersion);
    
    if (comparison >= 0 && !options?.force) {
        console.log(chalk.green('✓ You are already on the latest version.'));
        return;
    }
    
    // Install update
    console.log(chalk.gray('Updating...'));
    
    const candidates = [PACKAGE_NAMES.cli, PACKAGE_NAMES.cliUnscoped];
    let lastErr: unknown;
    for (const pkg of candidates) {
        try {
            await execFileAsync('npm', ['install', '-g', `${pkg}@latest`], {
                timeout: 60000
            });
            console.log(chalk.green(`✓ Updated to ${pkg}@${latestVersion}`));
            return;
        } catch (err) {
            lastErr = err;
        }
    }
    console.error(chalk.red('Error: Failed to update. Try running with sudo or check npm permissions.'));
    console.error(chalk.gray(`Details: ${(lastErr as Error).message}`));
    process.exit(1);
}

/**
 * Set up the upgrade command
 */
export function setupUpgradeCommand(program: Command): void {
    program
        .command('upgrade')
        .description('Check that installed Scrapely CLI version is up to date')
        .option('-f, --force', 'Force update even if already on latest version')
        .option('--version <version>', 'Install a specific version')
        .action((options: { force?: boolean; version?: string }) => upgradeCommand(options));
}
