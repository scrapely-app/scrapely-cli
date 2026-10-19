# scrapely-cli

Command-line tools for creating, deploying, running, and managing Scrapely
Actors and platform resources.

Requires Node.js 20.17.0 or newer.

## Install

```bash
npm install -g scrapely-cli
scrapely --help
```

Or run without a global install:

```bash
npx scrapely-cli --help
```

## Quick start

```bash
scrapely login
scrapely create my-actor --template crawlee-cheerio-js
cd my-actor
scrapely push
scrapely call --input '{"url":"https://example.com"}'
```

For non-interactive environments, provide `SCRAPELY_TOKEN` and optionally
`SCRAPELY_API_URL` instead of running `login`.

## MCP

Add the Scrapely MCP server ([`scrapely-mcp`](https://pypi.org/project/scrapely-mcp/) on PyPI) to an MCP client:

```bash
scrapely mcp install claude-code   # or claude-desktop, cursor, vscode, codex
```

It reuses the token from `scrapely login` (override with `--token`) and runs the server
with `uvx`, so [uv](https://docs.astral.sh/uv/) must be installed.

## Documentation

See the [CLI guide](https://scrape.ly/docs/sdk-cli). Run `scrapely --help` to list every
command, and `scrapely <command> --help` for its options.

## License

Apache-2.0