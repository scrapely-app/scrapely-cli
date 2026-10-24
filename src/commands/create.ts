#!/usr/bin/env node
// Portions derived from apify-cli (src/commands/create.ts, src/lib/create-utils.ts, src/lib/utils.ts; Copyright Apify Technologies s.r.o., Apache-2.0).
// Modified by TeraShift GmbH. See the LICENSE and NOTICE files.

import inquirer from 'inquirer';
import chalk from 'chalk';
import { Command } from 'commander';
import { existsSync, writeFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, cpSync, renameSync } from 'fs';
import { join } from 'path';
import { safeResolve, validateFilename } from '../utils/pathValidation.js';
import { getToken, getApiBaseUrl, findActorConfig, getActorConfig, updateActorConfig, ACTOR_CONFIG_FILES } from '../config.js';
import { getLoggedClientOrThrow } from '../client.js';
import { ActorSourceType as PlatformActorSourceType } from 'scrapely-client';
import { tmpdir } from 'os';

import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Actor templates available for creation.
 *
 * This array is the OFFLINE FALLBACK snapshot of the live catalog served by
 * the API (GET /v2/actor-templates) from the templates repo
 * (github.com/scrapely-app/actor-templates). Template files live in the
 * repo `folder` named here; `name` matches the manifest id and `aliases`
 * keep older CLI template names working.
 */
export const ACTOR_TEMPLATES = [
    {
        name: 'crawlee-cheerio-js',
        aliases: [] as string[],
        displayName: 'Crawlee Cheerio JavaScript',
        description: 'Fast web scraper using Cheerio for HTML parsing — no browser needed',
        language: 'javascript',
        useCases: ['web-scraper', 'data-pipeline'],
        folder: 'js-crawlee-cheerio',
        repoUrl: 'https://github.com/scrapely-app/actor-templates/tree/main/js-crawlee-cheerio',
    },
    {
        name: 'crawlee-playwright',
        aliases: ['crawlee-playwright-js'],
        displayName: 'Crawlee Playwright JavaScript',
        description: 'Web scraper using Playwright browser automation with JavaScript',
        language: 'javascript',
        useCases: ['web-scraper', 'browser-automation'],
        folder: 'js-crawlee-playwright-chrome',
        repoUrl: 'https://github.com/scrapely-app/actor-templates/tree/main/js-crawlee-playwright-chrome',
    },
    {
        name: 'crawlee-puppeteer-chrome',
        aliases: ['crawlee-puppeteer-js'],
        displayName: 'Crawlee Puppeteer JavaScript',
        description: 'Web scraper using Puppeteer browser automation with JavaScript',
        language: 'javascript',
        useCases: ['web-scraper', 'browser-automation'],
        folder: 'js-crawlee-puppeteer-chrome',
        repoUrl: 'https://github.com/scrapely-app/actor-templates/tree/main/js-crawlee-puppeteer-chrome',
    },
    {
        name: 'crawlee-playwright-ts',
        aliases: [] as string[],
        displayName: 'Crawlee Playwright TypeScript',
        description: 'Web scraper using Playwright browser automation with TypeScript',
        language: 'typescript',
        useCases: ['web-scraper', 'browser-automation'],
        folder: 'ts-crawlee-playwright-chrome',
        repoUrl: 'https://github.com/scrapely-app/actor-templates/tree/main/ts-crawlee-playwright-chrome',
    },
    {
        name: 'js-bootstrap-cheerio-crawler',
        aliases: [] as string[],
        displayName: 'JavaScript minimal site crawler (Crawlee + Cheerio)',
        description: 'A minimal site crawler for developers who already know the Scrapely SDK and Crawlee.',
        language: 'javascript',
        useCases: ['web-scraper'],
        folder: 'js-bootstrap-cheerio-crawler',
        repoUrl: 'https://github.com/scrapely-app/actor-templates/tree/main/js-bootstrap-cheerio-crawler',
    },
    {
        name: 'js-crawlee-playwright-camoufox',
        aliases: ['project_playwright_camoufox_crawler_js'],
        displayName: 'JavaScript stealth crawler (Crawlee + Playwright + Camoufox)',
        description: 'A browser crawler built to get past bot protection. Uses Camoufox, a Firefox build that looks like a real user.',
        language: 'javascript',
        useCases: ['web-scraper'],
        folder: 'js-crawlee-playwright-camoufox',
        repoUrl: 'https://github.com/scrapely-app/actor-templates/tree/main/js-crawlee-playwright-camoufox',
    },
    {
        name: 'js-cypress',
        aliases: ['project_cypress'],
        displayName: 'JavaScript test runner (Cypress)',
        description: 'A cloud test runner for Cypress that saves results and videos.',
        language: 'javascript',
        useCases: ['browser-automation'],
        folder: 'js-cypress',
        repoUrl: 'https://github.com/scrapely-app/actor-templates/tree/main/js-cypress',
    },
    {
        name: 'js-empty',
        aliases: ['project_empty'],
        displayName: 'Empty JavaScript Actor',
        description: 'An Actor with the Scrapely SDK set up, so you can build any tool you need.',
        language: 'javascript',
        useCases: [] as string[],
        folder: 'js-empty',
        repoUrl: 'https://github.com/scrapely-app/actor-templates/tree/main/js-empty',
    },
    {
        name: 'js-langchain',
        aliases: ['project_langchain_js'],
        displayName: 'JavaScript website chat (LangChain)',
        description: 'A site crawler that lets you ask AI questions about its content.',
        language: 'javascript',
        useCases: ['ai-agent'],
        folder: 'js-langchain',
        repoUrl: 'https://github.com/scrapely-app/actor-templates/tree/main/js-langchain',
    },
    {
        name: 'js-langgraph-agent',
        aliases: ['project-langgraph-agent-javascript'],
        displayName: 'JavaScript web search agent (LangGraph)',
        description: 'An AI agent that answers questions by searching the web.',
        language: 'javascript',
        useCases: ['ai-agent'],
        folder: 'js-langgraph-agent',
        repoUrl: 'https://github.com/scrapely-app/actor-templates/tree/main/js-langgraph-agent',
    },
    {
        name: 'js-standby',
        aliases: ['js_standby'],
        displayName: 'JavaScript API Actor',
        description: 'An Actor that stays running, ready to respond to HTTP requests. Good for APIs and real-time services.',
        language: 'javascript',
        useCases: ['data-pipeline'],
        folder: 'js-standby',
        repoUrl: 'https://github.com/scrapely-app/actor-templates/tree/main/js-standby',
    },
    {
        name: 'js-start',
        aliases: ['getting_started_node'],
        displayName: 'JavaScript one-page scraper (Cheerio)',
        description: 'A scraper that gets data from one web page with Cheerio. The simplest way to start scraping.',
        language: 'javascript',
        useCases: ['web-scraper'],
        folder: 'js-start',
        repoUrl: 'https://github.com/scrapely-app/actor-templates/tree/main/js-start',
    },
    {
        name: 'ts-beeai-agent',
        aliases: [] as string[],
        displayName: 'TypeScript social media agent (BeeAI)',
        description: 'An AI agent for social media research, with built-in observability and tracing.',
        language: 'typescript',
        useCases: ['ai-agent'],
        folder: 'ts-beeai-agent',
        repoUrl: 'https://github.com/scrapely-app/actor-templates/tree/main/ts-beeai-agent',
    },
    {
        name: 'ts-crawlee-cheerio',
        aliases: ['project_cheerio_crawler_ts'],
        displayName: 'TypeScript site crawler (Crawlee + Cheerio)',
        description: 'A fast crawler that follows links and gets data from static pages, with Crawlee handling retries, queues, and proxies. Good for blogs, news, or product listings, but it can\'t run client-side JavaScript.',
        language: 'typescript',
        useCases: ['web-scraper'],
        folder: 'ts-crawlee-cheerio',
        repoUrl: 'https://github.com/scrapely-app/actor-templates/tree/main/ts-crawlee-cheerio',
    },
    {
        name: 'ts-crawlee-playwright-camoufox',
        aliases: ['project_playwright_camoufox_crawler_ts'],
        displayName: 'TypeScript stealth crawler (Crawlee + Playwright + Camoufox)',
        description: 'A browser crawler built to get past bot protection. Uses Camoufox, a Firefox build that looks like a real user.',
        language: 'typescript',
        useCases: ['web-scraper'],
        folder: 'ts-crawlee-playwright-camoufox',
        repoUrl: 'https://github.com/scrapely-app/actor-templates/tree/main/ts-crawlee-playwright-camoufox',
    },
    {
        name: 'ts-crawlee-puppeteer-chrome',
        aliases: ['project_puppeteer_crawler_ts'],
        displayName: 'TypeScript browser crawler (Crawlee + Puppeteer + Chrome)',
        description: 'A browser crawler that renders JavaScript in headless Chrome, with Crawlee handling retries, queues, and proxies. Good for social feeds, dashboards, or single-page apps.',
        language: 'typescript',
        useCases: ['web-scraper'],
        folder: 'ts-crawlee-puppeteer-chrome',
        repoUrl: 'https://github.com/scrapely-app/actor-templates/tree/main/ts-crawlee-puppeteer-chrome',
    },
    {
        name: 'ts-empty',
        aliases: ['ts_empty'],
        displayName: 'Empty TypeScript Actor',
        description: 'An Actor with the Scrapely SDK set up, so you can build any tool you need.',
        language: 'typescript',
        useCases: [] as string[],
        folder: 'ts-empty',
        repoUrl: 'https://github.com/scrapely-app/actor-templates/tree/main/ts-empty',
    },
    {
        name: 'ts-mastraai',
        aliases: [] as string[],
        displayName: 'TypeScript social media agent (Mastra)',
        description: 'An AI agent for social media research, built on a TypeScript-native framework.',
        language: 'typescript',
        useCases: ['ai-agent'],
        folder: 'ts-mastraai',
        repoUrl: 'https://github.com/scrapely-app/actor-templates/tree/main/ts-mastraai',
    },
    {
        name: 'ts-mcp-empty',
        aliases: [] as string[],
        displayName: 'TypeScript MCP server',
        description: 'An MCP server that gives AI assistants like Claude and Cursor your own tools, with built-in pay-per-event billing.',
        language: 'typescript',
        useCases: ['ai-agent', 'data-pipeline'],
        folder: 'ts-mcp-empty',
        repoUrl: 'https://github.com/scrapely-app/actor-templates/tree/main/ts-mcp-empty',
    },
    {
        name: 'ts-mcp-proxy',
        aliases: [] as string[],
        displayName: 'TypeScript MCP proxy',
        description: 'A proxy that turns any existing MCP server into a monetized Actor. Supports stdio, HTTP, and SSE.',
        language: 'typescript',
        useCases: ['ai-agent', 'data-pipeline'],
        folder: 'ts-mcp-proxy',
        repoUrl: 'https://github.com/scrapely-app/actor-templates/tree/main/ts-mcp-proxy',
    },
    {
        name: 'ts-playwright-test-runner',
        aliases: ['project_playwright_test_runner'],
        displayName: 'TypeScript test runner (Playwright)',
        description: 'An automated browser test runner with results you can access via API.',
        language: 'typescript',
        useCases: ['browser-automation'],
        folder: 'ts-playwright-test-runner',
        repoUrl: 'https://github.com/scrapely-app/actor-templates/tree/main/ts-playwright-test-runner',
    },
    {
        name: 'ts-standby',
        aliases: ['ts_standby'],
        displayName: 'TypeScript API Actor',
        description: 'An Actor that stays running, ready to respond to HTTP requests. Good for APIs and real-time services.',
        language: 'typescript',
        useCases: ['data-pipeline'],
        folder: 'ts-standby',
        repoUrl: 'https://github.com/scrapely-app/actor-templates/tree/main/ts-standby',
    },
    {
        name: 'ts-start',
        aliases: ['getting_started_typescript'],
        displayName: 'TypeScript one-page scraper (Cheerio)',
        description: 'A scraper that gets data from one web page with Cheerio. The simplest way to start scraping.',
        language: 'typescript',
        useCases: ['web-scraper'],
        folder: 'ts-start',
        repoUrl: 'https://github.com/scrapely-app/actor-templates/tree/main/ts-start',
    },
    {
        name: 'ts-start-bun',
        aliases: ['getting_started_typescript_bun'],
        displayName: 'TypeScript one-page scraper (Bun + Cheerio)',
        description: 'Get data from one web page with Cheerio, on the fast Bun runtime.',
        language: 'typescript',
        useCases: ['web-scraper'],
        folder: 'ts-start-bun',
        repoUrl: 'https://github.com/scrapely-app/actor-templates/tree/main/ts-start-bun',
    },
];

/**
 * Validate actor name
 */
function validateActorName(input: string): string | boolean {
    if (input.length < 3) {
        return 'The Actor name must be at least 3 characters long.';
    }
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(input)) {
        return 'The Actor name must be a DNS hostname-friendly string (e.g. my-newest-actor).';
    }
    return true;
}

/**
 * Validation result for the --source option (--source contract).
 */
export type CreateSourceValidation =
    | { ok: true; source: 'platform' | 'github'; deprecatedAlias?: 'apify' }
    | { ok: false; error: string; hint?: string };

/**
 * Validate the --source option. Only `platform` and `github` are supported;
 * `gitlab` and `bitbucket` are recognized but rejected with a clear message.
 */
export function validateCreateSource(source: string): CreateSourceValidation {
    if (source === 'platform' || source === 'github') {
        return { ok: true, source };
    }
    // Deprecated alias of "platform", kept so existing scripts keep working.
    if (source === 'apify') {
        return { ok: true, source: 'platform', deprecatedAlias: 'apify' };
    }
    if (source === 'gitlab' || source === 'bitbucket') {
        return {
            ok: false,
            error: `--source ${source} is not supported on Scrapely yet.`,
            hint: 'Scrapely currently supports "platform" (source stored on the platform) and "github" (kept in a GitHub repository). GitLab and Bitbucket support is planned.',
        };
    }
    return {
        ok: false,
        error: '--source must be "platform", "github", "gitlab" or "bitbucket" (GitLab and Bitbucket are not supported on Scrapely yet; "apify" is a deprecated alias of "platform").',
    };
}

/** Element type of the ACTOR_TEMPLATES list. */
export type ActorTemplate = (typeof ACTOR_TEMPLATES)[number];

/** The public repo that owns template sources + the templates.json manifest. */
export const TEMPLATE_REPO_URL = 'https://github.com/scrapely-app/actor-templates';

let remoteCatalog: ActorTemplate[] | null = null;
let remoteCatalogFetched = false;

/**
 * Live template catalog: GET /v2/actor-templates (the templates repo
 * manifest served by the API). Falls back to the bundled ACTOR_TEMPLATES
 * snapshot when the API is unreachable, so `scrapely create` and
 * `scrapely templates ls` always work.
 */
export async function getTemplates(): Promise<ActorTemplate[]> {
    if (remoteCatalogFetched) return remoteCatalog ?? ACTOR_TEMPLATES;
    remoteCatalogFetched = true;
    try {
        const base = getApiBaseUrl().replace(/\/$/, '');
        const res = await fetch(`${base}/v2/actor-templates`, { headers: { 'user-agent': 'scrapely-cli' } });
        if (res.ok) {
            const body = await res.json() as { data?: Array<Record<string, unknown>> };
            if (Array.isArray(body.data) && body.data.length > 0) {
                remoteCatalog = body.data
                    .map((t) => ({
                        name: String(t.id ?? t.name ?? ''),
                        aliases: Array.isArray(t.aliases) ? (t.aliases as string[]) : [],
                        displayName: String(t.displayName ?? t.id ?? ''),
                        description: String(t.description ?? ''),
                        language: String(t.language ?? 'unknown'),
                        useCases: Array.isArray(t.useCases) ? (t.useCases as string[]) : [],
                        folder: String(t.folder ?? ''),
                        repoUrl: `https://github.com/scrapely-app/actor-templates/tree/main/${String(t.folder ?? '')}`,
                    }))
                    .filter((t) => t.name && t.folder);
            }
        }
    } catch {
        // Offline or API unreachable — the bundled snapshot it is.
    }
    return remoteCatalog ?? ACTOR_TEMPLATES;
}

/** Resolve a template by its canonical name or a legacy alias. */
export function findTemplateByName(templates: ActorTemplate[], nameOrAlias: string): ActorTemplate | undefined {
    return templates.find((t) => t.name === nameOrAlias) ?? templates.find((t) => t.aliases.includes(nameOrAlias));
}

/**
 * Normalize a --language value, mapping the short aliases
 * accepts (javascript|js, typescript|ts, python|py) onto canonical names.
 */
export function normalizeTemplateLanguage(rawLanguage?: string): string | undefined {
    const languageAliases: Record<string, string> = { js: 'javascript', ts: 'typescript', py: 'python' };
    const lowered = rawLanguage?.toLowerCase();
    return lowered ? languageAliases[lowered] ?? lowered : undefined;
}

/**
 * Filter templates by the --language / --use-case choice filters.
 *
 * These filters only apply when the user has NOT passed an explicit
 * --template (both flags are documented upstream as
 * "Ignored when --template is provided").
 */
export function filterTemplatesByChoice(
    templates: ActorTemplate[],
    filters: { language?: string; useCase?: string },
): ActorTemplate[] {
    const { language, useCase } = filters;
    let available = templates;
    if (language) {
        available = available.filter(t => t.language === language);
    }
    if (useCase) {
        available = available.filter(t => t.useCases.includes(useCase));
    }
    return available;
}

/**
 * Update package.json with the actor name
 */
function updatePackageJson(targetDir: string, actorName: string): void {
    const packageJsonPath = join(targetDir, 'package.json');
    if (existsSync(packageJsonPath)) {
        try {
            const content = readFileSync(packageJsonPath, 'utf-8');
            const packageJson = JSON.parse(content);
            packageJson.name = actorName;
            writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
        } catch {
            // If parsing fails, leave as-is
        }
    }
}

/**
 * Update Python module directory name if needed
 */
function updatePythonModule(targetDir: string, actorName: string): void {
    // For Python templates, rename the my_actor directory to match actor name
    const myActorPath = join(targetDir, 'my_actor');
    const newActorPath = join(targetDir, actorName.replace(/-/g, '_'));
    
    if (existsSync(myActorPath) && myActorPath !== newActorPath) {
        try {
            renameSync(myActorPath, newActorPath);
        } catch {
            // If rename fails, leave as-is
        }
    }
}

/**
 * Set the actor name in the project's actor config. Templates usually ship one
 * (`.actor/scrapely.json` or `.actor/actor.json`) — update it in place rather
 * than adding a root scrapely.json that would shadow it. Only a project without
 * any config gets a new root scrapely.json.
 */
function createScrapelyJson(targetDir: string, actorName: string): void {
    if (findActorConfig(targetDir)) {
        updateActorConfig(targetDir, { name: actorName });
        return;
    }
    // A config that exists but does not parse is left as-is
    if (ACTOR_CONFIG_FILES.some((rel) => existsSync(join(targetDir, ...rel.split('/'))))) return;

    writeFileSync(join(targetDir, 'scrapely.json'), JSON.stringify({
        actorSpecification: 1,
        name: actorName,
        version: '0.0',
        buildTag: 'latest',
    }, null, 2) + '\n');
}

/**
 * Download template sources from GitHub using git clone.
 * kind "folder": clone the templates repo and copy only that template folder.
 * kind "repo":   clone the given repository wholesale (custom --git-repo).
 */
type TemplateDownloadSource =
    | { kind: 'folder'; folder: string }
    | { kind: 'repo'; url: string };

async function downloadTemplateFromGitHub(source: TemplateDownloadSource, targetDir: string): Promise<void> {
    // Clone into a fresh private directory (mkdtemp: unpredictable name, mode
    // 0700), never a guessable path another local user could create first.
    const tempRoot = mkdtempSync(join(tmpdir(), 'scrapely-template-'));
    const tempDir = join(tempRoot, 'repo');

    try {
        // SECURITY: execFile with an argument array — the repo URLs are
        // constants/validated and never interpolated into a shell command.
        const cloneUrl = source.kind === 'folder' ? TEMPLATE_REPO_URL : source.url;
        await execFileAsync('git', ['clone', '--depth', '1', cloneUrl, tempDir]);

        // For template folders copy only that folder; for whole repos copy
        // everything (excluding build artifacts), like the old behavior.
        const sourceDir = source.kind === 'folder' ? join(tempDir, source.folder) : tempDir;
        if (!existsSync(sourceDir)) {
            throw new Error(
                source.kind === 'folder'
                    ? `Template folder "${source.folder}" not found in the templates repository`
                    : 'The referenced repository is empty or could not be read',
            );
        }

        // Copy the template folder contents, excluding build artifacts
        cpSync(sourceDir, targetDir, {
            recursive: true,
            filter: (src: string) => {
                const basename = src.split(/[/\\]/).pop();
                // .github is excluded — templates must not ship CI workflows;
                // Actor rebuilds are webhook-driven, not GitHub Actions.
                return !['node_modules', '.git', '.github', 'storage', 'dist', '.env'].includes(basename || '');
            }
        });
    } finally {
        // Clean up temp directory
        try {
            rmSync(tempRoot, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors
        }
    }
}

/**
 * Where the actor source code lives (--source contract).
 * "platform" (default): source files are stored on the Scrapely platform.
 * (The deprecated --source value "apify" maps to "platform".)
 * "github": source lives in a GitHub repository.
 */
export type ActorSourceType = 'platform' | 'github';

interface GitHubRepoRef {
    workspace: string;
    name: string;
    url: string;
}

/**
 * Resolve the GitHub account/organization for a bare repository name.
 * Tries the authenticated `gh` CLI, then git config, then gives up (caller prompts).
 */
async function resolveGitHubWorkspace(): Promise<string | null> {
    try {
        const { stdout } = await execFileAsync('gh', ['api', 'user', '--jq', '.login']);
        const login = stdout.trim();
        if (login) return login;
    } catch {
        // gh CLI not available or not authenticated
    }
    try {
        const { stdout } = await execFileAsync('git', ['config', '--get', 'github.user']);
        const user = stdout.trim();
        if (user) return user;
    } catch {
        // not configured
    }
    return null;
}

/**
 * Allowed characters for GitHub workspace (account/organization) and
 * repository names. Anything outside this set — including shell
 * metacharacters — is rejected before the value can reach git or gh.
 */
const GITHUB_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

/**
 * Parse a full GitHub repository URL into its workspace/name components.
 * Uses the URL parser plus a strict hostname allowlist and never reuses the
 * raw input: the returned reference carries a canonical https URL built
 * only from validated parts, so shell metacharacters can never reach git.
 * Returns null when the value is not a well-formed GitHub repository URL.
 */
export function parseGitHubRepoUrl(value: string): { workspace: string; name: string; url: string } | null {
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        return null;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const host = parsed.hostname.toLowerCase();
    if (host !== 'github.com' && host !== 'www.github.com') return null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length !== 2) return null;
    const workspace = segments[0];
    const name = segments[1].endsWith('.git') ? segments[1].slice(0, -'.git'.length) : segments[1];
    if (!GITHUB_NAME_PATTERN.test(workspace) || !GITHUB_NAME_PATTERN.test(name)) return null;
    return { workspace, name, url: `https://github.com/${workspace}/${name}` };
}

/**
 * Parse a --git-repo value into a GitHub workspace/name reference.
 * Accepts "workspace/name", a bare repository name, or a GitHub URL.
 */
async function resolveGitHubRepo(value: string): Promise<GitHubRepoRef> {
    let workspace: string | null = null;
    let name: string | null = null;

    if (/^https?:\/\//i.test(value)) {
        const parsed = parseGitHubRepoUrl(value);
        if (!parsed) {
            console.error(chalk.red('Error: With --source github, --git-repo must be a GitHub repository (e.g. "workspace/name" or "https://github.com/workspace/name").'));
            process.exit(1);
        }
        workspace = parsed.workspace;
        name = parsed.name;
    } else {
        const refMatch = value.trim().match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
        if (refMatch) {
            workspace = refMatch[1];
            name = refMatch[2];
        } else if (/^[A-Za-z0-9_.-]+$/.test(value.trim())) {
            // A bare value is read as the name, not the workspace 
            name = value.trim();
        } else {
            console.error(chalk.red('Error: --git-repo must be "workspace/name", a bare repository name, or a GitHub URL.'));
            process.exit(1);
        }
    }

    if (!workspace) {
        workspace = await resolveGitHubWorkspace();
        if (!workspace) {
            const { answer } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'answer',
                    message: `GitHub account/organization for "${name!}"`,
                    validate: (input: string) => (input.trim().length > 0 ? true : 'Account is required.'),
                },
            ]);
            workspace = (answer as string).trim();
        }
    }

    // SECURITY: validate the resolved workspace/name (from gh, git config, or
    // a prompt) before they are used to build git/gh arguments.
    if (!GITHUB_NAME_PATTERN.test(workspace) || !GITHUB_NAME_PATTERN.test(name!)) {
        console.error(chalk.red('Error: --git-repo resolved to an invalid GitHub workspace or repository name.'));
        process.exit(1);
    }

    return { workspace, name: name!, url: `https://github.com/${workspace}/${name}` };
}

/**
 * Check whether a GitHub repository is accessible and non-empty.
 */
async function githubRepoHasContent(repoUrl: string): Promise<boolean> {
    try {
        const { stdout } = await execFileAsync('git', ['ls-remote', repoUrl]);
        return stdout.trim().length > 0;
    } catch {
        // Repository does not exist or is not accessible
        return false;
    }
}

/**
 * Clone an existing GitHub repository directly (keeps .git and origin remote).
 */
async function cloneActorRepo(repoUrl: string, targetDir: string): Promise<void> {
    await execFileAsync('git', ['clone', repoUrl, targetDir]);
}

/**
 * Create a GitHub repository from the local actor directory and push to it.
 * Uses `gh repo create` when available, falling back to adding the remote
 * and pushing directly (works for existing empty repos or configured credentials).
 */
async function pushToGitHubRepo(repo: GitHubRepoRef, targetDir: string): Promise<boolean> {
    try {
        await execFileAsync('gh', ['repo', 'create', `${repo.workspace}/${repo.name}`, '--private', '--source', targetDir, '--push']);
        return true;
    } catch {
        // gh CLI unavailable, not authenticated, or the repo already exists
    }
    try {
        await execFileAsync('git', ['remote', 'remove', 'origin'], { cwd: targetDir });
    } catch {
        // No origin remote yet — expected
    }
    try {
        await execFileAsync('git', ['remote', 'add', 'origin', repo.url], { cwd: targetDir });
        await execFileAsync('git', ['push', '-u', 'origin', 'HEAD'], { cwd: targetDir });
        return true;
    } catch {
        return false;
    }
}

/**
 * create command - Create a new actor from a template
 /**
 * Result of the --auto-build setup (create --source github --auto-build on).
 */
interface AutoBuildResult {
    ok: boolean;
    actorId?: string;
    webhookRegistered: boolean;
    manualSetupRequired?: boolean;
    webhookUrl?: string;
    error?: string;
}

/**
 * Make `--auto-build on` real (platform behavior): create the platform Actor
 * with a Git-backed version, start its initial build, and register the CI
 * webhook on the GitHub repository so future pushes rebuild the Actor.
 *
 * Never throws — the local project and GitHub repo already exist at this
 * point, so failures degrade to warnings + manual setup instructions.
 */
async function setupAutoBuild(
    actorName: string,
    repo: GitHubRepoRef,
    targetDir: string,
): Promise<AutoBuildResult> {
    if (!getToken()) {
        console.log(chalk.yellow('Warning: --auto-build on needs a logged-in Scrapely account to create the Actor. Run `scrapely login`, then `scrapely push`.'));
        return { ok: false, webhookRegistered: false, error: 'not-logged-in' };
    }

    const repoFullName = `${repo.workspace}/${repo.name}`;
    const client = getLoggedClientOrThrow();

    try {
        // 1. Create the platform Actor building from the Git repository
        console.log(chalk.gray(`Creating platform Actor "${actorName}" from ${repoFullName}...`));
        // Same version `scrapely push` will use, so later pushes update this version
        const versionNumber = getActorConfig(targetDir)?.version || '0.0';
        const actor = await client.actors().create({
            name: actorName,
            versions: [{
                versionNumber,
                sourceType: PlatformActorSourceType.GitRepo,
                gitRepoUrl: repo.url,
                buildTag: 'latest',
            }],
        });
        console.log(chalk.green(`  ✓ Actor created: ${actor.id}`));

        // Save the actorId to the actor config so future commands target it
        try {
            updateActorConfig(targetDir, { actorId: actor.id });
        } catch {
            console.log(chalk.yellow('  Warning: Could not save the actorId to the actor config.'));
        }

        // 2. Start the initial build (fire-and-forget — the actor is unusable without one)
        try {
            const build = await client.actor(actor.id).build(versionNumber, { tag: 'latest', waitForFinish: 0 });
            console.log(chalk.green(`  ✓ Initial build started: ${build.id}`));
        } catch (err) {
            console.log(chalk.yellow(`  Warning: Could not start the initial build (${(err as Error).message}). Run \`scrapely builds create\` later.`));
        }

        // 3. Register the CI webhook on the repository (auto-rebuild on push)
        try {
            const registration = await client.actor(actor.id).registerCiWebhook({ repoFullName });
            if (registration.manualSetupRequired) {
                printManualWebhookSetup(registration.webhookUrl, repoFullName);
                return { ok: true, actorId: actor.id, webhookRegistered: false, manualSetupRequired: true, webhookUrl: registration.webhookUrl };
            }
            console.log(chalk.green(`  ✓ Push webhook registered on ${repoFullName} — pushes now rebuild the Actor`));
            return { ok: true, actorId: actor.id, webhookRegistered: true };
        } catch {
            // Registration failed (GitHub not connected, missing admin rights, …) —
            // fall back to printing the webhook URL for manual setup.
            try {
                const info = await client.actor(actor.id).getCiWebhookUrl();
                printManualWebhookSetup(info?.webhookUrl, repoFullName);
                return { ok: true, actorId: actor.id, webhookRegistered: false, manualSetupRequired: true, webhookUrl: info?.webhookUrl };
            } catch {
                console.log(chalk.yellow(`  Warning: Could not register the push webhook on ${repoFullName}. Add it manually via:`));
                console.log(chalk.gray(`    scrapely api GET /v2/actors/${actor.id}/ci/webhook-url`));
                return { ok: true, actorId: actor.id, webhookRegistered: false, manualSetupRequired: true };
            }
        }
    } catch (err) {
        console.log(chalk.yellow(`Warning: Could not create the platform Actor (${(err as Error).message}).`));
        console.log(chalk.gray('  Create it later with `scrapely push`, then register the webhook from the Actor\'s CI/CD settings.'));
        return { ok: false, webhookRegistered: false, error: (err as Error).message };
    }
}

/**
 * Print the manual webhook setup fallback.
 */
function printManualWebhookSetup(webhookUrl: string | undefined, repoFullName: string): void {
    console.log(chalk.yellow(`  Could not register the webhook automatically on ${repoFullName}. Add it manually:`));
    console.log(chalk.gray('    GitHub repository → Settings → Webhooks → Add webhook'));
    console.log(chalk.gray('    Payload URL:'));
    if (webhookUrl) {
        console.log(chalk.gray(`      ${webhookUrl}`));
    }
    console.log(chalk.gray('    Content type: application/json, events: push'));
}

/**
 * create command - Create a new actor from a template
 */
/**
 * Guided template narrowing. When run interactively
 * without --use-case/--language, ask "what do you want to build?" and the
 * preferred language first, so the template list the user sees afterwards is
 * narrowed to relevant templates only. Flags pre-skip the prompts, and
 * non-TTY runs return the filters unchanged (straight to the template list).
 * Exported for testing.
 */
export async function resolveGuidedTemplateChoices(
    filters: { language?: string; useCase?: string },
    opts: {
        isTTY: boolean;
        askUseCase?: (choices: string[]) => Promise<string>;
        askLanguage?: (choices: string[]) => Promise<string>;
    },
): Promise<{ language?: string; useCase?: string }> {
    let { language, useCase } = filters;
    if (!opts.isTTY) return { language, useCase };

    const askUseCase = opts.askUseCase ?? (async (choices: string[]) => {
        const { pickedUseCase } = await inquirer.prompt([
            {
                type: 'list',
                name: 'pickedUseCase',
                message: 'What do you want to build?',
                choices,
            },
        ]);
        return pickedUseCase as string;
    });
    const askLanguage = opts.askLanguage ?? (async (choices: string[]) => {
        const { pickedLanguage } = await inquirer.prompt([
            {
                type: 'list',
                name: 'pickedLanguage',
                message: 'Which language do you prefer?',
                choices,
            },
        ]);
        return pickedLanguage as string;
    });

    if (!useCase && !language) {
        useCase = await askUseCase([...new Set(ACTOR_TEMPLATES.flatMap((t) => t.useCases))]);
    }
    if (!language) {
        const languageChoices = [...new Set(
            filterTemplatesByChoice(ACTOR_TEMPLATES, { useCase }).map((t) => t.language),
        )];
        // A single remaining language needs no question.
        if (languageChoices.length > 1) {
            language = await askLanguage(languageChoices);
        }
    }
    return { language, useCase };
}

export async function createCommand(actorName?: string, options?: { template?: string; language?: string; useCase?: string; json?: boolean; gitRepo?: string; source?: string; autoBuild?: string; skipDependencyInstall?: boolean; skipGitInit?: boolean; omitOptionalDeps?: boolean }): Promise<void> {
    const cwd = process.cwd();

    // Get actor name if not provided
    if (!actorName) {
        const { name } = await inquirer.prompt([
            {
                type: 'input',
                name: 'name',
                message: 'Actor name',
                default: 'my-actor',
                validate: validateActorName,
            },
        ]);
        actorName = name;
    }

    // Validate actor name (DNS-friendly + no path traversal)
    const validation = validateActorName(actorName!);
    if (validation !== true) {
        console.error(chalk.red(`Error: ${validation}`));
        process.exit(1);
    }
    try {
        validateFilename(actorName!);
    } catch (err) {
        console.error(chalk.red(`Error: Invalid actor name: ${(err as Error).message}`));
        process.exit(1);
    }

    // SECURITY: Resolve target directory within cwd
    let targetDir: string;
    try {
        targetDir = actorName ? safeResolve(cwd, actorName) : cwd;
    } catch (err) {
        console.error(chalk.red(`Error: Invalid target directory: ${(err as Error).message}`));
        process.exit(1);
    }

    // Check if directory already exists
    if (actorName && existsSync(targetDir)) {
        console.error(chalk.red(`Error: Directory "${actorName}" already exists.`));
        process.exit(1);
    }


    // Resolve where the actor source code will live (--source contract).
    // A --git-repo value in "workspace/name" (or bare name) form implies the
    // GitHub source; a full URL keeps the legacy behavior of cloning that URL.
    let requestedSource: ActorSourceType | undefined;
    if (options?.source) {
        const validatedSource = validateCreateSource(options.source);
        if (!validatedSource.ok) {
            console.error(chalk.red(`Error: ${validatedSource.error}`));
            if (validatedSource.hint) console.error(chalk.gray(validatedSource.hint));
            process.exit(1);
        }
        if (validatedSource.deprecatedAlias) {
            // stderr, so --json output stays parseable.
            console.error(chalk.yellow(`Warning: --source ${validatedSource.deprecatedAlias} is deprecated; use --source platform instead.`));
        }
        requestedSource = validatedSource.source;
    }
    if (requestedSource === 'platform' && options?.gitRepo) {
        console.error(chalk.red('Error: --git-repo can only be used with --source github.'));
        process.exit(1);
    }

    let sourceType: ActorSourceType = requestedSource ?? 'platform';
    if (sourceType !== 'github' && options?.gitRepo && !/^https?:\/\//i.test(options.gitRepo)) {
        sourceType = 'github';
    }

    // --auto-build (platform behavior): only meaningful for Git-backed actors.
    const autoBuildOn = sourceType === 'github' && options?.autoBuild === 'on';
    if (options?.autoBuild !== undefined) {
        if (options.autoBuild !== 'on' && options.autoBuild !== 'off') {
            console.error(chalk.red('Error: --auto-build must be either "on" or "off".'));
            process.exit(1);
        }
        if (sourceType !== 'github') {
            // Platform docs: "Only used when --source is a Git provider." — ignore
            // for platform-stored actors instead of failing the command.
            console.log(chalk.gray('Note: --auto-build only applies when --source is a Git provider; ignoring it.'));
        }
    }

    let githubRepo: GitHubRepoRef | null = null;
    if (sourceType === 'github') {
        let repoValue = options?.gitRepo;
        if (!repoValue) {
            const { repo } = await inquirer.prompt([
                {
                    type: 'input',
                    name: 'repo',
                    message: 'GitHub repository (workspace/name, name, or URL)',
                    validate: (input: string) => (input.trim().length > 0 ? true : 'Repository is required.'),
                },
            ]);
            repoValue = repo.trim();
        }
        githubRepo = await resolveGitHubRepo(repoValue!);
    }

    // Get the template to create from. Either a GitHub repository
    // (--source github), an explicit --git-repo URL, or one of the named
    // templates (optionally pre-filtered by language/use case).
    let template: { name: string; displayName: string; description: string; language: string; repoUrl: string; folder?: string; useCases?: string[] };
    let cloningExistingRepo = false;

    if (githubRepo && (await githubRepoHasContent(githubRepo.url))) {
        // Existing non-empty repository: clone it as-is, like the upstream CLI does for
        // --source github repos that already exist.
        if (options?.template) {
            console.error(chalk.red('Error: --template cannot be combined with an existing GitHub repository.'));
            process.exit(1);
        }
        if (options?.language) {
            console.error(chalk.red('Error: --language cannot be combined with an existing GitHub repository.'));
            process.exit(1);
        }
        if (options?.useCase) {
            console.error(chalk.red('Error: --use-case cannot be combined with an existing GitHub repository.'));
            process.exit(1);
        }
        cloningExistingRepo = true;
        template = {
            name: `${githubRepo.workspace}/${githubRepo.name}`,
            displayName: 'GitHub repository',
            description: 'Existing GitHub repository',
            language: 'unknown',
            repoUrl: githubRepo.url,
        };
    } else if (sourceType !== 'github' && options?.gitRepo) {
        // SECURITY: full URLs must be GitHub repositories; the canonical URL
        // built from validated parts is used, never the raw input.
        const parsedRepoUrl = parseGitHubRepoUrl(options.gitRepo);
        if (!parsedRepoUrl) {
            console.error(chalk.red('Error: --git-repo must be a valid GitHub repository URL (e.g., https://github.com/user/repo).'));
            process.exit(1);
        }
        if (options.template) {
            console.error(chalk.red('Error: --template and --git-repo cannot be combined.'));
            process.exit(1);
        }
        if (options.language) {
            console.error(chalk.red('Error: --language cannot be combined with --git-repo.'));
            process.exit(1);
        }
        if (options.useCase) {
            console.error(chalk.red('Error: --use-case cannot be combined with --git-repo.'));
            process.exit(1);
        }
        template = {
            name: parsedRepoUrl.url,
            displayName: 'GitHub repository',
            description: 'Custom GitHub repository',
            language: 'unknown',
            repoUrl: parsedRepoUrl.url,
        };
    } else {
        let templateName = options?.template;
        const language = normalizeTemplateLanguage(options?.language);
        const useCase = options?.useCase?.toLowerCase();

        // --language and --use-case only filter the template
        // CHOICE and are "Ignored when --template is provided" upstream. With
        // an explicit --template both filters are skipped entirely (e.g. the
        // ai-agent use case, which no Scrapely template supports, is accepted
        // alongside --template).
        const allTemplates = await getTemplates();
        let availableTemplates: ActorTemplate[] = [...allTemplates];
        if (!templateName) {
            // guided narrowing before the template list.
            const guided = await resolveGuidedTemplateChoices(
                { language, useCase },
                { isTTY: Boolean(process.stdout.isTTY) },
            );
            availableTemplates = filterTemplatesByChoice(allTemplates, guided);

            if (availableTemplates.length === 0) {
                const languages = [...new Set(ACTOR_TEMPLATES.map(t => t.language))].join(', ');
                const useCases = [...new Set(ACTOR_TEMPLATES.flatMap(t => t.useCases))].join(', ');
                console.error(chalk.red(`Error: No templates found${language ? ` for language "${language}"` : ''}${useCase ? ` with use case "${useCase}"` : ''}.`));
                console.log(chalk.gray(`Available languages: ${languages}`));
                console.log(chalk.gray(`Available use cases: ${useCases}`));
                if (language === 'python') {
                    console.log(chalk.gray('There are no Python templates. Create a Python actor from your own repository with --git-repo <url>.'));
                }
                process.exit(1);
            }

            const { selectedTemplate } = await inquirer.prompt([
                {
                    type: 'list',
                    name: 'selectedTemplate',
                    message: 'Select a template for your actor',
                    choices: availableTemplates.map(t => ({
                        name: `${t.displayName} - ${chalk.gray(t.description)}`,
                        value: t.name,
                    })),
                },
            ]);
            templateName = selectedTemplate;
        }

        const selected = findTemplateByName(allTemplates, templateName ?? '');
        if (!selected) {
            console.error(chalk.red(`Error: Template "${templateName}" not found${language && !availableTemplates.some(t => t.name === templateName) ? ` for language "${language}"` : ''}.`));
            console.log(chalk.gray('Available templates:'));
            for (const t of availableTemplates) {
                console.log(chalk.gray(`  - ${t.name}`));
            }
            process.exit(1);
        }
        template = selected;
    }

    // Create directory
    if (actorName !== '.') {
        mkdirSync(targetDir, { recursive: true });
    }

    console.log(chalk.gray(`Creating actor "${actorName}" from template "${template.name}"...`));

    // Download template from GitHub (or clone the existing repository directly)
    try {
        if (cloningExistingRepo) {
            console.log(chalk.gray(`Cloning ${template.repoUrl}...`));
            await cloneActorRepo(template.repoUrl, targetDir);
        } else if (template.folder) {
            console.log(chalk.gray(`Downloading template "${template.name}" from ${TEMPLATE_REPO_URL}...`));
            await downloadTemplateFromGitHub({ kind: 'folder', folder: template.folder }, targetDir);
        } else {
            // Custom --git-repo scaffold: copy the referenced repository itself
            console.log(chalk.gray(`Downloading ${template.repoUrl}...`));
            await downloadTemplateFromGitHub({ kind: 'repo', url: template.repoUrl }, targetDir);
        }
    } catch (err) {
        console.error(chalk.red(`Error downloading template: ${(err as Error).message}`));
        console.log(chalk.gray('Make sure you have git installed and internet access.'));
        process.exit(1);
    }

    // For repository-based actors, detect the language after download so the
    // summary and dependency-install step behave like named templates
    if (template.language === 'unknown') {
        if (existsSync(join(targetDir, 'tsconfig.json'))) {
            template.language = 'typescript';
        } else if (existsSync(join(targetDir, 'package.json'))) {
            template.language = 'javascript';
        } else if (existsSync(join(targetDir, 'pyproject.toml')) || existsSync(join(targetDir, 'requirements.txt'))) {
            template.language = 'python';
        }
    }

    // Update configuration files with actor name
    updatePackageJson(targetDir, actorName!);
    updatePythonModule(targetDir, actorName!);
    createScrapelyJson(targetDir, actorName!);

    // Create .gitignore
    const gitignorePath = join(targetDir, '.gitignore');
    if (!existsSync(gitignorePath)) {
        writeFileSync(gitignorePath, `node_modules/
storage/
dist/
.env
.scrapely/
__pycache__/
*.pyc
.venv/
venv/
`);
    }

    // Create .actorignore
    const actorignorePath = join(targetDir, '.actorignore');
    if (!existsSync(actorignorePath)) {
        writeFileSync(actorignorePath, `# Files to exclude from actor push
node_modules/
.git/
storage/
dist/
.env
*.log
.DS_Store
__pycache__/
*.pyc
.venv/
venv/
`);
    }

    console.log(chalk.green(`\n✓ Actor "${actorName}" created successfully!`));
    console.log(chalk.gray(`  Template: ${template.displayName}`));
    console.log(chalk.gray(`  Language: ${template.language}`));
    console.log(chalk.gray(`  Source: ${sourceType === 'github' ? `GitHub (${githubRepo!.workspace}/${githubRepo!.name})` : 'Scrapely platform'}`));
    console.log(chalk.gray(`  Location: ${targetDir}`));

    if (options?.json && !autoBuildOn) {
        console.log(JSON.stringify({
            name: actorName,
            template: template.name,
            language: template.language,
            source: sourceType,
            ...(githubRepo ? { gitRepoUrl: githubRepo.url } : {}),
            location: targetDir,
        }, null, 2));
        return;
    }

    // Initialize git repository / connect the GitHub remote
    if (!options?.skipGitInit) {
        try {
            console.log(chalk.gray('\nInitializing git repository...'));
            if (!cloningExistingRepo) {
                await execFileAsync('git', ['init'], { cwd: targetDir });
            }
            await execFileAsync('git', ['add', '.'], { cwd: targetDir });
            try {
                await execFileAsync('git', ['commit', '-m', 'Initial commit'], { cwd: targetDir });
            } catch {
                console.log(chalk.yellow('Warning: Could not create the initial commit (is git user.name/user.email configured?).'));
            }
            if (cloningExistingRepo) {
                console.log(chalk.green('✓ Git repository ready (cloned from GitHub)'));
            } else {
                console.log(chalk.green('✓ Git repository initialized'));
            }
            if (githubRepo && !cloningExistingRepo) {
                // Create the GitHub repository from the template and push to it
                // (--source github behavior).
                console.log(chalk.gray(`Creating GitHub repository ${githubRepo.workspace}/${githubRepo.name}...`));
                const pushed = await pushToGitHubRepo(githubRepo, targetDir);
                if (pushed) {
                    console.log(chalk.green(`✓ GitHub repository ${githubRepo.workspace}/${githubRepo.name} created and pushed`));
                } else {
                    console.log(chalk.yellow('Warning: Could not create or push the GitHub repository. Create it manually, then run:'));
                    console.log(chalk.gray(`  git remote add origin ${githubRepo.url}`));
                    console.log(chalk.gray('  git push -u origin HEAD'));
                }
            }
        } catch (err) {
            console.log(chalk.yellow('Warning: Could not initialize git repository.'));
        }
    } else if (githubRepo && !cloningExistingRepo) {
        console.log(chalk.yellow('Warning: --skip-git-init was used, the GitHub repository was not created or pushed.'));
    }

    // --auto-build on (platform behavior): create the platform Actor from the
    // repository and register the CI webhook so pushes rebuild it.
    let autoBuildResult: AutoBuildResult | null = null;
    if (autoBuildOn && githubRepo) {
        autoBuildResult = await setupAutoBuild(actorName!, githubRepo, targetDir);
    }

    if (options?.json) {
        console.log(JSON.stringify({
            name: actorName,
            template: template.name,
            language: template.language,
            source: sourceType,
            ...(githubRepo ? { gitRepoUrl: githubRepo.url } : {}),
            location: targetDir,
            ...(autoBuildResult ? { autoBuild: autoBuildResult } : {}),
        }, null, 2));
        return;
    }

    // Install dependencies
    if (!options?.skipDependencyInstall && (template.language === 'javascript' || template.language === 'typescript')) {
        try {
            console.log(chalk.gray('\nInstalling dependencies...'));
            const npmInstallArgs = options?.omitOptionalDeps ? ['install', '--omit=optional'] : ['install'];
            await execFileAsync('npm', npmInstallArgs, { cwd: targetDir });
            console.log(chalk.green('✓ Dependencies installed'));
        } catch (err) {
            console.log(chalk.yellow('Warning: Could not install dependencies. Run `npm install` manually.'));
        }
    }

    console.log(chalk.gray('\nNext steps:'));
    if (actorName !== '.') {
        console.log(chalk.gray(`  cd ${actorName}`));
    }
    if (autoBuildResult?.ok && autoBuildResult.actorId) {
        // Platform Actor already exists (created by --auto-build on) — pushing
        // would overwrite its Git-backed source with local files.
        console.log(chalk.gray('  git commit && git push   (pushes rebuild the Actor automatically)'));
        console.log(chalk.gray(`  scrapely call ${autoBuildResult.actorId}`));
    } else {
        console.log(chalk.gray('  scrapely push'));
        console.log(chalk.gray('  scrapely run'));
    }
}

/**
 * Set up the create command
 */
export function setupCreateCommand(program: Command): void {
    program
        .command('create [actorName]')
        .description('Create an actor project from a template in a new directory. Interactive: prompts for the actor name, use case, language and template when not provided; pass --template (or --use-case/--language) and the name to run non-interactively')
        .option('-t, --template <template>', 'Template for the actor (e.g., crawlee-cheerio-js, crawlee-playwright, crawlee-puppeteer-chrome, crawlee-playwright-ts; legacy aliases such as crawlee-playwright-js still resolve)')
        .option('-l, --language <language>', 'Filter templates by language (javascript|js, typescript|ts)')
        .option('-u, --use-case <useCase>', 'Filter templates by use case (web-scraper, ai-agent, browser-automation, data-pipeline). Ignored when --template is provided.')
        .option('--json', 'Print the created actor details as JSON')
        .option('--source <source>', 'Where the actor source code will live: "platform" (default, stored on the Scrapely platform) or "github" (kept in a GitHub repository created from the template). "apify" is a deprecated alias of "platform". "gitlab" and "bitbucket" are accepted for CLI compatibility but are not supported on Scrapely yet')
        .option('--git-repo <repo>', 'GitHub repository, as "workspace/name" — a bare value is read as the name, not the workspace. Used with --source github; a full repository URL is also accepted')
        .option('--auto-build <on|off>', 'Whether a push to the repository rebuilds the actor. With "on" (and --source github), the CLI creates the platform Actor from the repository, starts its initial build, and registers a push webhook on it (requires the GitHub integration with admin rights to the repo; falls back to printing the webhook URL for manual setup)')
        .option('--skip-dependency-install', 'Skip installing dependencies')
        .option('--skip-git-init', 'Skip initializing a git repository')
        .option('--omit-optional-deps', 'Skip installing optional dependencies')
        .action((actorName, options) => createCommand(actorName, options));
}