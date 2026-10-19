/**
 * Validation for input-schema categories: a UI-only way to group input fields into
 * collapsible, optionally nested sections. Categories never affect input
 * validation, defaults or runs.
 *
 *   "categories": {
 *     "filters": { "title": "Filters", "defaultCollapsed": true },
 *     "dates":   { "title": "Date range", "parent": "filters" }
 *   },
 *   "properties": { "afterDate": { "type": "string", "category": "dates" } }
 *
 * Keep in sync with scrapely-server/src/utils/inputSchemaCategories.ts.
 */

export const MAX_CATEGORY_DEPTH = 3;
/** Above this, `categories` is ignored, which keeps validation and rendering cheap on any schema. */
export const MAX_CATEGORIES = 100;
/** "Did you mean" hints compare short keys only, and only for the first few typos. */
const MAX_HINT_KEY_LENGTH = 64;
const MAX_HINTS = 20;

/** `defaultCollapsed` is canonical; `collapsed` and `default_contracted` are accepted aliases. */
export const CATEGORY_COLLAPSED_KEYS = ['defaultCollapsed', 'collapsed', 'default_contracted'] as const;
const CATEGORY_KEYS = ['title', 'description', 'parent', ...CATEGORY_COLLAPSED_KEYS];

export interface InputSchemaIssue {
    level: 'error' | 'warning';
    path: string;
    message: string;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function levenshtein(a: string, b: string): number {
    const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        let diag = prev[0];
        prev[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const tmp = prev[j];
            prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
            diag = tmp;
        }
    }
    return prev[b.length];
}

/** Closest candidate within a typo-sized edit distance, for "did you mean" hints. */
export function closestKey(value: string, candidates: Iterable<string>): string | undefined {
    if (value.length > MAX_HINT_KEY_LENGTH) return undefined;
    const needle = value.toLowerCase();
    let best: string | undefined;
    let bestDistance = Infinity;
    for (const candidate of candidates) {
        if (candidate.length > MAX_HINT_KEY_LENGTH) continue;
        const distance = levenshtein(needle, candidate.toLowerCase());
        if (distance < bestDistance) {
            best = candidate;
            bestDistance = distance;
        }
    }
    const limit = Math.max(2, Math.floor(value.length / 3));
    return best !== undefined && bestDistance <= limit ? best : undefined;
}

/** Validates the `categories` map and every `category` reference. Returns issues; never throws. */
export function validateInputSchemaCategories(schema: unknown): InputSchemaIssue[] {
    const issues: InputSchemaIssue[] = [];
    if (!isRecord(schema)) return issues;
    let hintsLeft = MAX_HINTS;
    const hint = (value: string, candidates: Iterable<string>): string => {
        if (hintsLeft <= 0) return '';
        hintsLeft--;
        const match = closestKey(value, candidates);
        return match ? ` Did you mean "${match}"?` : '';
    };
    const error = (path: string, message: string) => issues.push({ level: 'error', path, message });
    const warning = (path: string, message: string) => issues.push({ level: 'warning', path, message });

    const properties = isRecord(schema.properties) ? schema.properties : {};
    const rawCategories = schema.categories;
    const categories = new Map<string, UnknownRecord>();

    if (rawCategories !== undefined) {
        const count = isRecord(rawCategories) ? Object.keys(rawCategories).length : 0;
        if (!isRecord(rawCategories)) {
            error('categories', 'must be an object that maps category keys to { "title": ... } definitions.');
        } else if (count > MAX_CATEGORIES) {
            error('categories', `defines ${count} categories; the maximum is ${MAX_CATEGORIES}. All categories are ignored and every field is shown ungrouped.`);
            return issues;
        } else {
            for (const [key, def] of Object.entries(rawCategories)) {
                const path = `categories.${key}`;
                if (!key.trim()) {
                    error(path, 'category keys must be non-empty.');
                    continue;
                }
                if (!isRecord(def)) {
                    error(path, 'must be an object such as { "title": "Advanced" }.');
                    continue;
                }
                categories.set(key, def);

                if (def.title === undefined) {
                    warning(path, `has no "title"; the key "${key}" is shown instead.`);
                } else if (typeof def.title !== 'string' || !def.title.trim()) {
                    error(`${path}.title`, 'must be a non-empty string.');
                }
                if (def.description !== undefined && typeof def.description !== 'string') {
                    error(`${path}.description`, 'must be a string.');
                }
                const collapsedValues: boolean[] = [];
                for (const flag of CATEGORY_COLLAPSED_KEYS) {
                    if (def[flag] === undefined) continue;
                    if (typeof def[flag] !== 'boolean') error(`${path}.${flag}`, 'must be true or false.');
                    else collapsedValues.push(def[flag] as boolean);
                }
                if (new Set(collapsedValues).size > 1) {
                    warning(path, `sets conflicting collapse flags; "defaultCollapsed" wins over "collapsed", which wins over "default_contracted".`);
                }
                if (def.parent !== undefined && typeof def.parent !== 'string') {
                    error(`${path}.parent`, 'must be the key of another category.');
                }
                for (const field of Object.keys(def)) {
                    if (!CATEGORY_KEYS.includes(field)) {
                        warning(`${path}.${field}`, `is not a category setting and is ignored.${hint(field, CATEGORY_KEYS)}`);
                    }
                }
            }
        }
    }

    const keys = [...categories.keys()];
    const parentOf = new Map<string, string>();
    for (const key of keys) {
        const parent = categories.get(key)!.parent;
        if (typeof parent !== 'string') continue;
        if (parent === key) {
            error(`categories.${key}.parent`, 'a category cannot be its own parent.');
        } else if (!categories.has(parent)) {
            error(`categories.${key}.parent`, `unknown category "${parent}".${hint(parent, keys)} The category is shown at the top level.`);
        } else {
            parentOf.set(key, parent);
        }
    }

    // Cycles: walk each category's parent chain; a chain that revisits a key loops.
    const reportedCycle = new Set<string>();
    for (const key of keys) {
        const chain: string[] = [];
        const onChain = new Set<string>();
        let current: string | undefined = key;
        while (current !== undefined && !onChain.has(current)) {
            chain.push(current);
            onChain.add(current);
            current = parentOf.get(current);
        }
        if (current === key && !reportedCycle.has(key)) {
            for (const member of chain) reportedCycle.add(member);
            error(`categories.${key}.parent`, `parent chain loops: ${[...chain, key].join(' → ')}.`);
        }
    }
    for (const member of reportedCycle) parentOf.delete(member);

    for (const key of keys) {
        let depth = 1;
        for (let current = parentOf.get(key); current !== undefined; current = parentOf.get(current)) depth++;
        if (depth > MAX_CATEGORY_DEPTH) {
            error(`categories.${key}.parent`, `nests ${depth} levels deep; the maximum is ${MAX_CATEGORY_DEPTH}.`);
        }
    }

    const used = new Set<string>();
    for (const [name, def] of Object.entries(properties)) {
        if (!isRecord(def) || def.category === undefined) continue;
        const path = `properties.${name}.category`;
        if (typeof def.category !== 'string') {
            error(path, 'must be the key of a category defined in "categories".');
            continue;
        }
        if (!categories.has(def.category)) {
            const where = keys.length ? hint(def.category, keys) : ' No "categories" are defined.';
            error(path, `unknown category "${def.category}".${where} The field is shown ungrouped.`);
            continue;
        }
        if (def.sectionCaption !== undefined) {
            warning(`properties.${name}.sectionCaption`, 'is ignored because the field has a "category".');
        }
        for (let current: string | undefined = def.category; current !== undefined && !used.has(current); current = parentOf.get(current)) {
            used.add(current);
        }
    }
    for (const key of keys) {
        if (!used.has(key)) warning(`categories.${key}`, 'is not used by any property and is not shown.');
    }

    for (const [name, def] of Object.entries(properties)) {
        if (!isRecord(def) || !isRecord(def.properties)) continue;
        for (const [child, childDef] of Object.entries(def.properties)) {
            if (isRecord(childDef) && childDef.category !== undefined) {
                warning(`properties.${name}.properties.${child}.category`, 'only top-level properties can be grouped; ignored.');
            }
        }
    }

    return issues;
}

export function formatInputSchemaIssue(issue: InputSchemaIssue): string {
    return `${issue.path}: ${issue.message}`;
}
