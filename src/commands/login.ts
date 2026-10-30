import inquirer from 'inquirer';
import chalk from 'chalk';
import { execFile } from 'child_process';
import { saveCredentials, getCredentials, getApiBaseUrl, getWebBaseUrl } from '../config.js';
import { getClient } from '../client.js';
import { loginWithBrowser } from '../utils/browserAuth.js';
import { terminalSafeError, terminalSafeText } from '../utils/terminal.js';

function openDashboardUrl(rawUrl: string): void {
    let href: string;
    try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return;
        }
        href = parsed.href;
    } catch {
        return;
    }

    if (process.platform === 'darwin') {
        execFile('open', [href], () => {});
    } else if (process.platform === 'win32') {
        execFile('cmd', ['/c', 'start', '', href], { windowsHide: true }, () => {});
    } else {
        execFile('xdg-open', [href], () => {});
    }
}

export interface LoginOptions {
    /** Login method: 'browser' (OAuth, default), 'console' (open dashboard in browser) or 'manual' (paste token) */
    method?: string;
    /** API token for non-interactive login */
    token?: string;
}

/**
 * when run interactively without --method/--token, let the
 * user choose how to log in instead of silently forcing the browser flow.
 * Flags always short-circuit the prompt (scripts and CI unaffected), and
 * non-TTY runs fall through to the console flow in loginCommand.
 * Exported for testing.
 */
export async function resolveInteractiveLoginMethod(
    options: LoginOptions | undefined,
    opts: { isTTY: boolean; ask?: () => Promise<string> },
): Promise<LoginOptions | undefined> {
    if (options?.token || options?.method || !opts.isTTY) return options;

    const ask = opts.ask ?? (async () => {
        const { choice } = await inquirer.prompt([
            {
                type: 'list',
                name: 'choice',
                message: 'Choose how you want to log in to Scrapely',
                choices: [
                    { name: 'Through the Scrapely dashboard in your default browser', value: 'browser' },
                    { name: 'Open the dashboard to copy an API token', value: 'console' },
                    { name: 'Enter API token manually', value: 'manual' },
                ],
            },
        ]);
        return choice as string;
    });

    return { ...(options ?? {}), method: await ask() };
}

export async function loginCommand(options?: LoginOptions): Promise<void> {
    // Valid login methods: 'browser' (OAuth flow), 'console' (open dashboard to copy
    // a token) or 'manual' (paste token) — reject anything else loudly instead of
    // silently falling through to a prompt.
    if (options?.method !== undefined && options?.method !== 'browser' && options?.method !== 'console' && options?.method !== 'manual') {
        console.error(chalk.red(`Error: Invalid login method "${options.method}". Use "browser", "console" or "manual".`));
        process.exit(1);
    }

    // Refuse a plain-http remote API up front, before any token is entered or sent.
    try {
        getApiBaseUrl();
    } catch (error) {
        console.error(chalk.red(`Error: ${terminalSafeError(error)}`));
        process.exit(1);
    }

    const existingCreds = getCredentials();
    if (existingCreds?.user && !options?.token) {
        console.log(chalk.yellow(`Already logged in as ${existingCreds.user.email}`));
        const { proceed } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'proceed',
                message: 'Login with different account?',
                default: false,
            },
        ]);
        if (!proceed) return;
    }

    // Make it obvious which API the CLI resolved to when nothing was
    // configured explicitly (no env vars, no saved credentials), instead of
    // failing later with a confusing error against an unexpected host.
    if (!process.env.SCRAPELY_API_BASE_URL && !process.env.SCRAPELY_API_URL && !existingCreds?.apiBaseUrl) {
        console.log(chalk.gray(`Using default API at ${getApiBaseUrl()} (set SCRAPELY_API_BASE_URL to override)`));
    }

    // interactive method picker (see helper docstring).
    options = await resolveInteractiveLoginMethod(options, { isTTY: Boolean(process.stdout.isTTY) });

    let token: string;

    if (options?.token) {
        // Non-interactive login with an explicit token
        token = options.token;
    } else if (options?.method === 'manual') {
        // Manual flow: prompt for the token
        const { promptedToken } = await inquirer.prompt([
            {
                type: 'password',
                name: 'promptedToken',
                message: 'Enter your Scrapely API token',
                mask: '*',
                validate: (input: string) => input.length > 0 || 'Please enter your API token',
            },
        ]);
        token = promptedToken;
    } else if (options?.method === 'console' || !process.stdout.isTTY) {
        // Console flow: open the dashboard so the user can copy their API token
        // (also used non-interactively, where the browser flow cannot prompt).
        // The dashboard lives on the WEB host (e.g. api-staging.scrape.ly →
        // my-staging.scrape.ly), never the API host — getWebBaseUrl() knows it.
        const dashboardUrl = getWebBaseUrl();
        console.log(chalk.bold('\nScrapely dashboard login'));
        console.log(chalk.gray(`Opening ${dashboardUrl} — go to Settings → API Keys, copy a token, then paste it below.`));
        console.log(chalk.gray(`If the browser does not open, visit: ${dashboardUrl}`));
        // Open via execFile (no shell) so a malicious API URL cannot inject commands
        openDashboardUrl(dashboardUrl);
        const { promptedToken } = await inquirer.prompt([
            {
                type: 'password',
                name: 'promptedToken',
                message: 'Enter your Scrapely API token',
                mask: '*',
                validate: (input: string) => input.length > 0 || 'Please enter your API token',
            },
        ]);
        token = promptedToken;
    } else {
        // Browser flow (default): OAuth loopback redirect with PKCE.
        // Falls back to the manual prompt if the flow fails.
        try {
            token = await loginWithBrowser(getApiBaseUrl());
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error(chalk.yellow(`\nBrowser login failed: ${terminalSafeText(message)}`));
            console.error(chalk.yellow(`Falling back to manual token entry (get one at ${getWebBaseUrl()}).`));
            const { promptedToken } = await inquirer.prompt([
                {
                    type: 'password',
                    name: 'promptedToken',
                    message: 'Enter your Scrapely API token',
                    mask: '*',
                    validate: (input: string) => input.length > 0 || 'Please enter your API token',
                },
            ]);
            token = promptedToken;
        }
    }

    try {
        console.log(chalk.gray('\nValidating token...'));
        const user = (await getClient(token).user().get()) as { id: string; email: string; username: string };
        if (!user) {
            throw new Error('Token validation failed - user not found');
        }

        saveCredentials({
            token,
            apiBaseUrl: getApiBaseUrl(),
            user,
        });

        console.log(chalk.green('\n✓ Logged in successfully!'));
        console.log(chalk.gray(`  User: ${user.username} (${user.email})`));
    } catch (error) {
        // Connection failures produce enormous axios/fetch error dumps — show
        // one actionable line instead when the API is simply unreachable.
        const err = error as { message?: string; code?: string; cause?: { code?: string } };
        const causeCode = err?.cause?.code ?? err?.code;
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (causeCode === 'ECONNREFUSED' || causeCode === 'ENOTFOUND' || causeCode === 'EAI_AGAIN'
            || /fetch failed|ECONNREFUSED|ENOTFOUND/i.test(message)) {
            console.error(chalk.red(`\n✗ Cannot reach the Scrapely API at ${getApiBaseUrl()} (${causeCode ?? 'connection failed'}).`));
            console.error(chalk.gray('  Check SCRAPELY_API_BASE_URL / SCRAPELY_API_URL, or that the server is running.'));
        } else {
            console.error(chalk.red(`\n✗ Login failed: ${terminalSafeText(message)}`));
        }
        process.exit(1);
    }
}