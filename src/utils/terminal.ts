/**
 * Text from the API that other users control (Store titles, descriptions,
 * READMEs) is printed to the terminal. Escape and other control characters in
 * it could move the cursor, rewrite earlier output, set the window title or
 * emit hyperlinks, so they are removed before printing.
 */

// C0 controls except tab and newline, DEL, and C1 controls (incl. 8-bit CSI).
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/** Multi-line text (READMEs): keeps newlines and tabs. */
export function terminalSafeText(value: unknown): string {
    return String(value ?? '').replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '');
}

/** Single-line fields (titles, names): newlines and tabs become spaces. */
export function terminalSafeLine(value: unknown): string {
    return terminalSafeText(value).replace(/[\n\t]/g, ' ');
}

/** Error messages (often from the API) printed to the terminal. */
export function terminalSafeError(err: unknown): string {
    return terminalSafeText(err instanceof Error ? err.message : err);
}

/**
 * Remote text printed to stdout (run and build logs, `scrapely api` bodies).
 * On a terminal it goes through terminalSafeText; piped or redirected output
 * keeps its exact bytes.
 */
export function stdoutSafeText(value: unknown, isTTY: boolean = process.stdout.isTTY === true): string {
    return isTTY ? terminalSafeText(value) : String(value ?? '');
}

// DEL and C1 controls: JSON.stringify leaves them raw inside strings.
// eslint-disable-next-line no-control-regex
const JSON_RAW_CONTROLS = /[\u007f-\u009f]/g;

/**
 * JSON text printed to stdout. JSON.stringify escapes C0 controls but not DEL
 * or C1 (e.g. U+009B, an 8-bit CSI), so on a terminal those are written as
 * \u00XX escapes: the output is still the same JSON value.
 */
export function terminalJson(json: string, isTTY: boolean = process.stdout.isTTY === true): string {
    if (!isTTY) return json;
    return json.replace(JSON_RAW_CONTROLS, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
