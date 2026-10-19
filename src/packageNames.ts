/**
 * Published package names — keep in sync with scrapely/config/package-names.json.
 * CLI ships standalone, so values are inlined (same defaults as the monorepo config).
 */
export type PackageNames = {
    nodeSdk: string;
    nodeSdkScope: string;
    nodeSdkShim: string;
    cli: string;
    cliUnscoped: string;
    cliBin: string;
    pythonSdk: string;
};

export const PACKAGE_NAMES: PackageNames = {
    nodeSdk: 'scrapely',
    nodeSdkScope: '',
    nodeSdkShim: 'scrapely',
    cli: 'scrapely-cli',
    cliUnscoped: 'scrapely-cli',
    cliBin: 'scrapely',
    pythonSdk: 'scrapely-python',
};

export function getPackageNames(): PackageNames {
    return PACKAGE_NAMES;
}
