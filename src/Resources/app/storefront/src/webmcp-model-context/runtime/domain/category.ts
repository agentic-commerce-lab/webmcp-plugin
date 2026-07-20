import { cleanText, isPlainObject, normalizeUrl, removeEmptyValues } from '../tools/storefront-tool.utils';
import type { UnknownRecord } from '../types';

export function normalizeCategories(collection: any, baseUrl: string): UnknownRecord[] {
    const items = Array.isArray(collection)
        ? collection
        : isPlainObject(collection?.elements)
          ? Object.values(collection.elements)
          : [];

    return items
        .map((category) => {
            const translated = isPlainObject(category.translated) ? category.translated : {};

            return removeEmptyValues({
                id: category.id,
                name: cleanText(translated.name) || cleanText(category.name),
                parentId: cleanText(category.parentId),
                active: category.active,
                url: normalizeCategoryUrl(category, baseUrl),
            });
        })
        .filter((category) => category.id && category.name);
}

function normalizeCategoryUrl(category: any, baseUrl: string): string | null {
    const seoUrl = Array.isArray(category.seoUrls)
        ? category.seoUrls.find((candidate: any) => candidate?.isCanonical) || category.seoUrls[0]
        : null;
    const seoPath = cleanText(seoUrl?.seoPathInfo || seoUrl?.pathInfo);

    return seoPath ? normalizeUrl(seoPath, baseUrl) : null;
}

export function normalizeCategoryNode(category: any, baseUrl: string, parentId: string | null): UnknownRecord | null {
    if (!isPlainObject(category)) {
        return null;
    }

    const id = cleanText(category.id);
    const translated = isPlainObject(category.translated) ? category.translated : {};
    const name = cleanText(translated.name) || cleanText(category.name);

    if (!id || !name) {
        return null;
    }

    const children = Array.isArray(category.children)
        ? category.children
              .map((child: any) => normalizeCategoryNode(child, baseUrl, id))
              .filter((child: UnknownRecord | null): child is UnknownRecord => child !== null)
        : [];

    return {
        id,
        name,
        parentId: cleanText(category.parentId) || parentId,
        active: false,
        url: normalizeCategoryUrl(category, baseUrl) || `${baseUrl}/navigation/${id}`,
        children,
    };
}

// Marks the currently viewed category and its ancestors as active, so consumers
// can tell where in the tree the shopper is. The Store API navigation tree has no
// "selected" flag; the active category id is injected server-side from the page.
export function markActiveCategoryTrail(tree: UnknownRecord[], activeCategoryId: string | null): void {
    const activeId = cleanText(activeCategoryId);

    if (!activeId) {
        return;
    }

    const nodeById = new Map<string, UnknownRecord>();

    const index = (nodes: UnknownRecord[]): void => {
        nodes.forEach((node) => {
            nodeById.set(node.id as string, node);

            if (Array.isArray(node.children)) {
                index(node.children as UnknownRecord[]);
            }
        });
    };

    index(tree);

    let node = nodeById.get(activeId);

    while (node) {
        node.active = true;
        const parentId = cleanText(node.parentId);
        node = parentId ? nodeById.get(parentId) : undefined;
    }
}
