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

import { assertSecureApiBaseUrl } from '../config.js';
import { terminalSafeLine } from './terminal.js';

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
        throw new Error(terminalSafeLine(data?.error_description || data?.error || `Request failed with status ${response.status}`));
    }
    return data;
}

/**
 * Run the browser OAuth flow against the Scrapely API at `apiBaseUrl`.
 * Resolves with the user's API token, or rejects with a descriptive error.
 */
export async function loginWithBrowser(apiBaseUrl: string, clientName = 'Scrapely CLI'): Promise<string> {
    const base = assertSecureApiBaseUrl(apiBaseUrl).replace(/\/+$/, '');

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

type CallbackOutcome = 'signed-in' | 'cancelled' | 'failed';

const GLYPH = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    minus: '<path d="M5 12h14"/>',
    terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" x2="20" y1="19" y2="19"/>',
} as const;

const glyph = (name: keyof typeof GLYPH, strokeWidth = 2) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPH[name]}</svg>`;

/** The Scrape.ly mark, simplified to two shapes so it can be drawn inline. */
const mark = (id: string, width: number) =>
    `<svg viewBox="90 125 790 690" width="${width}" height="${Math.round((width * 690) / 790)}" aria-hidden="true"><defs>`
    + `<linearGradient id="${id}-a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFB800"/><stop offset=".55" stop-color="#FF6A00"/><stop offset="1" stop-color="#FF9500"/></linearGradient>`
    + `<linearGradient id="${id}-b" x1="1" y1="1" x2="0" y2="0"><stop offset="0" stop-color="#FFB800"/><stop offset=".55" stop-color="#FF6A00"/><stop offset="1" stop-color="#FF9500"/></linearGradient>`
    + `</defs><g stroke-width="40" stroke-linejoin="round">`
    + `<polygon points="140,165 825,165 690,335 392,335 316,412 132,180" fill="url(#${id}-a)" stroke="url(#${id}-a)"/>`
    + `<polygon points="830,775 145,775 280,605 578,605 654,528 838,760" fill="url(#${id}-b)" stroke="url(#${id}-b)"/>`
    + `</g></svg>`;

/** Terminal joined to Scrape.ly by a route: lit with a check, or dotted with a neutral or red mark. */
function illustration(outcome: CallbackOutcome): string {
    const route = outcome === 'signed-in'
        ? '<path d="M4 26 H84" stroke="var(--accent)" stroke-opacity=".55" stroke-width="1.5" stroke-linecap="round"/>'
        : `<path d="M4 26 H84" stroke="var(--ink-3)" stroke-opacity="${outcome === 'failed' ? '.3' : '.5'}" stroke-width="1.5" stroke-linecap="round" stroke-dasharray="0.01 3.5"/>`;
    const status = outcome === 'signed-in'
        ? `<span class="status ok"><span class="ping"></span>${glyph('check', 3)}</span>`
        : outcome === 'cancelled'
            ? `<span class="status off">${glyph('minus', 3)}</span>`
            : `<span class="status bad">${glyph('x', 3)}</span>`;
    return `<div class="ill" aria-hidden="true"><span class="tile">${glyph('terminal', 1.8)}</span>`
        + `<span class="route"><svg width="88" height="52" viewBox="0 0 88 52" fill="none">${route}</svg>${status}</span>`
        + `<span class="tile${outcome === 'signed-in' ? ' lit' : ''}">${mark('ill', 30)}</span></div>`;
}

/**
 * One-shot callback page in the Scrape.ly console's look (the API's consent
 * page uses the same tokens): light or dark with the system, one card, an
 * illustration that holds still under reduced motion. Inline only: this page
 * is served from 127.0.0.1 and must work offline.
 */
function callbackPage(outcome: CallbackOutcome, title: string, message: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(title)} | Scrape.ly</title>
<style>
:root{color-scheme:light dark;--app:#F5F5F5;--card:#FFFFFF;--line:#EFEFEF;--line-2:#E7E7E7;--ink:#0F0F0F;--ink-2:#666666;--ink-3:#6E6E6E;--accent:#FF9500;--accent-tint:#FFF4E5;--ok:#219653;--bad:#D63333;--bad-tint:#FBEAEA;--shadow:0 12px 40px rgba(20,22,28,.07),0 1px 3px rgba(20,22,28,.05);--tile-shadow:0 0 15px 2px rgba(1,1,1,.04)}
@media (prefers-color-scheme:dark){:root{--app:#0A0A0C;--card:#121214;--line:#28282B;--line-2:#36363A;--ink:#F7F7F8;--ink-2:#ACACAD;--ink-3:#808084;--accent-tint:rgba(255,149,0,.16);--ok:#34C77B;--bad:#F87171;--bad-tint:rgba(214,51,51,.15);--shadow:0 12px 40px rgba(0,0,0,.45);--tile-shadow:0 0 15px 2px rgba(0,0,0,.35)}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--app);color:var(--ink);font-family:InterVariable,Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
.wrap{width:100%;max-width:432px}
.brand{display:flex;justify-content:center;align-items:center;gap:10px;margin:0 0 22px}
.brand b{display:block;font-size:18px;font-weight:600;letter-spacing:-.02em;line-height:1}
.brand small{display:block;margin-top:2px;font-size:9.5px;font-weight:550;letter-spacing:.04em;color:var(--ink-3);line-height:1}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:34px;box-shadow:var(--shadow);text-align:center}
.visual{height:88px;display:flex;align-items:center;justify-content:center;margin:0 0 20px}
h1{margin:0;font-size:20px;line-height:1.3;font-weight:600;letter-spacing:-.02em}
p{margin:8px 0 0;font-size:14px;line-height:1.6;color:var(--ink-2);word-break:break-word}
.ill{display:flex;align-items:center}
.tile{flex:none;display:flex;align-items:center;justify-content:center;width:52px;height:52px;border:1px solid var(--line);border-radius:10px;background:var(--card);box-shadow:var(--tile-shadow);color:var(--ink-2)}
.tile>svg[viewBox="0 0 24 24"]{width:24px;height:24px}
.tile.lit{box-shadow:0 0 0 4px var(--accent-tint),0 6px 18px -8px rgba(255,149,0,.45)}
.route{position:relative;flex:none;width:88px;height:52px}
.route>svg{position:absolute;inset:0}
.status{position:absolute;left:50%;top:50%;display:flex;align-items:center;justify-content:center;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;box-shadow:0 0 0 3px var(--card)}
.status svg{position:relative;width:14px;height:14px}
.status.ok{background:var(--ok);color:#fff}
.status.off{background:var(--card);color:var(--ink-3);border:1px solid var(--line-2)}
.status.bad{background:var(--bad-tint);color:var(--bad);border:1px solid rgba(214,51,51,.25)}
.ping{position:absolute;inset:0;border-radius:50%;background:var(--ok);opacity:0;animation:ping 2.6s cubic-bezier(.22,1,.36,1) infinite}
@keyframes ping{0%{opacity:.5;transform:scale(.85)}70%,100%{opacity:0;transform:scale(1.9)}}
@media (prefers-reduced-motion:reduce){.ping{animation:none}}
</style>
</head>
<body>
<main class="wrap">
<div class="brand" role="img" aria-label="Scrape.ly">${mark('logo', 28)}<span aria-hidden="true"><b>scrape.ly</b><small>by evomi</small></span></div>
<div class="card">
<div class="visual">${illustration(outcome)}</div>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
</div>
</main>
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
            console.log(`[oauth] ← ${terminalSafeLine(req.method)} ${terminalSafeLine(req.url)}`);
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
                res.end(callbackPage('signed-in', "You're signed in", 'Go back to your terminal to continue. You can close this tab.'));
                resolveCallback(code);
            } else {
                settled = true;
                const description = url.searchParams.get('error_description') || error || 'unknown_error';
                console.log(`[oauth] browser reported failure: ${terminalSafeLine(description)}`);
                res.end(error === 'access_denied'
                    ? callbackPage('cancelled', 'Sign-in cancelled', 'Nothing was connected. Go back to your terminal; you can close this tab.')
                    : callbackPage('failed', 'Sign-in failed', `${description} Go back to your terminal and try again.`));
                rejectCallback(new Error(`Authorization failed: ${terminalSafeLine(description)}`));
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
