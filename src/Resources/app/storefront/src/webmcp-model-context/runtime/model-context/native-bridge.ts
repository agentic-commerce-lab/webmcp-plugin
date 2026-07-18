import type { ModelContextTool, NativeModelContext, NativeModelContextTool, ToolInput, UnknownRecord } from '../types';

const NATIVE_TOOL_REGISTRY_KEY = '__swagWebMcpNativeToolRegistry';

export function registerNativeModelContextTool(tool: ModelContextTool): string | null {
    const nativeModelContext = getNativeModelContext();

    if (!nativeModelContext) {
        return null;
    }

    const registry = getNativeToolRegistry();
    const existingNativeToolName = registry.get(tool.name);

    if (existingNativeToolName) {
        return existingNativeToolName;
    }

    const nativeTool = createNativeModelContextTool(tool);

    if (tryRegisterNativeModelContextTool(nativeModelContext, nativeTool)) {
        registry.set(tool.name, tool.name);

        return tool.name;
    }

    return null;
}

export function unregisterNativeModelContextTool(toolName: string): boolean {
    const nativeModelContext = getNativeModelContext();
    const registry = getNativeToolRegistry();
    const registeredNativeToolName = registry.get(toolName);
    const nativeToolName = registeredNativeToolName || toolName;
    let removed = false;

    if (nativeModelContext && typeof nativeModelContext.unregisterTool === 'function') {
        try {
            nativeModelContext.unregisterTool(nativeToolName);
        } catch (error) {
            try {
                nativeModelContext.unregisterTool({ name: nativeToolName });
            } catch (nestedError) {
                // The fallback registry still removes disabled tools even when the native API cannot unregister.
            }
        }
    }

    if (registry.delete(toolName)) {
        removed = true;
    }

    return removed;
}

function getNativeModelContext(): NativeModelContext | null {
    const candidates = [
        typeof navigator !== 'undefined' ? navigator.modelContext : null,
        typeof document !== 'undefined' ? document.modelContext : null,
        typeof navigator !== 'undefined' ? navigator.modelContextTesting : null,
    ];

    return (
        (candidates.find((candidate) => {
            return (
                Boolean(candidate) &&
                typeof candidate === 'object' &&
                typeof (candidate as UnknownRecord).registerTool === 'function'
            );
        }) as NativeModelContext | undefined) || null
    );
}

function createNativeModelContextTool(tool: ModelContextTool): NativeModelContextTool {
    const execute = async (input: unknown = {}) => {
        const result = await tool.execute(normalizeNativeToolInput(input) as ToolInput);

        return serializeNativeToolResult(result);
    };

    return removeEmptyValues({
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
        execute,
        handler: execute,
    }) as NativeModelContextTool;
}

function tryRegisterNativeModelContextTool(
    nativeModelContext: NativeModelContext,
    nativeTool: NativeModelContextTool,
): boolean {
    const registerTool = nativeModelContext.registerTool.bind(nativeModelContext);
    const attempts = [
        () => registerTool(nativeTool),
        () => registerTool(nativeTool.name, nativeTool),
        () =>
            registerTool(
                nativeTool.name,
                {
                    description: nativeTool.description,
                    inputSchema: nativeTool.inputSchema,
                    annotations: nativeTool.annotations,
                },
                nativeTool.handler,
            ),
        () => registerTool(nativeTool.name, nativeTool.description, nativeTool.inputSchema, nativeTool.handler),
    ];

    for (const attempt of attempts) {
        try {
            const result = attempt();

            if (result && typeof (result as Promise<unknown>).catch === 'function') {
                (result as Promise<unknown>).catch(() => {
                    unregisterNativeModelContextTool(nativeTool.name);
                });
            }

            return true;
        } catch (error) {
            // Try the next experimental WebMCP registration signature.
        }
    }

    return false;
}

function normalizeNativeToolInput(input: unknown): unknown {
    if (typeof input !== 'string') {
        return input ?? {};
    }

    const trimmedInput = input.trim();

    if (!trimmedInput) {
        return {};
    }

    try {
        return JSON.parse(trimmedInput);
    } catch (error) {
        throw new Error('WebMCP tool input must be valid JSON.', { cause: error });
    }
}

function serializeNativeToolResult(result: unknown): string {
    if (typeof result === 'string') {
        return result;
    }

    try {
        return JSON.stringify(result);
    } catch (error) {
        return String(result);
    }
}

function getNativeToolRegistry(): Map<string, string> {
    if (!(window[NATIVE_TOOL_REGISTRY_KEY] instanceof Map)) {
        window[NATIVE_TOOL_REGISTRY_KEY] = new Map();
    }

    return window[NATIVE_TOOL_REGISTRY_KEY];
}

function removeEmptyValues(value: UnknownRecord): UnknownRecord {
    return Object.entries(value).reduce((normalizedValue, [key, item]) => {
        if (item === null || typeof item === 'undefined' || item === '') {
            return normalizedValue;
        }

        normalizedValue[key] = item;

        return normalizedValue;
    }, {} as UnknownRecord);
}
