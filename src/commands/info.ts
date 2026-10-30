import chalk from 'chalk';
import { getCredentials, getApiBaseUrl, getToken, saveCredentials } from '../config.js';
import { getLoggedClientOrThrow } from '../client.js';
import { terminalSafeError } from '../utils/terminal.js';

/** HTTP status of a failed API call, if the server answered at all. */
function errorStatus(err: unknown): number | undefined {
    const status = (err as { statusCode?: unknown })?.statusCode;
    return typeof status === 'number' ? status : undefined;
}

/**
 * info - Print details about the currently authenticated account.
 *
 * Fetches live account data from the API (`user().get()`).
 * - Token rejected (401/403): says so and exits 1. The account saved at
 *   login is not shown: it may belong to a different token.
 * - Any other HTTP error: prints it and exits 1.
 * - API unreachable (no HTTP response): falls back to the account saved at
 *   login, with a warning that it may be stale, when that saved login uses
 *   the same token; otherwise exits 1.
 */
export async function infoCommand(): Promise<void> {
    // Exits with the friendly "not logged in" message when unauthenticated.
    // Few retries: when the API is unreachable, fall back after seconds, not minutes.
    const client = getLoggedClientOrThrow({ maxRetries: 2 });
    const creds = getCredentials();
    const apiUrl = getApiBaseUrl();
    const tokenFromEnv = Boolean(process.env.SCRAPELY_TOKEN);

    let user: { id?: string; email?: string; username?: string; plan?: string | { id?: string } } | undefined;

    try {
        user = (await client.user().get()) as { id?: string; email?: string; username?: string; plan?: string | { id?: string } };
    } catch (err) {
        const status = errorStatus(err);
        const details = terminalSafeError(err);
        if (status === 401 || status === 403) {
            console.error(chalk.red(`Error: The API at ${apiUrl} rejected the token (HTTP ${status}).`));
            console.error(chalk.gray(tokenFromEnv
                ? 'The token comes from SCRAPELY_TOKEN. Check its value, or unset it to use the saved login.'
                : 'Run `scrapely login` to log in again.'));
            console.error(chalk.gray(`Details: ${details}`));
            process.exit(1);
        }
        if (status !== undefined) {
            console.error(chalk.red(`Error: Failed to fetch account info (HTTP ${status} from ${apiUrl}).`));
            console.error(chalk.gray(`Details: ${details}`));
            process.exit(1);
        }
        // No HTTP response at all: the API could not be reached. The saved
        // account only describes the token it was saved with.
        const sameToken = Boolean(creds?.token) && creds?.token === getToken();
        if (!creds?.user || !sameToken) {
            console.error(chalk.red(`Error: Could not reach the API at ${apiUrl}.`));
            console.error(chalk.gray(`Details: ${details}`));
            process.exit(1);
        }
        console.log(chalk.yellow(`Could not reach the API at ${apiUrl} — showing data saved at login time (may be stale):`));
        user = creds.user;
    }

    if (!user) {
        console.log(chalk.yellow('Not logged in.'));
        console.log(chalk.gray('\nRun `scrapely login` to authenticate.'));
        return;
    }

    // Keep the cached copy fresh for commands that read it offline.
    // Only when the saved login is the token in use: a SCRAPELY_TOKEN for
    // another account must not overwrite the saved account.
    if (creds?.token && creds.token === getToken() && user.username && user.email && user.id
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