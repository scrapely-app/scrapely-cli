# Changelog

All notable changes to this project will be documented in this file.

## [0.1.16] - 2026-10-22

- `scrapely login` (browser): the page the browser lands on after sign-in matches the Scrape.ly console (light or dark with the system, works offline). Cancelling on the consent screen now reads "Sign-in cancelled" instead of "Login failed: access_denied"; other errors read "Sign-in failed" with the reason.

## [0.1.15] - 2026-10-21

- `scrapely mcp` now runs scrapely-mcp 0.3.2 (security patch release).
- Run logs (`scrapely call` streaming, `runs log`), build logs (`builds log`, the log printed when a push's build fails) and `scrapely api` response bodies no longer pass escape or other control characters to the terminal. On a terminal they are removed (newlines and tabs stay); in JSON output DEL and C1 characters are written as `\u00XX` escapes. Piped output is unchanged.
- `scrapely api --list`: `DELETE /v2/users/me` is no longer listed (the API removed it).

## [0.1.14] - 2026-10-20

- `scrapely mcp` now runs scrapely-mcp 0.3.1.
- `scrapely api --list`: `/v2/actors/{id}/input` and `/run-options` are no longer listed (the API removed them; use saved inputs).
- `scrapely create`: the Python templates and `cli-start` are no longer offered (they were removed from the templates repo). Python projects can still be scaffolded from a repository with `--git-repo`.

## [0.1.13] - 2026-10-20

- `scrapely mcp` runs `scrapely-mcp` 0.3.0 (saved input and automation tools). 0.2.1 was never published.
- `scrapely api --list`: `/v2/actors/{id}/input` and `/run-options` are described correctly (your default saved input for the Actor and its run options, deprecated in favour of saved inputs / Actor tasks; they were listed as the input schema). New entries for `/v2/automations` (CRUD, duplicate, runs), `/v2/actors/{id}/saved-inputs` and `/v2/users/me/usage/automations`.

## [0.1.12] - 2026-10-19

- `scrapely mcp` runs `scrapely-mcp` 0.2.1.

## [0.1.11] - 2026-10-19

- Package metadata now links the repository, issue tracker and homepage.

## [0.1.10] - 2026-10-19

- New `calculate-memory` command (also `actor calculate-memory`). It evaluates the Actor's `defaultMemoryMbytes` expression from the Actor config against an input (`--input`, default `storage/key_value_stores/default/INPUT.json`) and prints the result, rounded to a power of 2 and clamped to `minMemoryMbytes` / `maxMemoryMbytes`. Flags: `--default-memory-mbytes`, `--input`, `--build`, `--timeout-secs`, `--max-items`, `--max-total-charge-usd`.
- Behaviour change: the `SCRAPELY_TOKEN` environment variable now wins over the login saved by `scrapely login`. Before, the saved login won, so a token set in CI or the shell was silently ignored on a machine that had logged in. Unset `SCRAPELY_TOKEN` to use the saved login again. Also applies to `mcp install`.

## [0.1.9] - 2026-10-18

- `init` in a Scrapy project (`scrapy.cfg`): `requirements.txt` now lists the SDK as `scrapely-python`, its PyPI name. Older versions wrote `scrapely`, which is an unrelated PyPI library with the same import name. A `scrapely` line that an older version wrote is replaced.
- `init` in a Scrapy project: the generated `main.py` pushes every scraped item to the Actor's default dataset through an item pipeline. It also runs the crawl on its own event loop in a worker thread. The old wrapper stopped with "This event loop is already running" and stored no items.
- `init`: the generated `.gitignore` and `.actorignore` exclude `__pycache__/`, `*.pyc`, `.venv/` and `venv/`.

## [0.1.7] - 2026-10-15

- Ships `LICENSE` (Apache-2.0) and `NOTICE`.
- `scrapely mcp` runs `scrapely-mcp` 0.2.0.

## [0.1.6] - 2026-10-15

- Maintenance release.

## [0.1.5] - 2026-10-13

- `scrapely mcp` runs `scrapely-mcp` 0.1.5.

## [0.1.4] - 2026-10-13

- Builds are owner-only: `--build` only applies to your own Actors; runs of someone else's Actor use the publisher's User Build. `actors info --input/--readme` show the build you run.
- `scrapely mcp` runs `scrapely-mcp` 0.1.4.

## [0.1.0] - 2026-09-08

Initial release.

- `scrapely` CLI for managing Actors and runs: `init`, `create`, `push`, `run`, `task-run`, `upgrade`, and authentication
