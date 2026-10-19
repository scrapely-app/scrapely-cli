import chalk from 'chalk';
import { getCredentials, getApiBaseUrl, saveCredentials } from '../config.js';
import { getLoggedClientOrThrow } from '../client.js';

/**
 * info - Print details about the currently authenticated account.
 *
 * fetches live account data from the API (`user().get()`),
 * falling back to the credentials cached at login time when the API is
 * unreachable (with a warning that the data may be stale).
 */
export async function infoCommand(): Promise<void> {
    // Exits with the friendly "not logged in" message when unauthenticated.
    const client = getLoggedClientOrThrow();
    const creds = getCredentials();
    const apiUrl = getApiBaseUrl();

    let user: { id?: string; email?: string; username?: string; plan?: string | { id?: string } } | undefined;

    try {
        user = (await client.user().get()) as { id?: string; email?: string; username?: string; plan?: string | { id?: string } };
    } catch (err) {
        if (!creds?.user) {
            console.error(chalk.red('Error: Failed to fetch account info.'));
            console.error(chalk.gray(`Details: ${(err as Error).message}`));
            process.exit(1);
        }
        console.log(chalk.yellow('Could not reach the API — showing data saved at login time (may be stale):'));
        user = creds.user;
    }

    if (!user) {
        console.log(chalk.yellow('Not logged in.'));
        console.log(chalk.gray('\nRun `scrapely login` to authenticate.'));
        return;
    }

    // Keep the cached copy fresh for commands that read it offline.
    if (creds?.token && user.username && user.email && user.id
        && (creds.user?.username !== user.username || creds.user?.email !== user.email || creds.user?.id !== user.id)) {
        saveCredentials({
            token: creds.token,
            apiBaseUrl: creds.apiBaseUrl,
            user: { id: user.id, email: user.email, username: user.username },
        });
    }

    console.log(chalk.green(`Logged in as: ${user.username}`));
    if (user.email) console.log(chalk.gray(`  Email: ${user.email}`));
    if (user.id) console.log(chalk.gray(`  User ID: ${user.id}`));
    if (user.plan) {
        const plan = typeof user.plan === 'string' ? user.plan : user.plan.id;
        if (plan) console.log(chalk.gray(`  Plan: ${plan}`));
    }
    console.log(chalk.gray(`  API URL: ${apiUrl}`));
}