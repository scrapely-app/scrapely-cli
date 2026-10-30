import chalk from 'chalk';
import { Command } from 'commander';
import { getTemplates } from './create.js';
import { terminalJson, terminalSafeLine } from '../utils/terminal.js';

/**
 * templates command - Explore the actor templates available for `scrapely create`
 */
export function setupTemplatesCommand(program: Command): void {
    const templates = program
        .command('templates')
        .description('Manage actor templates');

    templates
        .command('ls')
        .description('Prints all available actor templates, including the language each one supports.')
        .option('--json', 'Format the command output as JSON.')
        .action(async (options: { json?: boolean }) => {
            // Live catalog from the API (templates repo manifest); falls back
            // to the bundled snapshot when the API is unreachable.
            const available = await getTemplates();
            if (options.json) {
                console.log(terminalJson(JSON.stringify(
                    available.map(({ name, aliases, displayName, description, language, useCases }) => ({
                        name,
                        aliases,
                        displayName,
                        description,
                        language,
                        useCases,
                    })),
                    null,
                    2,
                )));
                return;
            }

            console.log(chalk.bold('\nAvailable actor templates:\n'));
            // Catalog text comes from the API: control characters are removed before printing.
            for (const template of available) {
                const useCases = template.useCases.map(terminalSafeLine).join(', ');
                console.log(`  ${chalk.cyan(terminalSafeLine(template.name))}  ${chalk.gray(`(${terminalSafeLine(template.language)})`)}  ${chalk.gray(`[${useCases}]`)}`);
                console.log(chalk.gray(`    ${terminalSafeLine(template.displayName)} - ${terminalSafeLine(template.description)}`));
            }
            console.log(chalk.gray('\nUse with: scrapely create my-actor --template <name>'));
        });
}
