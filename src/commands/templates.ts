import chalk from 'chalk';
import { Command } from 'commander';
import { getTemplates } from './create.js';

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
                console.log(JSON.stringify(
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
                ));
                return;
            }

            console.log(chalk.bold('\nAvailable actor templates:\n'));
            for (const template of available) {
                console.log(`  ${chalk.cyan(template.name)}  ${chalk.gray(`(${template.language})`)}  ${chalk.gray(`[${template.useCases.join(', ')}]`)}`);
                console.log(chalk.gray(`    ${template.displayName} - ${template.description}`));
            }
            console.log(chalk.gray('\nUse with: scrapely create my-actor --template <name>'));
        });
}
