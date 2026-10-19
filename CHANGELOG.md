# Changelog

All notable changes to this project will be documented in this file.

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

- `create --source`: the default value is now `platform` (source stored on the Scrapely platform). `apify` still works as a deprecated alias of `platform` and prints a warning on stderr. `--json` output reports `"source": "platform"`.

## [0.1.5] - 2026-10-13

- `scrapely mcp` runs `scrapely-mcp` 0.1.5.

## [0.1.4] - 2026-10-13

- Builds are owner-only: `--build` only applies to your own Actors; runs of someone else's Actor use the publisher's User Build. `actors info --input/--readme` show the build you run.
- `scrapely mcp` runs `scrapely-mcp` 0.1.4.

## [0.1.0] - 2026-09-08

Initial release.

- `scrapely` CLI for managing Actors and runs: `init`, `create`, `push`, `run`, `task-run`, `upgrade`, and authentication
