#!/usr/bin/env node

import chalk from 'chalk';
import { Command } from 'commander';

/**
 * SKILL documentation for AI agents
 * This provides guidance for driving scrapely CLI from agents
 */
const SKILL_DOCUMENTATION = `
# Scrapely CLI Agent Skill

This document provides guidance for AI agents working with the Scrapely CLI.

## Overview

Scrapely CLI is a command-line tool for managing actors, runs, builds, and storage on the Scrapely platform.

## Common Workflows

### Creating and Running an Actor

1. Initialize a new actor project:
   \`scrapely init [name]\` or \`scrapely create [name]\`

2. Push the actor to the platform:
   \`scrapely push\`

3. Run the actor:
   \`scrapely run\` (local), \`scrapely call <actorId>\` (remote, waits), or \`scrapely actors start <actorId>\` (remote, fire-and-forget)

### Managing Actors

- List actors: \`scrapely actors ls\`
- Search actors: \`scrapely actors search <query>\`
- Get actor info: \`scrapely actors info <actorId>\`
- Delete actor: \`scrapely actors rm <actorId>\`

### Working with Runs

- List runs: \`scrapely runs ls\`
- Get run info: \`scrapely runs info <runId>\`
- View logs: \`scrapely runs log <runId>\`
- Abort run: \`scrapely runs abort <runId>\`
- Wait for completion: \`scrapely runs wait <runId>\`

### Storage Operations

- Datasets: \`scrapely datasets <command>\`
- Key-Value Stores: \`scrapely key-value-stores <command>\` or \`scrapely kvs <command>\`

### Authentication

- Login: \`scrapely login\` or \`scrapely auth login\`
- Logout: \`scrapely logout\` or \`scrapely auth logout\`
- View token: \`scrapely auth token\`

## Environment Variables

- \`SCRAPELY_API_BASE_URL\` - Override API endpoint
- \`SCRAPELY_TOKEN\` - API token for authentication (overrides the saved login)
- \`ACTOR_INPUT\` - Base64-encoded JSON input for actors
- \`ACTOR_DEFAULT_DATASET_ID\` - Default dataset ID
- \`ACTOR_DEFAULT_KEY_VALUE_STORE_ID\` - Default KVS ID
- \`ACTOR_RUN_ID\` - Current run ID

## Exit Codes

- 0: Success
- 1: Error (with error message printed to stderr)

## JSON Output

Most commands support \`--json\` flag for machine-readable output.
`;

/**
 * help command - Print help about a command or all available commands
 */
export async function helpCommand(commandString?: string, options?: { skill?: boolean }, program?: Command): Promise<void> {
    if (options?.skill) {
        // Print the agent skill documentation
        console.log(SKILL_DOCUMENTATION);
        return;
    }

    // If a command (or command path like "actors ls") was given, print its help
    if (commandString && program) {
        const parts = commandString.split(/\s+/).filter(Boolean);
        let target: Command | undefined = program;
        for (const part of parts) {
            const next: Command | undefined = target?.commands.find(
                (cmd) => cmd.name() === part || cmd.aliases().includes(part),
            );
            if (!next) {
                console.error(chalk.red(`Unknown command: ${commandString}`));
                console.error(chalk.gray('Run `scrapely help` to see all available commands.'));
                process.exitCode = 1;
                return;
            }
            target = next;
        }
        if (target) {
            target.outputHelp();
            return;
        }
    }

    // We'll print general help
    console.log(chalk.bold('Scrapely CLI - Manage actors and runs on Scrapely platform'));
    console.log();
    console.log(chalk.bold('USAGE'));
    console.log('  $ scrapely [COMMAND]');
    console.log();
    console.log(chalk.bold('COMMANDS'));
    console.log();
    
    console.log(chalk.cyan('  Authentication & Account'));
    console.log('    login          Login to Scrapely');
    console.log('    logout         Logout from Scrapely');
    console.log('    auth           Manage authentication (login, logout, token)');
    console.log('    info           Show current user info');
    console.log('    secrets        Manage locally stored secrets');
    console.log();
    
    console.log(chalk.cyan('  Actor Development'));
    console.log('    init           Initialize a new actor project');
    console.log('    create         Create an actor from a template');
    console.log('    templates      List available actor templates (templates ls)');
    console.log('    run            Run an actor locally');
    console.log('    call           Run an actor remotely (waits for completion)');
    console.log('    push           Push actor source to Scrapely');
    console.log('    pull           Pull actor source from Scrapely');
    console.log('    validate-schema Validate actor schemas');
    console.log('    calculate-memory Calculate the dynamic memory from actor.json and an input');
    console.log();
    
    console.log(chalk.cyan('  Actor Management'));
    console.log('    actors         Manage actors (ls, search, info, call, start, rm)');
    console.log('    builds         Manage actor builds');
    console.log('    runs           Manage actor runs');
    console.log();
    
    console.log(chalk.cyan('  Storage'));
    console.log('    datasets       Manage datasets');
    console.log('    key-value-stores, kvs  Manage key-value stores');
    console.log('    request-queues Manage request queues');
    console.log();
    
    console.log(chalk.cyan('  Tasks'));
    console.log('    task           Run and publish saved actor tasks');
    console.log();
    
    console.log(chalk.cyan('  General'));
    console.log('    help           Print help about commands');
    console.log('    upgrade        Check for CLI updates');
    console.log('    api            Make authenticated API requests');
    console.log('    mcp            Add the Scrapely MCP server to an MCP client (mcp install)');
    console.log();
    
    console.log(chalk.bold('FLAGS'));
    console.log('  --json          Format output as JSON');
    console.log('  --help, -h      Show help for a command');
    console.log();
    
    console.log(chalk.gray('Run `scrapely help <command>` for more information about a command.'));
}

/**
 * Set up the help command
 */
export function setupHelpCommand(program: Command): void {
    program
        .command('help [commandString]')
        .description('Print help about a command or all available commands')
        .option('--skill', 'Print the Scrapely CLI agent skill (guidance for driving scrapely from agents)')
        .action((commandString, options) => helpCommand(commandString, options, program));
}