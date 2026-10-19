import { Command } from 'commander';

/**
 * request-queues - the upstream command is a placeholder
 * with no subcommands yet ("Manage Scrapely request queues. No subcommands
 * are available yet."). Subcommands will be added when upstream adds them.
 */
export function setupRequestQueuesCommand(program: Command): void {
    program
        .command('request-queues')
        .description('Manage Scrapely request queues. No subcommands are available yet.');
}
