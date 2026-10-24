import { ScrapelyClient } from 'scrapely-client';

import { getApiBaseUrl, getToken } from './config.js';

/**
 * Build a ScrapelyClient configured from the CLI's stored credentials and
 * environment.
 *
 * The client appends `/v2` itself, so the bare API base URL is passed.
 */
export interface ClientTuning {
    /** Retries for 429, 5xx and network errors (client default: 8, about 2-4 minutes in all). */
    maxRetries?: number;
}

export function getClient(token?: string, tuning: ClientTuning = {}): ScrapelyClient {
    const resolvedToken = token ?? getToken();
    return new ScrapelyClient({
        baseUrl: getApiBaseUrl().replace(/\/+$/, ''),
        ...(resolvedToken ? { token: resolvedToken } : {}),
        ...(tuning.maxRetries !== undefined ? { maxRetries: tuning.maxRetries } : {}),
    });
}

/**
 * Build a ScrapelyClient or exit with an error when no token is available.
 */
export function getLoggedClientOrThrow(tuning: ClientTuning = {}): ScrapelyClient {
    const token = getToken();
    if (!token) {
        console.error('You are not logged in. Call "scrapely login" first.');
        process.exit(1);
    }
    return getClient(token, tuning);
}

/**
 * Build a ScrapelyClient for actor-runtime commands (`scrapely actor ...`).
 *
 * Resolution order mirrors the runtime env handling this CLI has always had:
 *   - base URL: APIFY_API_BASE_URL / SCRAPELY_API_BASE_URL / SCRAPELY_API_URL, then CLI config
 *   - token: ACTOR_TOKEN / APIFY_TOKEN / SCRAPELY_TOKEN, then saved CLI credentials
 *
 * Security: saved CLI credentials are only used when the base URL comes from the
 * CLI config (not from env vars), preventing credential exfiltration to
 * attacker-controlled hosts.
 */
export function getRuntimeClient(): ScrapelyClient {
    const runtimeBaseUrl =
        process.env.APIFY_API_BASE_URL ||
        process.env.SCRAPELY_API_BASE_URL ||
        process.env.SCRAPELY_API_URL;

    const runtimeToken =
        process.env.ACTOR_TOKEN ||
        process.env.APIFY_TOKEN ||
        process.env.SCRAPELY_TOKEN;

    const token = runtimeToken ?? (runtimeBaseUrl ? undefined : getToken() ?? undefined);
    const baseUrl = (runtimeBaseUrl ?? getApiBaseUrl()).replace(/\/+$/, '');

    return new ScrapelyClient({
        baseUrl,
        // Host for links (signed public record URLs). Inside a run the API base
        // is the internal address; the platform sets the public one separately.
        // Without this the client would use its built-in production host.
        publicBaseUrl: (process.env.APIFY_API_PUBLIC_BASE_URL || baseUrl).replace(/\/+$/, ''),
        ...(token ? { token } : {}),
    });
}

/**
 * Whether a runtime API base URL (env var) is in effect for runtime commands.
 */
export function isUsingRuntimeApiBaseUrl(): boolean {
    return Boolean(
        process.env.APIFY_API_BASE_URL ||
        process.env.SCRAPELY_API_BASE_URL ||
        process.env.SCRAPELY_API_URL,
    );
}

