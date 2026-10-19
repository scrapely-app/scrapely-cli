#!/usr/bin/env node

import chalk from 'chalk';
import { Command } from 'commander';
import { existsSync, readFileSync } from 'fs';
import { join, relative, resolve } from 'path';
import { safeResolve, validatePathWithinDir } from '../utils/pathValidation.js';
import { ACTOR_CONFIG_FILES, findActorConfig } from '../config.js';
import { formatInputSchemaIssue, validateInputSchemaCategories } from '../utils/inputSchemaCategories.js';

/**
 * Validate a JSON schema
 */
function validateSchema(schema: unknown, path: string): string[] {
    const errors: string[] = [];
    
    if (typeof schema !== 'object' || schema === null) {
        errors.push(`${path}: Schema must be an object`);
        return errors;
    }
    
    const s = schema as Record<string, unknown>;

    // Validate properties if present
    if (s.properties && typeof s.properties !== 'object') {
        errors.push(`${path}: "properties" must be an object`);
    }
    
    // Validate required if present
    if (s.required !== undefined) {
        if (!Array.isArray(s.required)) {
            errors.push(`${path}: "required" must be an array`);
        } else {
            for (const req of s.required) {
                if (typeof req !== 'string') {
                    errors.push(`${path}: "required" array items must be strings`);
                }
            }
        }
    }
    
    // Validate title if present
    if (s.title !== undefined && typeof s.title !== 'string') {
        errors.push(`${path}: "title" must be a string`);
    }
    
    // Validate description if present
    if (s.description !== undefined && typeof s.description !== 'string') {
        errors.push(`${path}: "description" must be a string`);
    }
    
    return errors;
}

/**
 * Input-schema checks on top of validateSchema(): UI-only `categories`. Unknown
 * category references, cycles, too-deep nesting and wrong types are errors here
 * (the platform build only warns and renders such fields ungrouped).
 */
export function validateInputSchema(schema: unknown, path: string): { errors: string[]; warnings: string[] } {
    const errors = validateSchema(schema, path);
    const warnings: string[] = [];
    for (const issue of validateInputSchemaCategories(schema)) {
        (issue.level === 'error' ? errors : warnings).push(`${path}: ${formatInputSchemaIssue(issue)}`);
    }
    return { errors, warnings };
}

/**
 * validate-schema command - Validate actor schemas
 */
export async function validateSchemaCommand(schemaPath?: string): Promise<void> {
    const cwd = process.cwd();
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // If a specific path is provided, validate only that
    if (schemaPath) {
        // SECURITY: Validate the user-provided path stays within cwd
        let fullPath: string;
        try {
            fullPath = safeResolve(cwd, schemaPath);
        } catch (err) {
            console.error(chalk.red(`Error: Invalid path: ${(err as Error).message}`));
            process.exit(1);
        }
        
        if (!existsSync(fullPath)) {
            console.error(chalk.red(`Error: Schema file not found: ${schemaPath}`));
            process.exit(1);
        }
        
        try {
            const content = readFileSync(fullPath, 'utf-8');
            const schema = JSON.parse(content);
            const result = validateInputSchema(schema, schemaPath);
            errors.push(...result.errors);
            warnings.push(...result.warnings);
        } catch (err) {
            console.error(chalk.red(`Error: Failed to parse schema file: ${(err as Error).message}`));
            process.exit(1);
        }
    } else {
        // Validate all schemas in the actor config (.actor/actor.json, .actor/scrapely.json,
        // scrapely.json or actor.json — same lookup as every other command)
        const found = findActorConfig(cwd);
        if (!found) {
            console.error(chalk.red(`Error: No actor config found in current directory (looked for ${ACTOR_CONFIG_FILES.join(', ')}).`));
            process.exit(1);
        }

        try {
            const actorConfig = found.config as Record<string, any>;

            console.log(chalk.gray(`Validating actor configuration (${relative(cwd, found.path)})...`));

            // Schemas are inline objects or paths relative to the config file's directory
            // falling back to the project root. SECURITY: must stay inside cwd.
            const collect = (schema: unknown, label: string) => {
                if (label !== 'input') {
                    errors.push(...validateSchema(schema, label));
                    return;
                }
                const result = validateInputSchema(schema, label);
                errors.push(...result.errors);
                warnings.push(...result.warnings);
            };
            const checkSchema = (value: unknown, label: string) => {
                if (value && typeof value === 'object') {
                    collect(value, label);
                    console.log(chalk.gray(`  Checking ${label} schema...`));
                    return;
                }
                if (typeof value !== 'string' || !value) return;
                const schemaPath = [resolve(found.dir, value), resolve(cwd, value)].find((candidate) => {
                    try {
                        return existsSync(safeResolve(cwd, candidate));
                    } catch {
                        return false;
                    }
                });
                if (!schemaPath) {
                    errors.push(`${label} schema file not found: ${value}`);
                    return;
                }
                collect(JSON.parse(readFileSync(schemaPath, 'utf-8')), label);
                console.log(chalk.gray(`  Checking ${label} schema from ${relative(cwd, schemaPath)}...`));
            };

            checkSchema(actorConfig.input ?? actorConfig.inputSchema, 'input');
            checkSchema(actorConfig.storages?.dataset, 'storages.dataset');
            checkSchema(actorConfig.output ?? actorConfig.outputSchema, 'output');
            checkSchema(actorConfig.storages?.keyValueStore, 'storages.keyValueStore');

        } catch (err) {
            console.error(chalk.red(`Error: Failed to parse actor configuration: ${(err as Error).message}`));
            process.exit(1);
        }
    }
    
    // Report results
    if (warnings.length > 0) {
        console.log(chalk.yellow('\n! Warnings:'));
        for (const warning of warnings) {
            console.log(chalk.yellow(`  - ${warning}`));
        }
    }
    if (errors.length === 0) {
        console.log(chalk.green('\n✓ All schemas are valid!'));
    } else {
        console.log(chalk.red('\n✗ Schema validation failed:'));
        for (const error of errors) {
            console.log(chalk.red(`  - ${error}`));
        }
        process.exit(1);
    }
}

/**
 * Set up the validate-schema command
 */
export function setupValidateSchemaCommand(program: Command): void {
    program
        .command('validate-schema [path]')
        .description('Validate actor schemas (input, output, dataset, key-value store)')
        .action((path) => validateSchemaCommand(path));
}