#!/usr/bin/env node
// Portions derived from apify-cli (src/commands/api.ts; Copyright Apify Technologies s.r.o., Apache-2.0).
// Modified by TeraShift GmbH. See the LICENSE and NOTICE files.

import chalk from 'chalk';
import { Command } from 'commander';
import { getApiBaseUrl } from '../config.js';
import { getLoggedClientOrThrow } from '../client.js';
import { stdoutSafeText, terminalJson, terminalSafeError } from '../utils/terminal.js';

/**
 * API endpoint definitions for help — derived from scrapely-server route files.
 * Every route mounted in scrapely-server/src/index.ts is listed here.
 */
interface ApiEndpoint {
    method: string;
    path: string;
    summary: string;
    category: string;
}

export const API_ENDPOINTS: ApiEndpoint[] = [
    // ── Actors ──
    { method: 'GET', path: '/v2/actors', category: 'Actors', summary: 'List actors' },
    { method: 'POST', path: '/v2/actors', category: 'Actors', summary: 'Create actor' },
    { method: 'GET', path: '/v2/actors/{actorId}', category: 'Actors', summary: 'Get actor details' },
    { method: 'GET', path: '/v2/acts/{actorId}', category: 'Actors', summary: 'Get actor (alias)' },
    { method: 'PUT', path: '/v2/actors/{actorId}', category: 'Actors', summary: 'Update actor' },
    { method: 'DELETE', path: '/v2/actors/{actorId}', category: 'Actors', summary: 'Delete actor' },
    { method: 'GET', path: '/v2/actors/{actorId}/saved-inputs', category: 'Actors', summary: 'List your saved inputs and example inputs for an actor' },
    { method: 'POST', path: '/v2/actors/{actorId}/bookmark', category: 'Actors', summary: 'Bookmark actor' },
    { method: 'DELETE', path: '/v2/actors/{actorId}/bookmark', category: 'Actors', summary: 'Remove bookmark' },
    { method: 'GET', path: '/v2/actors/{actorId}/bookmark', category: 'Actors', summary: 'Check bookmark' },
    { method: 'GET', path: '/v2/users/me/bookmarks', category: 'Actors', summary: 'List bookmarked actors' },

    // ── Builds ──
    { method: 'GET', path: '/v2/actor-builds', category: 'Builds', summary: 'List builds' },
    { method: 'GET', path: '/v2/actor-builds/{buildId}', category: 'Builds', summary: 'Get build details' },
    { method: 'GET', path: '/v2/actor-builds/{buildId}/log', category: 'Builds', summary: 'Get build log' },
    { method: 'POST', path: '/v2/actors/{actorId}/builds', category: 'Builds', summary: 'Create build for actor' },
    { method: 'GET', path: '/v2/actors/{actorId}/builds', category: 'Builds', summary: 'List builds for actor' },
    { method: 'GET', path: '/v2/actors/{actorId}/builds/default', category: 'Builds', summary: 'Get the default build for actor' },
    { method: 'POST', path: '/v2/actor-builds/{buildId}/abort', category: 'Builds', summary: 'Abort build' },
    // NOTE: no build-scoped tag endpoints here — tags are managed through
    // `PUT /v2/actors/{actorId}` (`taggedBuilds` field), matching the platform API.
    { method: 'DELETE', path: '/v2/actor-builds/{buildId}', category: 'Builds', summary: 'Delete build' },

    // ── Runs ──
    { method: 'GET', path: '/v2/actor-runs', category: 'Runs', summary: 'List runs' },
    { method: 'GET', path: '/v2/actor-runs/{runId}', category: 'Runs', summary: 'Get run details' },
    { method: 'GET', path: '/v2/actor-runs/{runId}/input', category: 'Runs', summary: 'Get run input' },
    { method: 'POST', path: '/v2/actor-runs/{runId}/abort', category: 'Runs', summary: 'Abort run' },
    { method: 'POST', path: '/v2/actor-runs/{runId}/resurrect', category: 'Runs', summary: 'Resurrect run' },
    { method: 'PUT', path: '/v2/actor-runs/{runId}', category: 'Runs', summary: 'Update run (status message, general access)' },
    { method: 'DELETE', path: '/v2/actor-runs/{runId}', category: 'Runs', summary: 'Delete run' },
    { method: 'GET', path: '/v2/actor-runs/{runId}/log', category: 'Runs', summary: 'Get run log' },
    { method: 'POST', path: '/v2/actor-runs/{runId}/metamorph', category: 'Runs', summary: 'Metamorph run' },
    { method: 'POST', path: '/v2/actor-runs/{runId}/reboot', category: 'Runs', summary: 'Reboot run' },
    { method: 'POST', path: '/v2/actors/{actorId}/runs', category: 'Runs', summary: 'Run actor' },
    { method: 'GET', path: '/v2/actors/{actorId}/runs', category: 'Runs', summary: 'List actor runs' },
    { method: 'GET', path: '/v2/actors/{actorId}/runs/stats', category: 'Runs', summary: 'Actor run stats' },
    { method: 'GET', path: '/v2/actors/{actorId}/runs/last', category: 'Runs', summary: 'Get last run' },
    { method: 'GET', path: '/v2/actors/{actorId}/runs/last/log', category: 'Runs', summary: 'Get last run log' },
    { method: 'GET', path: '/v2/actors/{actorId}/runs/last/key-value-store', category: 'Runs', summary: 'Get last run KVS' },
    { method: 'GET', path: '/v2/actors/{actorId}/runs/last/key-value-store/keys', category: 'Runs', summary: 'Get last run KVS keys' },
    { method: 'GET', path: '/v2/actors/{actorId}/runs/last/key-value-store/records/{recordKey}', category: 'Runs', summary: 'Get last run KVS record' },
    { method: 'GET', path: '/v2/actors/{actorId}/runs/last/dataset', category: 'Runs', summary: 'Get last run dataset' },
    { method: 'GET', path: '/v2/actors/{actorId}/runs/last/dataset/items', category: 'Runs', summary: 'Get last run dataset items' },
    { method: 'GET', path: '/v2/actors/{actorId}/runs/last/request-queue', category: 'Runs', summary: 'Get last run request queue' },
    { method: 'GET', path: '/v2/actors/{actorId}/runs/last/request-queue/requests', category: 'Runs', summary: 'Get last run RQ requests' },
    { method: 'GET', path: '/v2/actors/{actorId}/runs/last/request-queue/head', category: 'Runs', summary: 'Get last run RQ head' },
    { method: 'POST', path: '/v2/actors/{actorId}/run-sync', category: 'Runs', summary: 'Run actor synchronously' },
    { method: 'GET', path: '/v2/actors/{actorId}/run-sync', category: 'Runs', summary: 'Run actor synchronously (GET)' },
    { method: 'POST', path: '/v2/actors/{actorId}/run-sync-get-dataset-items', category: 'Runs', summary: 'Run actor sync and get dataset items' },
    { method: 'GET', path: '/v2/actors/{actorId}/run-sync-get-dataset-items', category: 'Runs', summary: 'Run actor sync and get dataset items (GET)' },

    // ── Datasets ──
    { method: 'GET', path: '/v2/datasets', category: 'Datasets', summary: 'List datasets' },
    { method: 'POST', path: '/v2/datasets', category: 'Datasets', summary: 'Create dataset' },
    { method: 'GET', path: '/v2/datasets/{datasetId}', category: 'Datasets', summary: 'Get dataset details' },
    { method: 'PUT', path: '/v2/datasets/{datasetId}', category: 'Datasets', summary: 'Update dataset (rename)' },
    { method: 'DELETE', path: '/v2/datasets/{datasetId}', category: 'Datasets', summary: 'Delete dataset' },
    { method: 'GET', path: '/v2/datasets/{datasetId}/items', category: 'Datasets', summary: 'Get dataset items' },
    { method: 'POST', path: '/v2/datasets/{datasetId}/items', category: 'Datasets', summary: 'Push items to dataset' },
    { method: 'GET', path: '/v2/datasets/{datasetId}/statistics', category: 'Datasets', summary: 'Get dataset statistics' },

    // ── Key-Value Stores ──
    { method: 'GET', path: '/v2/key-value-stores', category: 'Key-Value Stores', summary: 'List key-value stores' },
    { method: 'POST', path: '/v2/key-value-stores', category: 'Key-Value Stores', summary: 'Create key-value store' },
    { method: 'GET', path: '/v2/key-value-stores/{storeId}', category: 'Key-Value Stores', summary: 'Get key-value store details' },
    { method: 'PUT', path: '/v2/key-value-stores/{storeId}', category: 'Key-Value Stores', summary: 'Update key-value store (rename)' },
    { method: 'DELETE', path: '/v2/key-value-stores/{storeId}', category: 'Key-Value Stores', summary: 'Delete key-value store' },
    { method: 'GET', path: '/v2/key-value-stores/{storeId}/keys', category: 'Key-Value Stores', summary: 'List keys' },
    { method: 'GET', path: '/v2/key-value-stores/{storeId}/records', category: 'Key-Value Stores', summary: 'List records' },
    { method: 'GET', path: '/v2/key-value-stores/{storeId}/records/{key}', category: 'Key-Value Stores', summary: 'Get record' },
    { method: 'PUT', path: '/v2/key-value-stores/{storeId}/records/{key}', category: 'Key-Value Stores', summary: 'Set record' },
    { method: 'DELETE', path: '/v2/key-value-stores/{storeId}/records/{key}', category: 'Key-Value Stores', summary: 'Delete record' },

    // ── Request Queues ──
    { method: 'GET', path: '/v2/request-queues', category: 'Request Queues', summary: 'List request queues' },
    { method: 'POST', path: '/v2/request-queues', category: 'Request Queues', summary: 'Create request queue' },
    { method: 'GET', path: '/v2/request-queues/{queueId}', category: 'Request Queues', summary: 'Get request queue details' },
    { method: 'PUT', path: '/v2/request-queues/{queueId}', category: 'Request Queues', summary: 'Update request queue (rename)' },
    { method: 'DELETE', path: '/v2/request-queues/{queueId}', category: 'Request Queues', summary: 'Delete request queue' },
    { method: 'GET', path: '/v2/request-queues/{queueId}/requests', category: 'Request Queues', summary: 'List requests' },
    { method: 'POST', path: '/v2/request-queues/{queueId}/requests', category: 'Request Queues', summary: 'Add request' },
    { method: 'POST', path: '/v2/request-queues/{queueId}/requests/batch', category: 'Request Queues', summary: 'Add requests (batch)' },
    { method: 'DELETE', path: '/v2/request-queues/{queueId}/requests/batch', category: 'Request Queues', summary: 'Delete requests (batch)' },
    { method: 'GET', path: '/v2/request-queues/{queueId}/requests/{requestId}', category: 'Request Queues', summary: 'Get request' },
    { method: 'PUT', path: '/v2/request-queues/{queueId}/requests/{requestId}', category: 'Request Queues', summary: 'Update request' },
    { method: 'DELETE', path: '/v2/request-queues/{queueId}/requests/{requestId}', category: 'Request Queues', summary: 'Delete request' },
    { method: 'GET', path: '/v2/request-queues/{queueId}/head', category: 'Request Queues', summary: 'Get queue head' },
    { method: 'POST', path: '/v2/request-queues/{queueId}/head/lock', category: 'Request Queues', summary: 'Lock queue head' },
    { method: 'PUT', path: '/v2/request-queues/{queueId}/requests/{requestId}/lock', category: 'Request Queues', summary: 'Lock request' },
    { method: 'DELETE', path: '/v2/request-queues/{queueId}/requests/{requestId}/lock', category: 'Request Queues', summary: 'Unlock request' },
    { method: 'POST', path: '/v2/request-queues/{queueId}/requests/unlock', category: 'Request Queues', summary: 'Unlock all requests' },

    // ── Tasks ──
    { method: 'GET', path: '/v2/actor-tasks', category: 'Tasks', summary: 'List tasks' },
    { method: 'POST', path: '/v2/actor-tasks', category: 'Tasks', summary: 'Create task' },
    { method: 'GET', path: '/v2/actor-tasks/{taskId}', category: 'Tasks', summary: 'Get task details' },
    { method: 'PUT', path: '/v2/actor-tasks/{taskId}', category: 'Tasks', summary: 'Update task' },
    { method: 'DELETE', path: '/v2/actor-tasks/{taskId}', category: 'Tasks', summary: 'Delete task' },
    { method: 'POST', path: '/v2/actor-tasks/{taskId}/runs', category: 'Tasks', summary: 'Run task' },
    { method: 'POST', path: '/v2/actor-tasks/{taskId}/run-sync', category: 'Tasks', summary: 'Run task synchronously' },
    { method: 'GET', path: '/v2/actor-tasks/{taskId}/runs', category: 'Tasks', summary: 'List task runs' },
    { method: 'GET', path: '/v2/actor-tasks/{taskId}/runs/last', category: 'Tasks', summary: 'Get last task run' },

    // ── Schedules ──
    { method: 'GET', path: '/v2/schedules', category: 'Schedules', summary: 'List schedules' },
    { method: 'POST', path: '/v2/schedules', category: 'Schedules', summary: 'Create schedule' },
    { method: 'GET', path: '/v2/schedules/{scheduleId}', category: 'Schedules', summary: 'Get schedule details' },
    { method: 'PUT', path: '/v2/schedules/{scheduleId}', category: 'Schedules', summary: 'Update schedule' },
    { method: 'DELETE', path: '/v2/schedules/{scheduleId}', category: 'Schedules', summary: 'Delete schedule' },
    { method: 'GET', path: '/v2/schedules/{scheduleId}/log', category: 'Schedules', summary: 'Get schedule log' },

    // ── Automations ──
    { method: 'GET', path: '/v2/automations', category: 'Automations', summary: 'List automations (filters: actorId, savedInputId, search)' },
    { method: 'POST', path: '/v2/automations', category: 'Automations', summary: 'Create automation' },
    { method: 'GET', path: '/v2/automations/{automationId}', category: 'Automations', summary: 'Get automation details' },
    { method: 'PUT', path: '/v2/automations/{automationId}', category: 'Automations', summary: 'Update automation (partial)' },
    { method: 'DELETE', path: '/v2/automations/{automationId}', category: 'Automations', summary: 'Delete automation' },
    { method: 'POST', path: '/v2/automations/{automationId}/duplicate', category: 'Automations', summary: 'Duplicate automation (copy starts paused)' },
    { method: 'POST', path: '/v2/automations/{automationId}/runs', category: 'Automations', summary: 'Run automation now' },
    { method: 'GET', path: '/v2/automations/{automationId}/runs', category: 'Automations', summary: 'List automation runs' },
    { method: 'GET', path: '/v2/automations/{automationId}/runs/{runId}', category: 'Automations', summary: 'Get automation run details' },
    { method: 'GET', path: '/v2/users/me/usage/automations', category: 'Automations', summary: 'AI step costs per automation run (month)' },

    // ── Webhooks ──
    { method: 'GET', path: '/v2/webhooks', category: 'Webhooks', summary: 'List webhooks' },
    { method: 'POST', path: '/v2/webhooks', category: 'Webhooks', summary: 'Create webhook' },
    { method: 'GET', path: '/v2/webhooks/{webhookId}', category: 'Webhooks', summary: 'Get webhook details' },
    { method: 'PUT', path: '/v2/webhooks/{webhookId}', category: 'Webhooks', summary: 'Update webhook' },
    { method: 'DELETE', path: '/v2/webhooks/{webhookId}', category: 'Webhooks', summary: 'Delete webhook' },
    { method: 'POST', path: '/v2/webhooks/{webhookId}/test', category: 'Webhooks', summary: 'Send a test dispatch' },
    { method: 'GET', path: '/v2/webhooks/{webhookId}/dispatches', category: 'Webhooks', summary: 'List webhook dispatches for webhook' },

    // ── Webhook Dispatches ──
    { method: 'GET', path: '/v2/webhook-dispatches', category: 'Webhooks', summary: 'List webhook dispatches' },
    { method: 'GET', path: '/v2/webhook-dispatches/{dispatchId}', category: 'Webhooks', summary: 'Get webhook dispatch details' },

    // ── Users ──
    { method: 'GET', path: '/v2/users/me', category: 'Users', summary: 'Get current user' },
    { method: 'GET', path: '/v2/users/me/stats', category: 'Users', summary: 'Get user stats' },
    { method: 'GET', path: '/v2/users/me/limits', category: 'Users', summary: 'Get user limits' },
    { method: 'GET', path: '/v2/users/me/plan', category: 'Users', summary: 'Get user plan' },
    { method: 'GET', path: '/v2/users/me/usage/monthly', category: 'Users', summary: 'Get monthly usage' },
    { method: 'GET', path: '/v2/users/me/usage/actors', category: 'Users', summary: 'Get actor usage' },
    { method: 'GET', path: '/v2/users/me/usage/daily', category: 'Users', summary: 'Get daily usage' },
    { method: 'GET', path: '/v2/users/me/profile', category: 'Users', summary: 'Get profile' },
    { method: 'PUT', path: '/v2/users/me/profile', category: 'Users', summary: 'Update profile' },
    { method: 'GET', path: '/v2/users/{username}/public-profile', category: 'Users', summary: 'Get public profile' },
    { method: 'DELETE', path: '/v2/users/me/profile/picture', category: 'Users', summary: 'Delete profile picture' },
    { method: 'PUT', path: '/v2/users/me/profile/picture', category: 'Users', summary: 'Update profile picture' },
    { method: 'GET', path: '/v2/plan-tiers', category: 'Users', summary: 'List plan tiers' },

    // ── Auth ──
    { method: 'GET', path: '/v2/auth/check', category: 'Auth', summary: 'Check auth status' },
    { method: 'GET', path: '/v2/api-keys', category: 'Auth', summary: 'List API keys' },
    { method: 'GET', path: '/v2/scrapely', category: 'Auth', summary: 'Get Scrapely integration info' },
    { method: 'POST', path: '/v2/api-keys/reset', category: 'Auth', summary: 'Reset API key' },

    // ── Notification Settings ──
    { method: 'GET', path: '/v2/users/me/notification-settings', category: 'Notifications', summary: 'Get notification settings' },
    { method: 'PUT', path: '/v2/users/me/notification-settings', category: 'Notifications', summary: 'Update notification settings' },

    // ── Console Notifications ──
    { method: 'GET', path: '/v2/console-notifications', category: 'Notifications', summary: 'List dashboard notifications' },
    { method: 'GET', path: '/v2/console-notifications/unread-count', category: 'Notifications', summary: 'Get unread count' },
    { method: 'PATCH', path: '/v2/console-notifications/read-all', category: 'Notifications', summary: 'Mark all as read' },
    { method: 'PATCH', path: '/v2/console-notifications/{id}/read', category: 'Notifications', summary: 'Mark notification as read' },
    { method: 'DELETE', path: '/v2/console-notifications', category: 'Notifications', summary: 'Delete notifications' },

    // ── Search ──
    { method: 'GET', path: '/v2/search', category: 'Search', summary: 'Search actors, tasks, datasets' },

    // ── Standby ──
    { method: 'ALL', path: '/v2/{username}/{actorName}', category: 'Standby', summary: 'Standby actor endpoint' },
    { method: 'ALL', path: '/v2/{username}/{actorName}/*', category: 'Standby', summary: 'Standby actor proxy' },

    // ── Admin (internal) ──
    { method: 'GET', path: '/admin/users/cluster/stats', category: 'Admin', summary: 'Cluster statistics' },
    { method: 'POST', path: '/admin/users/jobs/storage-usage/run', category: 'Admin', summary: 'Run storage usage job' },
    { method: 'POST', path: '/admin/users/jobs/ttl-cleanup/run', category: 'Admin', summary: 'Run TTL cleanup job' },
    { method: 'POST', path: '/admin/users/jobs/s3-cleanup/run', category: 'Admin', summary: 'Run S3 cleanup job' },
    { method: 'POST', path: '/admin/users/jobs/actor-tester/run', category: 'Admin', summary: 'Run actor tester job' },
    { method: 'GET', path: '/admin/users/list', category: 'Admin', summary: 'List users' },
    { method: 'GET', path: '/admin/users/{userId}/info', category: 'Admin', summary: 'Get user info' },
    { method: 'GET', path: '/admin/users/{userId}/api-key', category: 'Admin', summary: 'Get user API key' },
    { method: 'POST', path: '/admin/users/{userId}/api-key/reset', category: 'Admin', summary: 'Reset user API key' },
    { method: 'POST', path: '/admin/users/{userId}/credits', category: 'Admin', summary: 'Add credits to user' },
    { method: 'GET', path: '/admin/users/{userId}/credits', category: 'Admin', summary: 'Get user credits' },
    { method: 'DELETE', path: '/admin/users/{userId}/credits', category: 'Admin', summary: 'Remove credits' },
    { method: 'GET', path: '/admin/users/{userId}/balance', category: 'Admin', summary: 'Get user balance' },
    { method: 'GET', path: '/admin/users/{userId}/usage', category: 'Admin', summary: 'Get user usage' },
    { method: 'GET', path: '/admin/users/{userId}/plan', category: 'Admin', summary: 'Get user plan' },
];

/**
 * List all available API endpoints, optionally filtered by search query.
 * Endpoints are grouped by category for readability.
 */
function listEndpoints(searchQuery?: string): void {
    let endpoints = API_ENDPOINTS;

    if (searchQuery) {
        const query = searchQuery.toLowerCase();
        endpoints = API_ENDPOINTS.filter(
            (ep) =>
                ep.path.toLowerCase().includes(query) ||
                ep.method.toLowerCase().includes(query) ||
                ep.summary.toLowerCase().includes(query) ||
                ep.category.toLowerCase().includes(query),
        );
    }

    if (endpoints.length === 0) {
        console.log(chalk.gray('  No endpoints found matching your search.'));
        return;
    }

    // Group by category
    const categories = [...new Set(endpoints.map((ep) => ep.category))].sort();

    for (const category of categories) {
        console.log(chalk.bold.cyan(`\n  ${category}`));
        const categoryEndpoints = endpoints.filter((ep) => ep.category === category);
        for (const endpoint of categoryEndpoints) {
            const methodColor =
                endpoint.method === 'GET'
                    ? chalk.green
                    : endpoint.method === 'POST'
                      ? chalk.blue
                      : endpoint.method === 'PUT'
                        ? chalk.yellow
                        : endpoint.method === 'DELETE'
                          ? chalk.red
                          : endpoint.method === 'PATCH'
                            ? chalk.magenta
                            : endpoint.method === 'ALL'
                              ? chalk.gray
                              : chalk.white;

            console.log(`    ${methodColor(endpoint.method.padEnd(6))} ${chalk.cyan(endpoint.path)}`);
            console.log(`           ${chalk.gray(endpoint.summary)}`);
        }
    }

    console.log();
    console.log(chalk.gray('Usage: scrapely api <method> <endpoint>'));
    console.log(chalk.gray('       scrapely api <endpoint>            (defaults to GET)'));
    console.log(chalk.gray('       scrapely api --list-endpoints'));
    console.log(chalk.gray('       scrapely api --list-endpoints -s <query>'));
}

/**
 * Describe an endpoint
 */
function describeEndpoint(endpointPath: string): void {
    // Normalize path
    let path = endpointPath;
    if (!path.startsWith('/')) {
        path = '/' + path;
    }
    if (!path.startsWith('/v2/') && !path.startsWith('/v1/') && !path.startsWith('/admin/')) {
        path = '/v2' + path;
    }

    // A path can have several methods (GET and PUT, ...): describe each.
    const matches = API_ENDPOINTS.filter(
        (ep) => ep.path === path || ep.path.replace(/{[^}]+}/g, '*') === path.replace(/{[^}]+}/g, '*'),
    );

    if (matches.length === 0) {
        console.log(chalk.yellow(`Endpoint not found: ${endpointPath}`));
        console.log(chalk.gray('Use --list-endpoints to see all available endpoints.'));
        return;
    }

    const endpoint = matches[0]!;
    console.log(chalk.bold(`Endpoint: ${endpoint.path}`));
    console.log();
    for (const ep of matches) {
        console.log(`  Method: ${chalk.cyan(ep.method)}  ${ep.summary}`);
    }
    console.log(`  Category: ${chalk.gray(endpoint.category)}`);
    console.log();

    // Extract path parameters
    const pathParams = endpoint.path.match(/{([^}]+)}/g);
    if (pathParams && pathParams.length > 0) {
        console.log(chalk.bold('Path Parameters:'));
        for (const param of pathParams) {
            console.log(`  ${chalk.cyan(param)}`);
        }
        console.log();
    }

    console.log(chalk.gray('Usage:'));
    for (const ep of matches) {
        if (ep.method === 'GET' || ep.method === 'ALL') {
            console.log(chalk.gray(`  scrapely api ${ep.path}`));
        } else if (ep.method === 'POST' || ep.method === 'PUT' || ep.method === 'PATCH') {
            console.log(chalk.gray(`  scrapely api ${ep.method} ${ep.path} -d '{"key": "value"}'`));
        } else if (ep.method === 'DELETE') {
            console.log(chalk.gray(`  scrapely api DELETE ${ep.path}`));
        }
    }
}

/**
 * Make an authenticated API request
 */
export async function apiCommand(
    methodOrEndpoint?: string,
    endpoint?: string,
    options?: {
        body?: string;
        params?: string;
        header?: string;
        method?: string;
        listEndpoints?: boolean;
        describe?: string;
        search?: string;
    },
): Promise<void> {
    // Handle --list-endpoints
    if (options?.listEndpoints) {
        listEndpoints(options.search);
        return;
    }

    // Handle --describe
    if (options?.describe) {
        describeEndpoint(options.describe);
        return;
    }

    // Parse arguments
    let httpMethod = 'GET';
    let apiPath = '';

    if (!methodOrEndpoint) {
        console.error(chalk.red('Error: No endpoint specified.'));
        console.log(chalk.gray('Use --list-endpoints to see available endpoints.'));
        process.exit(1);
    }

    // Check if first arg is an HTTP method
    const httpMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
    if (httpMethods.includes(methodOrEndpoint.toUpperCase())) {
        httpMethod = methodOrEndpoint.toUpperCase();
        apiPath = endpoint || '';
    } else {
        apiPath = methodOrEndpoint;
        httpMethod = options?.method || 'GET';
    }

    if (!apiPath) {
        console.error(chalk.red('Error: No endpoint specified.'));
        process.exit(1);
    }

    // Normalize path
    if (!apiPath.startsWith('/')) {
        apiPath = '/' + apiPath;
    }
    if (!apiPath.startsWith('/v2/') && !apiPath.startsWith('/v1/') && !apiPath.startsWith('/admin/')) {
        apiPath = '/v2' + apiPath;
    }

    // Authenticated request through the scrapely-client HTTP layer — the same
    // auth, retry, timeout and error-handling path every other command uses.
    const client = getLoggedClientOrThrow();
    const apiBaseUrl = getApiBaseUrl();

    // Parse query params
    let params: Record<string, string> | undefined;
    if (options?.params) {
        try {
            const parsed = JSON.parse(options.params);
            params = {};
            for (const [key, value] of Object.entries(parsed)) {
                params[key] = String(value);
            }
        } catch {
            console.error(chalk.red('Error: Invalid JSON for --params'));
            process.exit(1);
        }
    }

    // Build headers (Authorization is attached automatically by the client's HTTP layer)
    const headers: Record<string, string> = {};

    if (options?.header) {
        try {
            // Check if it's JSON or key:value format
            if (options.header.startsWith('{')) {
                const parsedHeaders = JSON.parse(options.header);
                Object.assign(headers, parsedHeaders);
            } else {
                for (const h of options.header.split(',')) {
                    const [key, ...valueParts] = h.split(':');
                    if (key && valueParts.length > 0) {
                        headers[key.trim()] = valueParts.join(':').trim();
                    }
                }
            }
        } catch {
            console.error(chalk.red('Error: Invalid header format. Use "Key:Value" or JSON.'));
            process.exit(1);
        }
    }

    // Build request body
    let body: string | undefined;
    if (options?.body) {
        if (options.body === '-') {
            // Read from stdin
            body = await new Promise<string>((resolve, reject) => {
                let data = '';
                process.stdin.setEncoding('utf-8');
                process.stdin.on('readable', () => {
                    let chunk;
                    while ((chunk = process.stdin.read()) !== null) {
                        data += chunk;
                    }
                });
                process.stdin.on('end', () => resolve(data));
                process.stdin.on('error', reject);
            });
        } else {
            body = options.body;
        }

        // Validate JSON body
        try {
            JSON.parse(body);
            headers['Content-Type'] = 'application/json';
        } catch {
            console.error(chalk.red('Error: Invalid JSON body.'));
            process.exit(1);
        }
    }

    // Make request
    try {
        const response = await client.httpClient.call({
            url: `${apiBaseUrl}${apiPath}`,
            method: httpMethod as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
            ...(params ? { params } : {}),
            headers,
            ...(body !== undefined ? { data: body } : {}),
        });

        // Pretty-print JSON responses, print everything else as-is (made terminal-safe on a TTY)
        const data = response.data;
        if (typeof data === 'string') {
            let pretty: string | undefined;
            try {
                pretty = JSON.stringify(JSON.parse(data), null, 2);
            } catch {
                pretty = undefined;
            }
            console.log(pretty !== undefined ? terminalJson(pretty) : stdoutSafeText(data));
        } else if (data !== undefined && data !== '') {
            console.log(terminalJson(JSON.stringify(data, null, 2)));
        }
    } catch (err) {
        // ApifyApiError: the API responded with an error body — print it like
        // a response (parity with the raw-fetch behavior this command had)
        const apiError = err as { statusCode?: number; data?: unknown; message?: string };
        if (apiError.statusCode) {
            const data = apiError.data;
            if (data !== undefined && data !== '') {
                console.log(typeof data === 'string' ? stdoutSafeText(data) : terminalJson(JSON.stringify(data, null, 2)));
            } else if (apiError.message) {
                // Scrapely's API puts the error text in { error: { message } },
                // which the client surfaces as the error message.
                console.log(stdoutSafeText(apiError.message));
            } else {
                console.error(chalk.red(`Error: API responded with status ${apiError.statusCode}.`));
            }
            process.exit(1);
        }
        console.error(chalk.red('Error: Failed to make API request.'));
        console.error(chalk.gray(`Details: ${terminalSafeError(err)}`));
        process.exit(1);
    }
}

/**
 * Set up the api command
 */
export function setupApiCommand(program: Command): void {
    const apiCmd = program
        .command('api [methodOrEndpoint] [endpoint]')
        .description('Make an authenticated HTTP request to the Scrapely API');

    apiCmd
        .option('-d, --body <body>', 'Request body (JSON string). Use "-" to read from stdin.')
        .option('-p, --params <json>', 'Query parameters as JSON object')
        .option('-H, --header <header>', 'Additional HTTP header(s). Use "Key:Value" format or JSON object.')
        .option('-X, --method <method>', 'HTTP method (GET, POST, PUT, PATCH, DELETE)')
        .option('-l, --list-endpoints', 'List all available API endpoints')
        .option('--describe <path>', 'Describe an endpoint by path')
        .option('-s, --search <query>', 'Search endpoints (used with --list-endpoints)')
        .action((methodOrEndpoint, endpoint, options) => apiCommand(methodOrEndpoint, endpoint, options));
}