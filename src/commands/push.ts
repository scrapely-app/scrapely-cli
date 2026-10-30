import chalk from 'chalk';
import { spawn } from 'child_process';
import { readdirSync, statSync, lstatSync } from 'fs';
import { join, relative, resolve, sep } from 'path';
import ignore from 'ignore';
import archiver from 'archiver';
import inquirer from 'inquirer';
import { getToken, getLocalConfig, getActorConfig, findActorConfig, updateActorConfig, getSecrets, getWebBaseUrl } from '../config.js';
import { getLoggedClientOrThrow } from '../client.js';
import { stdoutSafeText, terminalJson, terminalSafeLine } from '../utils/terminal.js';
import { ActorSourceType, type ActorVersionSourceFile, type ScrapelyClient } from 'scrapely-client';
import { readFileNoFollowWithin } from '../utils/pathValidation.js';


/**
 * Collect files from a directory, respecting .gitignore and .actorignore patterns.
 * Uses the 'ignore' package for proper gitignore-style pattern matching.
 */
function collectFiles(dir: string, base: string = dir): { name: string; format: string; content: string }[] {
    const files: { name: string; format: string; content: string }[] = [];
    const resolvedBase = resolve(base);
    
    // Create ignore filter from .gitignore and .actorignore
    const ig = ignore();
    
    // Add default ignores (always excluded)
    ig.add([
        'node_modules',
        '.git',
        'storage',
        'dist',
        '.env',
        '.DS_Store',
        '*.log',
        '.scrapely',
    ]);
    
    // Read .gitignore / .actorignore if they exist (never through a symlink)
    for (const ignoreFile of ['.gitignore', '.actorignore']) {
        try {
            ig.add(readFileNoFollowWithin(dir, ignoreFile).toString('utf-8'));
        } catch {
            // Missing, a symlink, or unreadable — ignore
        }
    }
    
    // Collect all files recursively
    const allFiles: string[] = [];
    
    function walkDir(currentDir: string) {
        // SECURITY: Do not walk outside the base directory
        const resolvedCurrent = resolve(currentDir);
        if (resolvedCurrent !== resolvedBase && !resolvedCurrent.startsWith(resolvedBase + sep)) {
            return;
        }

        for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
            // Skip symlink entries to avoid following out of tree
            const fullPath = join(currentDir, entry.name);
            try {
                if (lstatSync(fullPath).isSymbolicLink()) {
                    continue;
                }
            } catch {
                continue;
            }

            const relPath = relative(base, fullPath);
            if (!relPath || relPath.startsWith('..')) {
                continue;
            }
            
            if (entry.isDirectory()) {
                // Check if directory should be ignored
                if (!ig.ignores(relPath + '/')) {
                    walkDir(fullPath);
                }
            } else {
                allFiles.push(relPath);
            }
        }
    }
    
    walkDir(dir);
    
    // Filter using ignore and read file contents
    const filteredFiles = ig.filter(allFiles);
    
    for (const relPath of filteredFiles) {
        // SECURITY: Re-validate each path and read it without following symlinks
        // anywhere in the path (also catches entries swapped to a symlink since the walk)
        try {
            const content = readFileNoFollowWithin(base, relPath);
            const isBinary = content.includes(0x00);
            
            files.push({
                name: relPath,
                format: isBinary ? 'BASE64' : 'TEXT',
                content: isBinary ? content.toString('base64') : content.toString('utf-8'),
            });
        } catch {
            // Skip files that can't be read
        }
    }

    return files;
}

/** projects above this total size upload as a single ZIP archive. */
const ZIP_FALLBACK_THRESHOLD_BYTES = 3 * 1024 * 1024;
const ZIP_ENTRY_NAME = 'source_files.zip';

/** Total decoded size of the collected source files, in bytes. */
function totalSourceBytes(files: { format: string; content: string }[]): number {
    return files.reduce(
        (sum, f) => sum + (f.format === 'BASE64' ? Buffer.from(f.content, 'base64').length : Buffer.byteLength(f.content, 'utf-8')),
        0,
    );
}

/**
 * Newest mtime among the collected source files, for the remote-newer guard.
 * Computed from the REAL file list BEFORE the >3MB ZIP fallback replaces it
 * with a synthetic `source_files.zip` entry (built in memory, never written to
 * disk) — otherwise the guard would stat a nonexistent file and always see
 * `newestLocalMs === 0`, rejecting every update push of a large project.
 */
function newestSourceMtimeMs(cwd: string, files: { name: string }[]): number {
    let newestMs = 0;
    for (const f of files) {
        try {
            const mtimeMs = statSync(join(cwd, f.name)).mtimeMs;
            if (mtimeMs > newestMs) newestMs = mtimeMs;
        } catch {
            // File vanished between collect and check — ignore
        }
    }
    return newestMs;
}

/**
 * Zip the collected files in memory into a single archive buffer. The API
 * expands the ZIP back into per-file entries on ingest, so builds and
 * `scrapely pull` see the same files as a non-zipped push.
 */
function zipSourceFiles(files: { name: string; format: string; content: string }[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const archive = archiver('zip', { zlib: { level: 9 } });
        const chunks: Buffer[] = [];
        archive.on('data', (chunk: Buffer) => chunks.push(chunk));
        archive.on('end', () => resolve(Buffer.concat(chunks)));
        archive.on('error', reject);
        for (const f of files) {
            archive.append(
                f.format === 'BASE64' ? Buffer.from(f.content, 'base64') : Buffer.from(f.content, 'utf-8'),
                { name: f.name },
            );
        }
        void archive.finalize();
    });
}


/**
 * Poll a build until it reaches a terminal status.
 *
 * SECURITY/correctness note: we poll the exact build ID returned by the build
 * create call — never a build resolved by listing the actor's builds, which
 * can match an unrelated concurrent build (the bug that got the original
 * `push --wait-for-finish` removed).
 */
async function waitForBuild(client: ScrapelyClient, buildId: string, timeoutSecs?: number): Promise<{ id: string; status: string } | null> {
    const POLL_INTERVAL_MS = 2000;
    // an optional timeout on the wait. `null` is returned when
    // the wait elapses with the build still running (outcome unknown — the
    // command exits 0 in that case).
    const deadline = timeoutSecs !== undefined && timeoutSecs > 0 ? Date.now() + timeoutSecs * 1000 : null;

    for (;;) {
        const build = (await client.build(buildId).get()) as { id: string; status: string } | undefined;
        if (!build) {
            throw new Error(`Failed to get build status: ${buildId} not found`);
        }
        if (build.status !== 'RUNNING' && build.status !== 'QUEUED') {
            return build;
        }
        if (deadline && Date.now() + POLL_INTERVAL_MS > deadline) {
            return null;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
}

/**
 * Print the build log (best effort) — used when a build fails so the user sees
 * the compile error without running a second command.
 */
export async function printBuildLog(client: ScrapelyClient, buildId: string): Promise<void> {
    try {
        const log = await client.build(buildId).log().get();
        console.log(chalk.gray('\nBuild log:'));
        console.log(typeof log === 'string' ? stdoutSafeText(log) : terminalJson(JSON.stringify(log, null, 2)));
    } catch {
        console.log(chalk.gray(`  (log unavailable — run \`scrapely builds log ${terminalSafeLine(buildId)}\`)`));
    }
}

/**
 * Open a URL in the user's default browser (best effort, no extra dependency:
 * uses the platform opener). Falls back to printing the URL when spawning the
 * opener is not possible.
 */
function openInBrowser(url: string): void {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    try {
        const child = spawn(opener, args, { stdio: 'ignore', detached: true });
        child.on('error', () => {
            console.log(chalk.gray(`  Actor details: ${terminalSafeLine(url)}`));
        });
        child.unref();
        console.log(chalk.gray(`  Opening ${terminalSafeLine(url)}`));
    } catch {
        console.log(chalk.gray(`  Actor details: ${terminalSafeLine(url)}`));
    }
}

/**
 * Interactive remote-newer guard (asks before
 * switching a newer/git-sourced remote to local files instead of failing
 * outright). Returns true when the push should proceed. Non-TTY runs always
 * return false so scripts and CI keep the hard error + `--force` hint.
 * Exported for testing.
 */
export async function confirmPushAnyway(
    detail: string,
    opts: { isTTY: boolean; ask?: (message: string) => Promise<boolean> },
): Promise<boolean> {
    if (!opts.isTTY) return false;
    const ask = opts.ask ?? (async (message: string) => {
        const { answer } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'answer',
                message,
                default: false,
            },
        ]);
        return answer;
    });
    return ask(`${detail} Push anyway?`);
}

export async function pushCommand(options?: { 
    actorId?: string; 
    version?: string; 
    buildTag?: string;
    force?: boolean;
    allowMissingSecrets?: boolean;
    dir?: string;
    open?: boolean;
    json?: boolean;
    /** seconds to wait for the build. 0 = fire-and-forget; undefined = wait indefinitely. */
    waitForFinish?: number;
}): Promise<void> {
    // --json: suppress human-readable progress output; print a single JSON
    // result object at the end instead.
    const jsonMode = options?.json === true;
    const log = (...args: Parameters<typeof console.log>): void => {
        if (!jsonMode) console.log(...args);
    };

    const token = getToken();
    if (!token) {
        console.error(chalk.red('Not logged in. Run `scrapely login` first.'));
        process.exit(1);
    }

    const cwd = options?.dir || process.cwd();
    const localConfig = getLocalConfig(cwd);

    if (!localConfig) {
        console.error(chalk.red('No package.json found. Run `scrapely init` first.'));
        process.exit(1);
    }

    // --allow-missing-secrets: validate `@secretName` references in the actor
    // config's environment variables (mirrors `scrapely run`).
    const actorConfig = getActorConfig(cwd);
    const envVars = actorConfig?.environmentVariables;
    if (envVars && Object.keys(envVars).length > 0) {
        const secrets = getSecrets();
        const missing: string[] = [];
        for (const [key, value] of Object.entries(envVars)) {
            if (typeof value === 'string' && value.startsWith('@') && !secrets[value.substring(1)]) {
                missing.push(`${key} (@${value.substring(1)})`);
            }
        }
        if (missing.length > 0) {
            const detail = `Missing secrets used by environment variables: ${missing.join(', ')}. `
                + 'Add them with `scrapely secrets add <name> <value>` or pass --allow-missing-secrets.';
            if (options?.allowMissingSecrets) {
                console.warn(chalk.yellow(`Warning: ${terminalSafeLine(detail)}`));
            } else {
                console.error(chalk.red(`Error: ${terminalSafeLine(detail)}`));
                process.exit(1);
            }
        }
    }

    const version = options?.version || localConfig.version || '0.0.1';
    const buildTag = options?.buildTag || actorConfig?.buildTag || 'latest';
    log(chalk.gray(`\nCollecting files from ${terminalSafeLine(cwd)}...`));

    let sourceFiles = collectFiles(cwd);
    log(chalk.gray(`  Found ${sourceFiles.length} files`));

    // Newest local mtime for the remote-newer guard — computed from the real
    // file list, before the ZIP fallback below replaces it.
    const newestLocalMs = newestSourceMtimeMs(cwd, sourceFiles);

    for (const f of sourceFiles) {
        const size = Buffer.byteLength(f.content, f.format === 'BASE64' ? 'base64' : 'utf-8');
        log(chalk.gray(`    ${terminalSafeLine(f.name)} (${(size / 1024).toFixed(1)}KB)`));
    }

    // projects larger than 3 MB upload as a single ZIP archive
    // to stay under request-size limits (the API expands it on ingest).
    if (sourceFiles.length > 1 && totalSourceBytes(sourceFiles) > ZIP_FALLBACK_THRESHOLD_BYTES) {
        log(chalk.gray(`  Total exceeds 3MB — uploading as a single ZIP archive`));
        const zipContent = await zipSourceFiles(sourceFiles);
        sourceFiles = [{ name: ZIP_ENTRY_NAME, format: 'ZIP', content: zipContent.toString('base64') }];
    }

    let actorId = options?.actorId || localConfig.actorId;

    const client = getLoggedClientOrThrow();

    // Check if actor exists (client.actor().get() resolves undefined on 404, it does not throw)
    if (actorId) {
        try {
            const existing = await client.actor(actorId).get();
            if (existing) {
                // -f/--force: refuse to overwrite a remote actor that is newer
                // than every local source file (CLI convention).
                if (!options?.force) {
                    const remoteModified = (existing as { modifiedAt?: Date | string }).modifiedAt;
                    const remoteMs = remoteModified ? new Date(remoteModified).getTime() : NaN;
                    if (!Number.isNaN(remoteMs) && remoteMs > 0) {
                        // newestLocalMs comes from the ORIGINAL collected files
                        // (precomputed before the >3MB ZIP transport fallback),
                        // so the guard keeps working for zipped pushes too.
                        if (remoteMs > newestLocalMs) {
                            const detail = `Actor ${actorId} on the platform is newer than the local files `
                                + `(remote modified ${new Date(remoteMs).toISOString()}, newest local file ${new Date(newestLocalMs).toISOString()}).`;
                            // ask instead of failing outright.
                            // Non-TTY runs (and --json) keep the hard error with
                            // the --force hint, so scripts and CI are unaffected.
                            const proceed = !jsonMode
                                && await confirmPushAnyway(terminalSafeLine(detail), { isTTY: Boolean(process.stdout.isTTY) });
                            if (!proceed) {
                                console.error(chalk.red(`Error: ${terminalSafeLine(detail)}`));
                                console.error(chalk.gray('Pass --force to push anyway.'));
                                process.exit(1);
                            }
                            log(chalk.gray('  Pushing anyway (remote is newer than local files).'));
                        }
                    }
                }
                log(chalk.gray(`  Updating actor ${terminalSafeLine(actorId)}...`));
            } else {
                log(chalk.gray(`  Actor ${terminalSafeLine(actorId)} not found, creating new...`));
                actorId = undefined;
            }
        } catch (err) {
            console.error(chalk.red(`Error: Failed to check actor ${terminalSafeLine(actorId)}.`));
            console.error(chalk.gray(`Details: ${terminalSafeLine((err as Error).message)}`));
            process.exit(1);
        }
    }

    if (!actorId) {
        log(chalk.gray(`  Creating actor "${terminalSafeLine(localConfig.name)}"...`));
        try {
            const actor = await client.actors().create({
                name: localConfig.name,
                ...(actorConfig?.title ? { title: actorConfig.title } : {}),
                ...(localConfig.description ? { description: localConfig.description } : {}),
                versions: [{
                    versionNumber: version,
                    sourceType: ActorSourceType.SourceFiles,
                    buildTag,
                    sourceFiles: sourceFiles as ActorVersionSourceFile[],
                }],
            });
            actorId = actor.id;
            log(chalk.green(`  ✓ Actor created: ${terminalSafeLine(actorId)}`));

            // Save actorId into the existing actor config (never rewrite or shadow it)
            updateActorConfig(cwd, findActorConfig(cwd)
                ? { actorId }
                : { actorSpecification: 1, name: localConfig.name, version, actorId });
        } catch (err) {
            console.error(chalk.red('Error: Failed to create actor.'));
            console.error(chalk.gray(`Details: ${terminalSafeLine((err as Error).message)}`));
            process.exit(1);
        }
    } else {
        try {
            await client.actor(actorId).versions().create({
                versionNumber: version,
                sourceType: ActorSourceType.SourceFiles,
                buildTag,
                sourceFiles: sourceFiles as ActorVersionSourceFile[],
            });
            log(chalk.green(`  ✓ Version ${terminalSafeLine(version)} pushed`));
        } catch (err) {
            console.error(chalk.red(`Error: Failed to push version ${terminalSafeLine(version)}.`));
            console.error(chalk.gray(`Details: ${terminalSafeLine((err as Error).message)}`));
            process.exit(1);
        }
    }

    // Trigger a build of the pushed version — the platform refuses to run an
    // actor without a successful build, so pushing without building leaves the
    // actor unusable (builds by default).
    let build: { id: string; status: string };
    try {
        log(chalk.gray(`\nBuilding version ${terminalSafeLine(version)} (tag: ${terminalSafeLine(buildTag)})...`));
        build = await client.actor(actorId).build(version, {
            tag: buildTag,
            useCache: false,
            waitForFinish: 0,
        });
        log(chalk.green(`  ✓ Build started: ${terminalSafeLine(build.id)}`));
    } catch (err) {
        console.error(chalk.red('Error: Failed to start build.'));
        console.error(chalk.gray(`Details: ${terminalSafeLine((err as Error).message)}`));
        process.exit(1);
    }

    // -w/--wait-for-finish. 0 returns as soon as the build is
    // queued (fire-and-forget); a positive value bounds the wait; no flag (or
    // the flag without a value) waits indefinitely. The exit code reflects
    // the build outcome only.
    if (options?.waitForFinish === 0) {
        log(chalk.gray(`  Poll with: scrapely builds wait ${terminalSafeLine(build.id)}`));
    } else {
        try {
            log(chalk.gray(`Waiting for build ${terminalSafeLine(build.id)}...`));
            const finished = await waitForBuild(client, build.id, options?.waitForFinish);
            if (!finished) {
                // Wait elapsed with the build still running — outcome unknown,
                // exit 0 (CLI parity).
                log(chalk.gray(`  Build ${terminalSafeLine(build.id)} is still running (wait elapsed).`));
                log(chalk.gray(`  Check its status with: scrapely builds wait ${terminalSafeLine(build.id)}`));
            } else if (finished.status === 'SUCCEEDED') {
                log(chalk.green(`✓ Build ${terminalSafeLine(build.id)} succeeded`));
            } else {
                if (jsonMode) {
                    // Machine-readable failure on stderr; exit code carries the failure
                    console.error(terminalJson(JSON.stringify({
                        error: `Build ${build.id} ${finished.status}`,
                        actorId,
                        version,
                        buildId: build.id,
                        buildStatus: finished.status,
                    }), process.stderr.isTTY === true));
                } else {
                    console.log(chalk.red(`✗ Build ${terminalSafeLine(build.id)} ${terminalSafeLine(finished.status)}`));
                    await printBuildLog(client, build.id);
                }
                process.exit(1);
            }
        } catch (err) {
            console.error(chalk.red(`Error: Failed waiting for build ${terminalSafeLine(build.id)}.`));
            console.error(chalk.gray(`Details: ${terminalSafeLine((err as Error).message)}`));
            process.exit(1);
        }
    }

    // Resolve the final build status for both output modes
    let finalStatus: string | undefined;
    if (options?.waitForFinish !== 0) {
        try {
            const b = await client.build(build.id).get() as { status?: string } | undefined;
            finalStatus = b?.status;
        } catch {
            // Best effort — leave undefined (fall back to the started status below)
        }
    }

    if (jsonMode) {
        console.log(terminalJson(JSON.stringify({
            actorId,
            version,
            buildTag,
            buildId: build.id,
            buildStatus: finalStatus ?? build.status,
        }, null, 2)));
    } else {
        console.log(chalk.green(`\n✓ Push complete`));
        console.log(chalk.gray(`  Actor: ${terminalSafeLine(actorId)}`));
        console.log(chalk.gray(`  Version: ${terminalSafeLine(version)}`));
        console.log(chalk.gray(`\n  Run with: scrapely call ${terminalSafeLine(actorId)}`));
    }

    // --open: open the actor details page in the browser (best effort)
    if (options?.open) {
        openInBrowser(`${getWebBaseUrl()}/actors/${actorId}`);
    }
}
