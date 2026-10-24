import { homedir } from 'os';
import { dirname, join, resolve } from 'path';
import { chmodSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';


export const SCRAPELY_DIR = join(homedir(), '.scrapely');
export const CREDENTIALS_FILE = join(SCRAPELY_DIR, 'credentials.json');
export const SECRETS_FILE = join(SCRAPELY_DIR, 'secrets.json');

export interface Credentials {
    token: string;
    apiBaseUrl: string;
    user?: {
        id: string;
        email: string;
        username: string;
    };
}

export interface Secret {
    name: string;
    value: string;
    createdAt: string;
}

/**
 * Actor configuration (actor.json format) from .actor/actor.json,
 * .actor/scrapely.json, scrapely.json or actor.json — see findActorConfig.
 */
export interface ActorConfig {
    actorSpecification?: number;
    name?: string;
    version?: string;
    buildTag?: string;
    environmentVariables?: Record<string, string>;
    defaultRunOptions?: {
        memoryMbytes?: number;
        timeoutSecs?: number;
        build?: string;
    };
    input?: Record<string, unknown> | string;
    readme?: string;
    changelog?: string;
    dockerfile?: string;
    // Additional Scrapely-specific fields
    title?: string;
    description?: string;
    isPublic?: boolean;
    actorId?: string;
}

/**
 * ScrapelyConfig - backward compatibility type for getLocalConfig
 * @deprecated Use ActorConfig and PackageConfig instead
 */
export interface ScrapelyConfig {
    name: string;
    version: string;
    entrypoint?: string;
    maxMemory?: number;
    maxTimeout?: number;
    description?: string;
    actorId?: string;
}

/**
 * Package.json configuration (Node.js project settings)
 * May contain actor fields mixed in for backward compatibility.
 */
export interface PackageConfig {
    name?: string;
    version?: string;
    type?: string;
    main?: string;
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    // Actor fields that may be mixed in
    actorId?: string;
    entrypoint?: string;
    maxMemory?: number;
    maxTimeout?: number;
}

const DEFAULT_API_URL = 'https://api.scrape.ly';

export function ensureScrapelyDir(): void {
    if (!existsSync(SCRAPELY_DIR)) {
        mkdirSync(SCRAPELY_DIR, { recursive: true });
    }
}

/**
 * Write a file that contains secrets (API token, secret values) with
 * owner-only permissions (0600). `mode` only applies to newly created files,
 * so an explicit chmod tightens pre-existing files written earlier without it.
 */
function writeSecretsFile(path: string, data: string): void {
    writeFileSync(path, data, { mode: 0o600 });
    try {
        chmodSync(path, 0o600);
    } catch {
        // Best-effort on filesystems that do not support chmod.
    }
}

export function getCredentials(): Credentials | null {
    if (!existsSync(CREDENTIALS_FILE)) {
        return null;
    }
    try {
        const content = readFileSync(CREDENTIALS_FILE, 'utf-8');
        return JSON.parse(content);
    } catch {
        return null;
    }
}

export function saveCredentials(credentials: Credentials): void {
    ensureScrapelyDir();
    writeSecretsFile(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2));
}

export function clearCredentials(): void {
    if (existsSync(CREDENTIALS_FILE)) {
        writeSecretsFile(CREDENTIALS_FILE, '{}');
    }
}

/**
 * Get secrets from ~/.scrapely/secrets.json
 */
export function getSecrets(): Record<string, Secret> {
    if (!existsSync(SECRETS_FILE)) {
        return {};
    }
    try {
        const content = readFileSync(SECRETS_FILE, 'utf-8');
        return JSON.parse(content);
    } catch {
        return {};
    }
}

/**
 * Save a secret to ~/.scrapely/secrets.json
 */
export function saveSecret(name: string, value: string): void {
    ensureScrapelyDir();
    const secrets = getSecrets();
    secrets[name] = {
        name,
        value,
        createdAt: new Date().toISOString(),
    };
    writeSecretsFile(SECRETS_FILE, JSON.stringify(secrets, null, 2));
}

/**
 * Delete a secret from ~/.scrapely/secrets.json
 */
export function deleteSecret(name: string): boolean {
    const secrets = getSecrets();
    if (secrets[name]) {
        delete secrets[name];
        writeSecretsFile(SECRETS_FILE, JSON.stringify(secrets, null, 2));
        return true;
    }
    return false;
}

/**
 * Actor config locations, highest priority first. Matches the server
 * (scrapely-server/src/utils/actorConfigFile.ts) so the CLI and the platform
 * always read the same file.
 */
export const ACTOR_CONFIG_FILES = [
    '.actor/actor.json',
    '.actor/scrapely.json',
    'scrapely.json',
    'actor.json',
] as const;

export interface FoundActorConfig {
    /** Primary config with the root scrapely.json overlay (if any) merged over it. */
    config: ActorConfig;
    /** Absolute path of the primary config file. */
    path: string;
    /** Directory the primary's relative paths (input, dockerfile, ...) resolve against. */
    dir: string;
    /** Absolute path of a root scrapely.json whose fields override the primary's. */
    overlayPath?: string;
}

function readJsonObject(path: string): Record<string, unknown> | null {
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf-8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

/**
 * Find the actor config: the first of ACTOR_CONFIG_FILES that exists and parses.
 * When it lives in `.actor/` and a root scrapely.json also exists, the root file's
 * fields take precedence and the `.actor/` config supplies the rest — older
 * `scrapely create` wrote the actor name/version/actorId at the root next to a
 * template's `.actor/` config, and earlier CLI versions read only the root file.
 */
export function findActorConfig(cwd: string): FoundActorConfig | null {
    // Resolve cwd once; only join constant filenames under that base
    const base = resolve(cwd);

    for (const rel of ACTOR_CONFIG_FILES) {
        const path = join(base, ...rel.split('/'));
        if (!existsSync(path)) continue;
        const primary = readJsonObject(path);
        if (!primary) continue;

        const found: FoundActorConfig = { config: primary as ActorConfig, path, dir: dirname(path) };
        if (rel.startsWith('.actor/')) {
            const overlayPath = join(base, 'scrapely.json');
            const overlay = existsSync(overlayPath) ? readJsonObject(overlayPath) : null;
            if (overlay) {
                const merged: Record<string, unknown> = { ...primary };
                for (const [key, value] of Object.entries(overlay)) {
                    if (value !== undefined && value !== null && value !== '') merged[key] = value;
                }
                found.config = merged as ActorConfig;
                found.overlayPath = overlayPath;
            }
        }
        return found;
    }
    return null;
}

/**
 * Get actor configuration (see findActorConfig for the lookup order).
 */
export function getActorConfig(cwd: string): ActorConfig | null {
    return findActorConfig(cwd)?.config ?? null;
}

/**
 * Merge `patch` into the existing actor config without rewriting other fields.
 * Each key goes to the root overlay when that file already holds it (it would
 * otherwise shadow the update), else to the primary. Creates root scrapely.json
 * only when no config exists.
 */
export function updateActorConfig(cwd: string, patch: Partial<ActorConfig> & Record<string, unknown>): void {
    const found = findActorConfig(cwd);
    if (!found) {
        writeFileSync(join(resolve(cwd), 'scrapely.json'), JSON.stringify(patch, null, 2) + '\n');
        return;
    }

    const overlay = found.overlayPath ? readJsonObject(found.overlayPath) : null;
    const byFile = new Map<string, Record<string, unknown>>();
    for (const [key, value] of Object.entries(patch)) {
        const target = overlay && found.overlayPath && key in overlay ? found.overlayPath : found.path;
        if (!byFile.has(target)) byFile.set(target, {});
        byFile.get(target)![key] = value;
    }

    for (const [path, fields] of byFile) {
        const raw = readFileSync(path, 'utf-8');
        const current = readJsonObject(path) ?? {};
        // Keep the file's existing indentation (templates use 4 spaces)
        const indent = /^\{\s*\n( +)"/.exec(raw)?.[1]?.length ?? 2;
        writeFileSync(path, JSON.stringify({ ...current, ...fields }, null, indent) + (raw.endsWith('\n') ? '\n' : ''));
    }
}

/**
 * Get package.json configuration
 */
export function getPackageConfig(cwd: string): PackageConfig | null {
    const configPath = join(cwd, 'package.json');
    if (!existsSync(configPath)) {
        return null;
    }
    try {
        const content = readFileSync(configPath, 'utf-8');
        return JSON.parse(content);
    } catch {
        return null;
    }
}

/**
 * Save package.json configuration
 */
export function savePackageConfig(cwd: string, config: PackageConfig): void {
    const configPath = join(cwd, 'package.json');
    writeFileSync(configPath, JSON.stringify(config, null, 2));
}

/**
 * Get local config (backward compatibility - returns merged config)
 * @deprecated Use getActorConfig() and getPackageConfig() instead
 */
export function getLocalConfig(cwd: string): ScrapelyConfig | null {
    const actorConfig = getActorConfig(cwd);
    const packageConfig = getPackageConfig(cwd);
    
    if (!actorConfig && !packageConfig) {
        return null;
    }
    
    // Merge configs, with actorConfig taking precedence for actor-specific fields
    return {
        name: actorConfig?.name || packageConfig?.name || '',
        version: actorConfig?.version || packageConfig?.version || '0.0.1',
        entrypoint: packageConfig?.main,
        maxMemory: (actorConfig?.defaultRunOptions as any)?.memoryMbytes,
        maxTimeout: (actorConfig?.defaultRunOptions as any)?.timeoutSecs,
        description: actorConfig?.description,
        actorId: actorConfig?.actorId || packageConfig?.actorId,
    };
}

/**
 * API base URL resolution order (env vars override stored config):
 *   1. SCRAPELY_API_BASE_URL env var (documented in the agent skill)
 *   2. SCRAPELY_API_URL env var
 *   3. API URL saved with the login credentials
 *   4. Default (local development server)
 */
export function getApiBaseUrl(): string {
    const creds = getCredentials();
    return process.env.SCRAPELY_API_BASE_URL || process.env.SCRAPELY_API_URL || creds?.apiBaseUrl || DEFAULT_API_URL;
}

/**
 * Base URL of the web dashboard (console), used for links the CLI prints or
 * opens. Resolution order:
 *   1. SCRAPELY_WEB_URL env var
 *   2. Derived from the API host: the console sits next to the API under a
 *      `my` name, the same way Scrape.ly's own hosts are laid out:
 *        api.scrape.ly          → my.scrape.ly
 *        api-staging.scrape.ly  → my-staging.scrape.ly
 *        api.example.com        → my.example.com
 *        api-eu.example.com     → my-eu.example.com
 *      Scheme and port are kept.
 *   3. The API base URL itself for any other host (localhost, IPs, a host
 *      without an `api` label): self-hosted setups where the API and the
 *      console share a host. Set SCRAPELY_WEB_URL when they don't.
 */
export function getWebBaseUrl(): string {
    const fromEnv = process.env.SCRAPELY_WEB_URL;
    if (fromEnv) return fromEnv.replace(/\/+$/, '');
    const apiBase = getApiBaseUrl();
    try {
        const url = new URL(apiBase);
        const match = /^api(-[a-z0-9-]+)?\.(.+)$/i.exec(url.hostname);
        if (match) {
            const host = `my${match[1] ?? ''}.${match[2]}`;
            return `${url.protocol}//${host}${url.port ? `:${url.port}` : ''}`;
        }
    } catch {
        // not a URL: fall through to the API base
    }
    return apiBase.replace(/\/+$/, '');
}

/** SCRAPELY_TOKEN wins over the saved login (same as the reference CLI). */
export function getToken(): string | null {
    return process.env.SCRAPELY_TOKEN || getCredentials()?.token || null;
}

/**
 * Resolve secret references in environment variables
 * Secrets are referenced with @ prefix, e.g., "@mySecret"
 */
export function resolveSecrets(envVars: Record<string, string>): Record<string, string> {
    const secrets = getSecrets();
    const resolved: Record<string, string> = {};
    
    for (const [key, value] of Object.entries(envVars)) {
        if (typeof value === 'string' && value.startsWith('@')) {
            const secretName = value.substring(1);
            const secret = secrets[secretName];
            if (secret) {
                resolved[key] = secret.value;
            } else {
                console.warn(`Warning: Secret "${secretName}" not found for environment variable "${key}"`);
                resolved[key] = value;
            }
        } else {
            resolved[key] = value;
        }
    }
    
    return resolved;
}
