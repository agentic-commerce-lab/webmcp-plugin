import { cleanText, isPlainObject } from '../tools/storefront-tool.utils';
import type { UnknownRecord } from '../types';

/** A single variant option (e.g. "red") within a configurator group. */
export interface VariantOption {
    id: string;
    name: string;
}

/** A configurator group (e.g. "Color") with its selectable options. */
export interface VariantGroup {
    id: string;
    name: string | null;
    options: VariantOption[];
}

/** A caller-provided selection, either by human-readable names or by option id. */
export interface VariantSelection {
    group?: string | undefined;
    option?: string | undefined;
}

/** The resolved outcome of matching selections against the configurator. */
export interface MatchedVariantSelection {
    group: string | null;
    option: string;
    optionId: string;
    groupId: string;
}

export interface VariantMatch {
    /** groupId → optionId map, the shape Shopware's variant switch route expects. */
    optionsMap: Record<string, string>;
    matched: MatchedVariantSelection[];
}

/**
 * Extracts the configurator (all groups and their options across the product's variants)
 * from a Store API product-detail response. Returns an empty list for a product without
 * variants.
 */
export function extractConfiguratorGroups(configurator: unknown): VariantGroup[] {
    return toArray(configurator)
        .map((group) => {
            if (!isPlainObject(group)) {
                return null;
            }

            const id = cleanText(group.id);

            if (!id) {
                return null;
            }

            const options = toArray(group.options)
                .map((option) => normalizeVariantOption(option))
                .filter((option): option is VariantOption => option !== null);

            if (options.length === 0) {
                return null;
            }

            return { id, name: translatedName(group), options };
        })
        .filter((group): group is VariantGroup => group !== null);
}

/**
 * Reads the current product's own selected options into a `{groupId: optionId}` map, so a
 * partial selection ("just XL") can be merged onto the variant the shopper is already viewing.
 */
export function extractCurrentOptionMap(options: unknown): Record<string, string> {
    const map: Record<string, string> = {};

    toArray(options).forEach((option) => {
        if (!isPlainObject(option)) {
            return;
        }

        const optionId = cleanText(option.id);
        const groupRef = isPlainObject(option.group) ? option.group : null;
        const groupId = cleanText(option.groupId) || cleanText(groupRef?.id);

        if (optionId && groupId) {
            map[groupId] = optionId;
        }
    });

    return map;
}

/**
 * Resolves caller selections (by name or by explicit option id) into the `{groupId: optionId}`
 * map used to resolve the concrete variant. Throws a descriptive error listing the available
 * groups/options when a selection cannot be matched, so the agent can correct itself.
 */
export function matchVariantSelections(
    groups: VariantGroup[],
    selections: VariantSelection[] = [],
    optionIds: string[] = [],
): VariantMatch {
    const optionsMap: Record<string, string> = {};
    const matched: MatchedVariantSelection[] = [];

    const record = (group: VariantGroup, option: VariantOption): void => {
        optionsMap[group.id] = option.id;

        const existingIndex = matched.findIndex((entry) => entry.groupId === group.id);
        const entry: MatchedVariantSelection = {
            group: group.name,
            option: option.name,
            optionId: option.id,
            groupId: group.id,
        };

        if (existingIndex >= 0) {
            matched[existingIndex] = entry;
        } else {
            matched.push(entry);
        }
    };

    optionIds.forEach((rawId) => {
        const optionId = cleanText(rawId);

        if (!optionId) {
            return;
        }

        const found = findByOptionId(groups, optionId);

        if (!found) {
            throw new Error(
                `Option id "${optionId}" is not part of this product's variants. ${describeGroups(groups)}`,
            );
        }

        record(found.group, found.option);
    });

    selections.forEach((selection) => {
        const groupTerm = cleanText(selection.group);
        const optionTerm = cleanText(selection.option);

        if (!optionTerm) {
            throw new Error('Each variant selection needs an option value.');
        }

        const found = findByNames(groups, groupTerm, optionTerm);

        if (!found) {
            const scope = groupTerm ? `"${optionTerm}" in group "${groupTerm}"` : `"${optionTerm}"`;
            throw new Error(`No variant option matches ${scope}. ${describeGroups(groups)}`);
        }

        record(found.group, found.option);
    });

    return { optionsMap, matched };
}

function findByOptionId(
    groups: VariantGroup[],
    optionId: string,
): { group: VariantGroup; option: VariantOption } | null {
    for (const group of groups) {
        const option = group.options.find((candidate) => candidate.id === optionId);

        if (option) {
            return { group, option };
        }
    }

    return null;
}

function findByNames(
    groups: VariantGroup[],
    groupTerm: string | null,
    optionTerm: string,
): { group: VariantGroup; option: VariantOption } | null {
    const candidateGroups = groupTerm
        ? groups.filter((group) => matchesTerm(group.name, groupTerm) || group.id === groupTerm)
        : groups;

    for (const group of candidateGroups) {
        const option = group.options.find(
            (candidate) => matchesTerm(candidate.name, optionTerm) || candidate.id === optionTerm,
        );

        if (option) {
            return { group, option };
        }
    }

    return null;
}

function matchesTerm(value: string | null, term: string): boolean {
    return typeof value === 'string' && value.toLowerCase() === term.toLowerCase();
}

function describeGroups(groups: VariantGroup[]): string {
    if (groups.length === 0) {
        return 'This product has no selectable variants.';
    }

    const summary = groups
        .map((group) => `${group.name || 'options'}: ${group.options.map((option) => option.name).join(', ')}`)
        .join('; ');

    return `Available options — ${summary}.`;
}

function normalizeVariantOption(option: unknown): VariantOption | null {
    if (!isPlainObject(option)) {
        return null;
    }

    const id = cleanText(option.id);
    const name = translatedName(option);

    if (!id || !name) {
        return null;
    }

    return { id, name };
}

function translatedName(entity: UnknownRecord): string | null {
    const translated = isPlainObject(entity.translated) ? entity.translated : {};

    return cleanText(translated.name) || cleanText(entity.name);
}

function toArray(value: unknown): any[] {
    if (Array.isArray(value)) {
        return value;
    }

    if (isPlainObject(value) && isPlainObject(value.elements)) {
        return Object.values(value.elements);
    }

    if (isPlainObject(value)) {
        return Object.values(value);
    }

    return [];
}
