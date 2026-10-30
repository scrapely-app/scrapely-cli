# Changelog

All notable changes to this project will be documented in this file.

## [0.1.19] - 2026-10-30

- `scrapely mcp` now runs scrapely-mcp 0.3.8 (was 0.3.2): tool errors no longer return exception text, log lines escape control characters, certifi update, plus the search, pricing and docs-tool changes of 0.3.3 to 0.3.8. Run `scrapely mcp install <client>` again to update an existing client entry.

## [0.1.18] - 2026-10-30

Security release.

- Text from the API or from a project is no longer printed to the terminal with escape or other control characters: error details of every command, `datasets get-items`, `key-value-stores get-value` (on a terminal; piped output keeps its exact bytes), JSON output of `actors` commands, `templates` catalog text, and the actor ID, version, build ID and file names printed by `push`.
- The API URL must be `https://` (plain `http://` only for localhost). Before, a login token or OAuth code could be sent to a plain-HTTP API host.
- `pull` clones only over `https://` and `ssh://` (no `http://`, `git://` or other git transports, also not through redirects or submodules); credentials in a clone URL go to git as a header and are not saved in the clone's origin URL.
- `create`, `push`, `pull`, `init` and local runs no longer read or write files through symbolic links that point outside the project (`package.json`, `scrapely.json`, `.gitignore`, `.actorignore`, `storage/.../INPUT.json`, pushed files).
- `create` from a user-picked repository no longer runs `npm install` (which runs the repository's scripts); it asks you to review the code first.
- `scrapely run` (local) no longer passes a `SCRAPELY_TOKEN` or proxy password from your shell to the actor; set them in the actor's environment variables if needed.
- `scrapely mcp`: the saved login token is only used with the API it was saved for.
- `upgrade` installs exactly the checked version and with `--ignore-scripts`.
- Dependencies: scrapely-client 2.25.11, @inquirer/external-editor 3.0.3, basic-ftp and follow-redirects updated.

## [0.1.17] - 2026-10-24

- `-v` / `--version` prints the CLI version only before a command (`scrapely -v`). After a command it belongs to that command again: `push -v`, `actors push -v`, `pull -v`, `actors pull -v`, `builds create --version`, `actors build --version` and `upgrade --version` get their version, and `runs info -v` is verbose. Before, all of them printed the CLI version and exited 0 without doing anything.
- `scrapely info`: a token the API rejects (401/403) is reported as rejected, with exit code 1, instead of "Could not reach the API" with the saved account and exit code 0. Other HTTP errors also exit 1. The saved account is shown (marked as possibly stale) only when the API can't be reached at all and the saved login is the token in use; that fallback now comes after a few seconds instead of minutes. A `SCRAPELY_TOKEN` for another account no longer overwrites the saved login's account.
- `scrapely actor get-public-url` prints a signed URL (`?signature=...`, valid for one hour, `--expires-in <seconds>` to change it) on the public API host, which works without a token. Before, it printed an unsigned `?enablePublicUrl=true` URL that answered 404 without a token. If the token can't read the store's signing key, the command fails instead of printing a link that doesn't work.
- `scrapely actor charge` on a run that has finished stops at once with "Run ... has finished (status ...)" and exit code 1. Before, it sent the charge, got `503 ledger-unavailable` (the server only takes charges while the run is running) and retried for about 4 minutes.
- `scrapely actors start` without an actor ID uses the actor of the project in the current directory, as `call` does.
- `scrapely builds create --json` without `--wait` exits 0 and prints the build. With `--wait`, the exit code still reflects the build outcome.
- `scrapely api --list-endpoints` / `--describe` match the server's routes: `POST /v2/webhooks/{id}/test`, `GET /v2/webhooks/{id}/dispatches`, `POST /v2/actor-tasks/{id}/runs`, `GET /v2/actor-tasks/{id}/runs/last`, standby at `/v2/{username}/{actorName}`, the admin job routes under `/admin/users/`, plus `GET /v2/actors/{id}/builds/default` and `POST /v2/actor-builds/{id}/abort`. Entries for routes that don't exist were removed. `--describe` lists every method of a path.
- Links to the console (`login -m console`, `push --open`, the landing page printed by `task publish`) go to `https://my.scrape.ly` for the production API (`api.scrape.ly`) and `https://my-staging.scrape.ly` for staging. Before, production links went to `https://scrape.ly`. Other `api.` / `api-*.` hosts map to `my.` / `my-*.`; any other host is used as is, and `SCRAPELY_WEB_URL` overrides it.
- `scrapely create -l python` says there are no Python templates and points to `--git-repo`.
- Package metadata and README link the CLI reference at `https://scrape.ly/docs/cli` (the old `/docs/sdk-cli` link answered 404).

## [0.1.16] - 2026-10-22

- `scrapely login` (browser): the page the browser lands on after sign-in matches the Scrape.ly console (light or dark with the system, works offline). Cancelling on the consent screen now reads "Sign-in cancelled" instead of "Login failed: access_denied"; other errors read "Sign-in failed" with the reason.

## [0.1.15] - 2026-10-21

- `scrapely mcp` now runs scrapely-mcp 0.3.2 (security patch release).
- Run logs (`scrapely call` streaming, `runs log`), build logs (`builds log`, the log printed when a push's build fails) and `scrapely api` response bodies no longer pass escape or other control characters to the terminal. On a terminal they are removed (newlines and tabs stay); in JSON output DEL and C1 characters are written as `\u00XX` escapes. Piped output is unchanged.
- `scrapely api --list`: `DELETE /v2/users/me` is no longer listed (the API removed it).

## [0.1.14] - 2026-10-20

- `scrapely mcp` now runs scrapely-mcp 0.3.1.
- `scrapely api --list`: `/v2/actors/{id}/input` and `/run-options` are no longer listed (the API removed them; use saved inputs).
- `scrapely create`: the bundled fallback list no longer has the Python templates and `cli-start`. The live list from the API still offered them until the API stopped serving them (2026-10-24, see 0.1.17); they are still in the templates repo. Python projects can be created from a repository with `--git-repo`.

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
