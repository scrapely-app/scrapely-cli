import chalk from 'chalk';
import { clearCredentials, getCredentials } from '../config.js';

export async function logoutCommand(): Promise<void> {
    // Clear whenever a token is stored — token-only credentials (no cached
    // user block) must be removed too, or a stale token lingers on disk.
    const existingCreds = getCredentials();
    if (!existingCreds?.token) {
        console.log(chalk.yellow('Not logged in.'));
        return;
    }

    clearCredentials();
    console.log(chalk.green('✓ Logged out successfully.'));
}