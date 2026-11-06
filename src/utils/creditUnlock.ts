/**
 * Out of credit: the API's 402 for the account balance carries the way out in
 * error.data (Free: `unlock.checkoutUrl`, the Starter checkout or a held run's
 * unlock; paid: `topUpUrl`), and a run whose results are held because the
 * free credit ran out has `held`. The CLI prints the link on its own line.
 * The links come from the API and carry no token (the console asks for login).
 */

// Controls (incl. newline/tab, DEL, C1) removed from API text put on one terminal line.
// (No import of terminal.ts: it imports this module.)
// eslint-disable-next-line no-control-regex
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]/g;
const terminalSafeLine = (value: unknown): string => String(value ?? '').replace(CONTROLS, '');

const CREDIT_REASONS = new Set(['insufficient-credit', 'insufficient-funds']);

interface CreditErrorLike {
    statusCode?: unknown;
    data?: { reason?: unknown; unlock?: { checkoutUrl?: unknown } | null; topUpUrl?: unknown } | null;
}

/** "Unlock: <url>" (Free) or "Add credit: <url>" (paid) for a 402 for the balance, else undefined. */
export function creditUnlockLine(err: unknown): string | undefined {
    const e = err as CreditErrorLike | null | undefined;
    if (!e || e.statusCode !== 402 || !CREDIT_REASONS.has(String(e.data?.reason))) return undefined;
    const unlock = e.data?.unlock?.checkoutUrl;
    if (typeof unlock === 'string' && unlock) return `Unlock: ${terminalSafeLine(unlock)}`;
    const topUp = e.data?.topUpUrl;
    if (typeof topUp === 'string' && topUp) return `Add credit: ${terminalSafeLine(topUp)}`;
    return undefined;
}

interface HeldRunLike {
    held?: {
        status?: unknown;
        items?: unknown;
        heldUntil?: unknown;
        unlock?: { checkoutUrl?: unknown } | null;
    } | null;
}

/** One line for a run with held results that can still be unlocked, else undefined. */
export function heldRunLine(run: unknown): string | undefined {
    const held = (run as HeldRunLike | null | undefined)?.held;
    const items = Number(held?.items);
    if (!held || !(items > 0) || (held.status !== 'holding' && held.status !== 'held')) return undefined;
    const until = typeof held.heldUntil === 'string' && held.heldUntil ? ` until ${terminalSafeLine(held.heldUntil)}` : '';
    const url = held.unlock?.checkoutUrl;
    const link = typeof url === 'string' && url ? ` Unlock them: ${terminalSafeLine(url)}` : '';
    return `Your free credit ran out, so ${items.toLocaleString('en-US')} more result${items === 1 ? ' is' : 's are'} held${until}.${link}`;
}
