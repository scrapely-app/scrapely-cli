import chalk from 'chalk';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs';
import { dirname, isAbsolute, join, resolve, sep } from 'path';
import { getToken, getActorConfig } from '../config.js';
import { getLoggedClientOrThrow } from '../client.js';

const execFileAsync = promisify(execFile);

/**
 * Validate a file name from an API response to prevent path traversal.
 *
 * Names may contain relative subpaths ("src/main.js") — exactly what `push`
 * uploads — but must resolve INSIDE outputDir: no absolute paths, no `..`
 * segments, no Windows drive letters, no null bytes.
 */
export function safeFilePath(outputDir: string, fileName: string): string {
    if (!fileName || fileName.includes('\0')) {
        throw new Error(`Invalid file name: "${fileName}"`);
    }

    // Normalize separators and collapse redundant "./" segments
    const normalized = fileName.replace(/\\/g, '/').split('/').filter((part) => part && part !== '.').join('/');

    // Reject absolute paths ("/etc/x"), Windows drive letters ("C:/x") and traversal ("../x")
    if (isAbsolute(fileName) || /^[a-zA-Z]:/.test(fileName) || normalized.split('/').includes('..')) {
        throw new Error(`Invalid file name: "${fileName}" - path traversal is not allowed`);
    }
    if (!normalized) {
        throw new Error(`Invalid file name: "${fileName}"`);
    }

    // Belt and braces: the resolved path must stay inside the output directory
    const base = resolve(outputDir);
    const target = resolve(base, normalized);
    if (target !== base && !target.startsWith(base + sep)) {
        throw new Error(`Invalid file name: "${fileName}" - resolves outside the target directory`);
    }
    return target;
}

/**
 * Git URL forms the CLI is willing to clone. Anything else is rejected —
 * notably `ext::sh -c ...` style git "URLs", which execute commands, and the
 * unauthenticated http:// and git:// transports.
 */
export function isSafeGitUrl(url: string): boolean {
    return /^https:\/\/[\w.@:/~-]+(?:\?[^\s]*)?$/.test(url)
        || /^git@[\w.-]+:[\w./~-]+$/.test(url)
        || /^ssh:\/\/git@[\w.-]+(?:\/[\w./~-]+)?$/.test(url);
}

/**
 * Strip userinfo (user:token@) from HTTPS URLs before printing. The server
 * stores and returns repo URLs with embedded credentials intact, so anything
 * logged to the terminal / CI logs must be redacted first.
 */
export function redactGitUrlCredentials(text: string): string {
    return text.replace(/(https?:\/\/)[^/@\s]*@/g, '$1');
}

/**
 * Parsed GitHub tree URL (https://github.com/owner/repo/tree/branch/folder).
 * The server accepts these as a GIT_REPO source but stores and returns the
 * ORIGINAL tree URL — git can only clone the repository itself, never the
 * /tree/<branch>/<folder> subpath — so pull must split the URL before cloning.
 * Mirrors the server's parseGitHubUrl behavior.
 */
export interface GitHubTreeUrl {
    repoUrl: string;
    branch: string;
    folder?: string;
}

export function parseGitHubTreeUrl(url: string): GitHubTreeUrl | null {
    const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/tree\/([^/]+)(?:\/(.+))?$/);
    if (!match) {
        // Not a GitHub tree URL — pass-through case
        return null;
    }
    const [, owner, repo, branch, folderPath] = match;
    return {
        repoUrl: `https://github.com/${owner}/${repo}.git`,
        branch,
        folder: folderPath || undefined,
    };
}

/**
 * Effective clone parameters for a version's Git source. Branch/folder embedded
 * in a tree URL win over the separate version fields (same precedence the
 * server uses when it clones: parsed?.gitBranch ?? v.gitBranch).
 */
export function normalizeGitSource(
    repoUrl: string,
    branch?: string | null,
    folder?: string | null,
): { repoUrl: string; branch?: string; folder?: string } {
    const parsed = parseGitHubTreeUrl(repoUrl);
    if (parsed) {
        return {
            repoUrl: parsed.repoUrl,
            branch: parsed.branch || branch || undefined,
            folder: parsed.folder || folder || undefined,
        };
    }
    return { repoUrl, branch: branch || undefined, folder: folder || undefined };
}

/** Repository directory name derived from a git URL ("owner/repo.git" -> "repo"). */
export function repoNameFromUrl(url: string): string {
    const cleaned = url.replace(/\/+$/, '').replace(/\.git$/, '');
    const last = cleaned.split('/').pop()?.trim();
    return last || 'actor';
}

/**
 * Where `git clone` should write the working tree: the requested directory
 * when it is empty or missing, or a repo-named subdirectory otherwise (git
 * refuses to clone into a non-empty directory).
 */
export function resolveCloneTarget(outputDir: string, repoUrl: string): string {
    let empty = true;
    try {
        empty = !existsSync(outputDir) || readdirSync(outputDir).length === 0;
    } catch {
        empty = true;
    }
    return empty ? outputDir : join(outputDir, repoNameFromUrl(repoUrl));
}

/**
 * Split userinfo (user:token@) off an HTTPS clone URL. The credentials go to
 * git as an Authorization header through GIT_CONFIG_* env vars, so they never
 * appear in process arguments or in the clone's saved origin URL.
 */
export function splitGitUrlCredentials(repoUrl: string): { repoUrl: string; env: Record<string, string> } {
    const match = repoUrl.match(/^(https:\/\/)([^/@\s]*)@(.*)$/);
    if (!match || !match[2]) return { repoUrl, env: {} };
    const [, scheme, userinfo, rest] = match;
    const sep = userinfo.indexOf(':');
    const user = decodeURIComponent(sep === -1 ? userinfo : userinfo.slice(0, sep));
    const password = sep === -1 ? '' : decodeURIComponent(userinfo.slice(sep + 1));
    const basic = Buffer.from(`${user}:${password}`, 'utf-8').toString('base64');
    return {
        repoUrl: `${scheme}${rest}`,
        env: {
            GIT_CONFIG_COUNT: '1',
            // Scoped to the repo's host so a redirect elsewhere never receives it.
            GIT_CONFIG_KEY_0: `http.${scheme}${rest.split('/')[0]}/.extraHeader`,
            GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
        },
    };
}

/** Git config that only allows the https and ssh transports. */
export const SAFE_GIT_PROTOCOLS = [
    '-c', 'protocol.allow=never',
    '-c', 'protocol.https.allow=always',
    '-c', 'protocol.ssh.allow=always',
];

/** Build the `git clone` argument vector (execFile, never a shell string). */
export function buildCloneArgs(repoUrl: string, branch: string | undefined, targetDir: string): string[] {
    return [
        'clone',
        ...(branch ? ['--branch', branch] : []),
        repoUrl,
        targetDir,
    ];
}

/**
 * Pull a GIT_REPO-sourced actor version by cloning its repository, like
 * the upstream CLI does for Git-sourced actors. Only the actor owner can do this
 * (the server redacts gitRepoUrl for non-owners).
 */
async function pullGitSource(options: {
    repoUrl: string;
    branch?: string | null;
    folder?: string | null;
    outputDir: string;
    actorName: string;
    versionNumber: string;
}): Promise<void> {
    const { outputDir, actorName, versionNumber } = options;

    // The server returns the original GitHub tree URL for versions created from
    // one; git cannot clone a /tree/<branch>/<folder> subpath, so split it first.
    const { repoUrl, branch, folder } = normalizeGitSource(options.repoUrl, options.branch, options.folder);

    if (!isSafeGitUrl(repoUrl)) {
        console.error(chalk.red(`Refusing to clone unsupported git URL: ${redactGitUrlCredentials(repoUrl)}`));
        console.error(chalk.gray('Only https://, ssh:// and git@host: URLs are allowed.'));
        process.exit(1);
    }

    const { repoUrl: cloneUrl, env: credentialEnv } = splitGitUrlCredentials(repoUrl);
    const target = resolveCloneTarget(outputDir, cloneUrl);
    mkdirSync(dirname(target), { recursive: true });

    console.log(chalk.gray(`  Cloning ${redactGitUrlCredentials(repoUrl)}${branch ? ` (branch ${branch})` : ''} into ${target}...\n`));

    try {
        // Restrict git itself to authenticated transports too (redirects, submodules).
        await execFileAsync('git', [...SAFE_GIT_PROTOCOLS, ...buildCloneArgs(cloneUrl, branch ?? undefined, target)], {
            env: { ...process.env, ...credentialEnv },
        });
    } catch (err) {
        const e = err as { code?: string; stderr?: string; message?: string };
        if (e.code === 'ENOENT') {
            console.error(chalk.red('Error: git executable not found. Install git to pull Git-sourced actors.'));
            process.exit(1);
        }
        console.error(chalk.red('Error: git clone failed.'));
        if (e.stderr) console.error(chalk.gray(redactGitUrlCredentials(e.stderr.trim())));
        console.error(chalk.gray('For private repositories, make sure you have access (e.g. via ssh-agent or a credential helper).'));
        process.exit(1);
    }

    console.log(chalk.green(`\n✓ Cloned ${actorName}@${versionNumber} from ${redactGitUrlCredentials(repoUrl)}`));
    if (target !== outputDir) {
        console.log(chalk.gray(`  Directory was not empty — cloned into: ${target}`));
    }
    if (folder) {
        console.log(chalk.gray(`  Note: the actor source lives in the "${folder}" subfolder of this repository (the whole repository was cloned).`));
    }
}

/**
 * Resolve which actor to pull: explicit argument first, then the local
 * actor config (actorId, falling back to name) so `scrapely pull` can be
 * run from inside an actor directory, like the upstream CLI does.
 */
function resolveActorToPull(actorId?: string): { actorId: string; source: string } {
    if (actorId) {
        return { actorId, source: 'argument' };
    }

    const actorConfig = getActorConfig(process.cwd());
    if (actorConfig?.actorId) {
        return { actorId: actorConfig.actorId, source: 'actorId from local actor config' };
    }
    if (actorConfig?.name) {
        return { actorId: actorConfig.name, source: 'name from local actor config' };
    }

    console.error(chalk.red('No actor specified and no local actor config found.'));
    console.log(chalk.gray('Pass an actor ID/name, or run this command inside a directory with an actor config (.actor/actor.json, .actor/scrapely.json or scrapely.json):'));
    console.log(chalk.gray('  scrapely pull [actorId]'));
    process.exit(1);
}

interface PulledSourceFile {
    name: string;
    format?: string;
    content: string;
}

interface PulledVersion {
    sourceType?: string;
    sourceFiles?: PulledSourceFile[];
    gitRepoUrl?: string | null;
    gitBranch?: string | null;
    gitFolder?: string | null;
}

export async function pullCommand(actorId: string | undefined, options?: { version?: string; dir?: string }): Promise<void> {
    const token = getToken();
    if (!token) {
        console.error(chalk.red('Not logged in. Run `scrapely login` first.'));
        process.exit(1);
    }

    const resolved = resolveActorToPull(actorId);
    if (resolved.source !== 'argument') {
        console.log(chalk.gray(`Using ${resolved.source}: ${resolved.actorId}`));
    }

    console.log(chalk.gray(`\nFetching actor ${resolved.actorId}...`));

    const client = getLoggedClientOrThrow();
    const actor = await client.actor(resolved.actorId).get();
    if (!actor) {
        console.error(chalk.red('Actor not found'));
        process.exit(1);
    }

    const versions = actor.versions || [];
    if (versions.length === 0) {
        // Versions (source) are owner-only: other users get an empty list
        const me = (await client.user().get().catch(() => undefined)) as { id?: string } | undefined;
        const ownsActor = !me?.id || (actor as { userId?: string }).userId === me.id;
        console.error(chalk.red(ownsActor ? 'Actor has no versions' : 'Only the actor owner can pull its source'));
        process.exit(1);
    }

    const latestVersionNumber = versions[versions.length - 1]?.versionNumber;
    const versionNumber = options?.version ?? latestVersionNumber;
    if (!versionNumber) {
        console.error(chalk.red('Could not determine which version to pull'));
        process.exit(1);
    }
    console.log(chalk.gray(`  Version: ${versionNumber}`));

    const version = (await client.actor(resolved.actorId).version(versionNumber).get()) as unknown as PulledVersion | undefined;
    if (!version) {
        console.error(chalk.red(`Version ${versionNumber} not found`));
        process.exit(1);
    }

    const outputDir = options?.dir || process.cwd();

    // Git-sourced actor: clone the repository (owner-only; the server hides
    // the repo URL from non-owners).
    if (version.sourceType === 'GIT_REPO') {
        if (!version.gitRepoUrl) {
            console.error(chalk.red('Cannot pull: the Git repository URL is not available for your account.'));
            console.error(chalk.gray('Only the actor owner can pull Git-sourced actors (the repository URL is hidden from other users).'));
            process.exit(1);
        }
        await pullGitSource({
            repoUrl: version.gitRepoUrl,
            branch: version.gitBranch,
            folder: version.gitFolder,
            outputDir,
            actorName: actor.name,
            versionNumber,
        });
        return;
    }

    if (version.sourceType !== 'SOURCE_FILES' || !version.sourceFiles?.length) {
        console.error(chalk.red(`Cannot pull: source type is ${version.sourceType}, not SOURCE_FILES`));
        process.exit(1);
    }

    const files = version.sourceFiles;

    console.log(chalk.gray(`  Writing ${files.length} files to ${outputDir}...\n`));

    for (const file of files) {
        // SECURITY: validate file names from API to prevent path traversal
        const filePath = safeFilePath(outputDir, file.name);
        const dir = dirname(filePath);

        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }

        // `push` uploads binaries as BASE64 records — decode them back to bytes
        if (file.format === 'BASE64') {
            writeFileSync(filePath, Buffer.from(file.content, 'base64'));
        } else {
            writeFileSync(filePath, file.content);
        }
        console.log(chalk.gray(`    ${file.name}`));
    }

    console.log(chalk.green(`\n✓ Pulled ${files.length} files from ${actor.name}@${versionNumber}`));
}
