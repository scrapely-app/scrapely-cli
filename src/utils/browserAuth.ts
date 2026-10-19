/**
 * Browser-based OAuth login (RFC 8252 loopback flow).
 *
 * Spins up a one-shot HTTP server on 127.0.0.1, registers an OAuth client
 * via dynamic client registration, opens the browser at the Scrapely OAuth
 * authorize endpoint (which bounces through the Scrapely console login page),
 * and exchanges the returned authorization code for the user's API token
 * using PKCE S256. Uses only Node built-ins — no extra dependencies.
 */
import { createHash, randomBytes } from 'crypto';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { execFile } from 'child_process';

export function openUrl(rawUrl: string): void {
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

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Turn a Node fetch network failure into a message a human can act on.
 * Raw `fetch failed` errors hide the cause (ECONNREFUSED, ENOTFOUND, ...)
 * inside `error.cause` and never mention the URL that was tried.
 */
function describeNetworkError(error: unknown, url: string): string {
    const err = error as { message?: string; cause?: { code?: string; message?: string } };
    const code = err?.cause?.code;
    if (code) {
        return `Cannot reach the Scrapely API at ${url} (${code}). `
            + 'Check SCRAPELY_API_BASE_URL / SCRAPELY_API_URL, or that the server is running.';
    }
    return `Request to ${url} failed: ${err?.message ?? 'unknown error'}`;
}

async function fetchJson(url: string, init: RequestInit): Promise<any> {
    let response: Response;
    try {
        response = await fetch(url, init);
    } catch (error) {
        throw new Error(describeNetworkError(error, url));
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data?.error_description || data?.error || `Request failed with status ${response.status}`);
    }
    return data;
}

/**
 * Run the browser OAuth flow against the Scrapely API at `apiBaseUrl`.
 * Resolves with the user's API token, or rejects with a descriptive error.
 */
export async function loginWithBrowser(apiBaseUrl: string, clientName = 'Scrapely CLI'): Promise<string> {
    const base = apiBaseUrl.replace(/\/+$/, '');

    // 1. PKCE pair
    const codeVerifier = randomBytes(48).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    // 2. One-shot loopback server on an ephemeral port
    const { port, waitForCallback, closeServer } = await startCallbackServer();

    try {
        // 3. Dynamic client registration
        const redirectUri = `http://127.0.0.1:${port}/callback`;
        const client = await fetchJson(`${base}/v2/oauth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_name: clientName, redirect_uris: [redirectUri] }),
        });
        console.log(`[oauth] client registered: client_id=${client.client_id} callback=${redirectUri}`);

        // 4. Open the browser at the authorize endpoint
        const authorizeUrl = new URL(`${base}/v2/oauth/authorize`);
        authorizeUrl.searchParams.set('response_type', 'code');
        authorizeUrl.searchParams.set('client_id', client.client_id);
        authorizeUrl.searchParams.set('redirect_uri', redirectUri);
        authorizeUrl.searchParams.set('code_challenge', codeChallenge);
        authorizeUrl.searchParams.set('code_challenge_method', 'S256');

        console.log('Opening browser for Scrapely login…');
        console.log(`If the browser does not open, visit:\n  ${authorizeUrl.toString()}`);
        openUrl(authorizeUrl.toString());
        console.log('Waiting for you to finish in the browser (this can take a moment)…');

        // 5. Wait for the authorization code
        const code = await waitForCallback();

        // 6. Exchange it for the token
        const body = new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: client.client_id,
            code,
            redirect_uri: redirectUri,
            code_verifier: codeVerifier,
        });
        console.log(`[oauth] → POST ${base}/v2/oauth/token`);
        const tokenResponse = await fetchJson(`${base}/v2/oauth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });

        if (!tokenResponse?.access_token) {
            throw new Error('Token endpoint did not return an access token.');
        }
        console.log('[oauth] ✓ token received');
        return tokenResponse.access_token as string;
    } finally {
        closeServer();
    }
}

interface CallbackServer {
    port: number;
    waitForCallback: () => Promise<string>;
    closeServer: () => void;
}

/** Minimal HTML-escape for text interpolated into the callback pages. */
function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Scrapely-branded one-shot callback page (success or failure), matching the
 * consent screen's design system: light background, white 18px-radius card,
 * Plus Jakarta Sans stack, brand-orange accent. No external assets — this
 * page is served from 127.0.0.1 and must work offline. */
function callbackPage(title: string, message: string, ok: boolean): string {
    const icon = ok
        ? `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="12" fill="#EE7A2A"/><path d="M7.5 12.4l3 3 6-6.4" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
        : `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="12" fill="#FBE2CB"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="#BC5811" stroke-width="2.2" stroke-linecap="round"/></svg>`;
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{font-family:'Plus Jakarta Sans',Manrope,system-ui,-apple-system,'Segoe UI',sans-serif;background:#F6F7F9;color:#1F2125;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#fff;border:1px solid #E7E8EC;border-radius:18px;padding:34px 40px;max-width:400px;width:100%;text-align:center;box-shadow:0 12px 40px rgba(20,22,28,.07),0 1px 3px rgba(20,22,28,.05);box-sizing:border-box}
.card svg{display:block;margin:0 auto 18px}
h1{font-size:20px;font-weight:800;letter-spacing:-.02em;margin:0 0 8px}
p{font-size:14px;color:#5D6470;line-height:1.6;margin:0}
</style>
</head>
<body>
<div class="card">
    ${icon}
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
</div>
</body>
</html>`;
}

function startCallbackServer(): Promise<CallbackServer> {
    return new Promise((resolveServer, rejectServer) => {
        let settled = false;

        let resolveCallback!: (code: string) => void;
        let rejectCallback!: (err: Error) => void;
        const codePromise = new Promise<string>((resolve, reject) => {
            resolveCallback = resolve;
            rejectCallback = reject;
        });

        const server = createServer((req: IncomingMessage, res: ServerResponse) => {
            console.log(`[oauth] ← ${req.method} ${req.url}`);
            const url = new URL(req.url ?? '/', 'http://127.0.0.1');
            const code = url.searchParams.get('code');
            const error = url.searchParams.get('error');

            if (url.pathname !== '/callback') {
                res.writeHead(404).end();
                return;
            }

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            if (code && !settled) {
                settled = true;
                console.log('[oauth] authorization code received — exchanging for token…');
                res.end(callbackPage('Login successful', 'You can close this tab and return to the terminal.', true));
                resolveCallback(code);
            } else {
                settled = true;
                const description = url.searchParams.get('error_description') || error || 'unknown_error';
                console.log(`[oauth] browser reported failure: ${description}`);
                res.end(callbackPage('Login failed', `${description} You can close this tab and return to the terminal.`, false));
                rejectCallback(new Error(`Authorization failed: ${description}`));
            }
        });

        server.on('error', rejectServer);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address !== 'object') {
                rejectServer(new Error('Failed to bind loopback callback server.'));
                return;
            }

            const timeout = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    console.log('[oauth] timed out — no callback request arrived within 5 minutes.');
                    rejectCallback(new Error('Login timed out — no callback received within 5 minutes.'));
                }
            }, CALLBACK_TIMEOUT_MS);
            timeout.unref?.();

            resolveServer({
                port: address.port,
                waitForCallback: () => codePromise,
                closeServer: () => {
                    clearTimeout(timeout);
                    server.close();
                },
            });
        });
    });
}
