#!/usr/bin/env node

import chalk from 'chalk';
import { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { getCredentials } from '../config.js';
import { terminalSafeError } from '../utils/terminal.js';

/** Name of the server entry written into each client's MCP config. */
export const MCP_SERVER_NAME = 'scrapely';

/** The MCP server is the `scrapely-mcp` package on PyPI, run through uv. */
export const MCP_COMMAND = 'uvx';
/**
 * scrapely-mcp version the CLI runs. Pinned so a later PyPI release never runs with the user's token unreviewed.
 * Must equal the version in scrapely-mcp-python/pyproject.toml: the CLI tests and the publish workflow fail otherwise,
 * so each MCP release needs a CLI release.
 */
export const MCP_VERSION = '0.3.8';
export const MCP_ARGS = ['--from', `scrapely-mcp==${MCP_VERSION}`, 'scrapely-mcp-server'];

export const MCP_CLIENTS = ['claude-code', 'claude-desktop', 'cursor', 'vscode', 'codex'] as const;
export type McpClient = (typeof MCP_CLIENTS)[number];

export interface McpClientTarget {
    /** Config file the server entry is written to */
    path: string;
    format: 'json' | 'toml';
    /** JSON key holding the server map (`servers` for VS Code, `mcpServers` elsewhere) */
    serversKey?: string;
    /** Whether the client wants an explicit `"type": "stdio"` on the entry */
    withType?: boolean;
}

interface Env {
    home: string;
    platform: NodeJS.Platform;
    appData?: string;
    xdgConfigHome?: string;
}

/** Per-OS application config dir (macOS Application Support, Windows %APPDATA%, XDG elsewhere). */
function appConfigDir({ home, platform, appData, xdgConfigHome }: Env): string {
    if (platform === 'darwin') return join(home, 'Library', 'Application Support');
    if (platform === 'win32') return appData || join(home, 'AppData', 'Roaming');
    return xdgConfigHome || join(home, '.config');
}

/**
 * User-level MCP config location for each supported client.
 */
export function getMcpClientTarget(client: McpClient, env: Env): McpClientTarget {
    switch (client) {
        case 'claude-code':
            return { path: join(env.home, '.claude.json'), format: 'json', serversKey: 'mcpServers', withType: true };
        case 'claude-desktop':
            return { path: join(appConfigDir(env), 'Claude', 'claude_desktop_config.json'), format: 'json', serversKey: 'mcpServers' };
        case 'cursor':
            return { path: join(env.home, '.cursor', 'mcp.json'), format: 'json', serversKey: 'mcpServers' };
        case 'vscode':
            return { path: join(appConfigDir(env), 'Code', 'User', 'mcp.json'), format: 'json', serversKey: 'servers', withType: true };
        case 'codex':
            return { path: join(env.home, '.codex', 'config.toml'), format: 'toml' };
    }
}

export function buildMcpEnv(token: string, apiBaseUrl?: string): Record<string, string> {
    const env: Record<string, string> = { SCRAPELY_TOKEN: token };
    if (apiBaseUrl) env.SCRAPELY_API_BASE_URL = apiBaseUrl;
    return env;
}

/**
 * API origin written next to the token. The saved login token only ever goes
 * with the origin it was saved for; the env overrides (same as getApiBaseUrl,
 * without its local-dev default) apply only to a token that was also given
 * explicitly (--token or SCRAPELY_TOKEN).
 */
export function resolveMcpApiBaseUrl(explicitToken: boolean, savedApiBaseUrl: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
    if (!explicitToken) return savedApiBaseUrl;
    return env.SCRAPELY_API_BASE_URL || env.SCRAPELY_API_URL || savedApiBaseUrl;
}

/**
 * Add or replace the `scrapely` entry in a JSON MCP config, keeping everything else.
 * Throws on a file that is not a JSON object so a broken config is never overwritten.
 */
export function upsertJsonMcpServer(content: string | null, target: McpClientTarget, env: Record<string, string>): string {
    const config = content?.trim() ? JSON.parse(content) : {};
    if (typeof config !== 'object' || config === null || Array.isArray(config)) {
        throw new Error('config file is not a JSON object');
    }
    const key = target.serversKey ?? 'mcpServers';
    const entry = {
        ...(target.withType ? { type: 'stdio' } : {}),
        command: MCP_COMMAND,
        args: MCP_ARGS,
        env,
    };
    config[key] = { ...(config[key] ?? {}), [MCP_SERVER_NAME]: entry };
    return `${JSON.stringify(config, null, 2)}\n`;
}

/**
 * Add or replace the `[mcp_servers.scrapely]` tables in Codex's config.toml, keeping everything else.
 * JSON string literals are valid TOML basic strings, so values are quoted with JSON.stringify.
 */
export function upsertCodexMcpServer(content: string | null, env: Record<string, string>): string {
    const ownHeader = new RegExp(`^\\s*\\[mcp_servers\\.${MCP_SERVER_NAME}(\\.[^\\]]+)?\\]\\s*$`);
    const kept: string[] = [];
    let skipping = false;
    for (const line of (content ?? '').split('\n')) {
        if (/^\s*\[/.test(line)) skipping = ownHeader.test(line);
        if (!skipping) kept.push(line);
    }
    const body = kept.join('\n').replace(/\s+$/, '');
    const block = [
        `[mcp_servers.${MCP_SERVER_NAME}]`,
        `command = ${JSON.stringify(MCP_COMMAND)}`,
        `args = [${MCP_ARGS.map((a) => JSON.stringify(a)).join(', ')}]`,
        '',
        `[mcp_servers.${MCP_SERVER_NAME}.env]`,
        ...Object.entries(env).map(([k, v]) => `${k} = ${JSON.stringify(v)}`),
    ].join('\n');
    return `${body ? `${body}\n\n` : ''}${block}\n`;
}

/**
 * mcp install <client> - Add the Scrapely MCP server to an MCP client's config
 */
export async function mcpInstallCommand(client: string, options: { token?: string }): Promise<void> {
    if (!(MCP_CLIENTS as readonly string[]).includes(client)) {
        console.error(chalk.red(`Error: Unknown client "${client}". Supported clients: ${MCP_CLIENTS.join(', ')}`));
        process.exit(1);
    }

    const creds = getCredentials();
    const token = options.token || process.env.SCRAPELY_TOKEN || creds?.token;
    if (!token) {
        console.error(chalk.red('Error: Not logged in. Run `scrapely login` first or pass --token.'));
        process.exit(1);
    }

    const target = getMcpClientTarget(client as McpClient, {
        home: homedir(),
        platform: process.platform,
        appData: process.env.APPDATA,
        xdgConfigHome: process.env.XDG_CONFIG_HOME,
    });
    const env = buildMcpEnv(token, resolveMcpApiBaseUrl(!!(options.token || process.env.SCRAPELY_TOKEN), creds?.apiBaseUrl, process.env));
    const existing = existsSync(target.path) ? readFileSync(target.path, 'utf-8') : null;

    let updated: string;
    try {
        updated = target.format === 'toml'
            ? upsertCodexMcpServer(existing, env)
            : upsertJsonMcpServer(existing, target, env);
    } catch (error) {
        console.error(chalk.red(`Error: Could not update ${target.path}: ${terminalSafeError(error)}`));
        process.exit(1);
    }

    mkdirSync(dirname(target.path), { recursive: true });
    writeFileSync(target.path, updated);

    console.log(chalk.green(`✓ Added the "${MCP_SERVER_NAME}" MCP server to ${client}`));
    console.log(chalk.gray(`  Config: ${target.path}`));
    console.log(chalk.gray('  Requires uv (https://docs.astral.sh/uv/) to run the server. Restart the client to load it.'));
}

/**
 * Set up the mcp command with subcommands
 */
export function setupMcpCommand(program: Command): void {
    const mcp = program
        .command('mcp')
        .description('Manage the Scrapely MCP server in MCP clients');

    mcp
        .command('install <client>')
        .description(`Add the Scrapely MCP server to an MCP client (${MCP_CLIENTS.join(', ')}). Uses the token from \`scrapely login\` unless --token is given`)
        .option('-t, --token <token>', 'API token to use instead of the logged-in one')
        .action((client: string, options: { token?: string }) => mcpInstallCommand(client, options));
}
