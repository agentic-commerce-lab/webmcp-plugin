import type {
    ModelContext,
    ModelContextTool,
    NativeModelContext,
    NativeModelContextTool,
    ToolInput,
    UnknownRecord,
} from './types';
import { isPlainObject } from './tools/storefront-tool.utils';

const SWAG_WEB_MCP_TOOL_NAME_PREFIX = 'shopware_webmcp_';
const ORIGINAL_GET_TOOLS_KEY = '__swagWebMcpOriginalGetTools';
const ORIGINAL_CALL_TOOL_KEY = '__swagWebMcpOriginalCallTool';
const WRAPPED_HELPER_KEY = '__swagWebMcpWrapped';
const NATIVE_TOOL_REGISTRY_KEY = '__swagWebMcpNativeToolRegistry';

export function getModelContext(): ModelContext {
    if (!isPlainObject(document.modelContext)) {
        document.modelContext = {
            tools: [],
        };
    }

    if (!Array.isArray(document.modelContext.tools)) {
        document.modelContext.tools = [];
    }

    return document.modelContext;
}

function getExistingModelContext(): ModelContext | null {
    if (!isPlainObject(document.modelContext) || !Array.isArray(document.modelContext.tools)) {
        return null;
    }

    return document.modelContext;
}

export function registerModelContextTool(tool: ModelContextTool): ModelContextTool {
    const modelContext = getModelContext();

    upsertTool(modelContext, tool);
    addModelContextHelpers(modelContext);
    const nativeToolName = registerNativeModelContextTool(tool);

    document.dispatchEvent(
        new CustomEvent('webmcp:model-context-ready', {
            detail: {
                toolName: tool.name,
                nativeToolName,
                modelContext,
            },
        }),
    );

    return tool;
}

export function unregisterModelContextTool(toolName: string): boolean {
    const modelContext = getExistingModelContext();

    if (!modelContext) {
        return false;
    }

    const previousLength = modelContext.tools.length;

    modelContext.tools = modelContext.tools.filter((candidate) => {
        return candidate && candidate.name !== toolName;
    });
    const nativeToolRemoved = unregisterNativeModelContextTool(toolName);
    addModelContextHelpers(modelContext);

    if (modelContext.tools.length !== previousLength || nativeToolRemoved) {
        document.dispatchEvent(
            new CustomEvent('webmcp:model-context-ready', {
                detail: {
                    toolName,
                    modelContext,
                },
            }),
        );
    }

    return modelContext.tools.length !== previousLength || nativeToolRemoved;
}

function upsertTool(modelContext: ModelContext, tool: ModelContextTool): void {
    const existingIndex = modelContext.tools.findIndex((candidate) => {
        return candidate && candidate.name === tool.name;
    });

    if (existingIndex >= 0) {
        modelContext.tools[existingIndex] = tool;

        return;
    }

    modelContext.tools.push(tool);
}

export function addModelContextHelpers(modelContext: ModelContext): void {
    if (
        typeof modelContext.getTools === 'function' &&
        !(modelContext.getTools as UnknownRecord)[WRAPPED_HELPER_KEY] &&
        typeof modelContext[ORIGINAL_GET_TOOLS_KEY] !== 'function'
    ) {
        modelContext[ORIGINAL_GET_TOOLS_KEY] = modelContext.getTools.bind(modelContext);
    }

    if (
        typeof modelContext.callTool === 'function' &&
        !(modelContext.callTool as UnknownRecord)[WRAPPED_HELPER_KEY] &&
        typeof modelContext[ORIGINAL_CALL_TOOL_KEY] !== 'function'
    ) {
        modelContext[ORIGINAL_CALL_TOOL_KEY] = modelContext.callTool.bind(modelContext);
    }

    const getTools = () => getVisibleModelContextTools(modelContext);
    (getTools as UnknownRecord)[WRAPPED_HELPER_KEY] = true;
    modelContext.getTools = getTools;

    const callTool = async (name: string, input: ToolInput = {}) =>
        callVisibleModelContextTool(modelContext, name, input);
    (callTool as UnknownRecord)[WRAPPED_HELPER_KEY] = true;
    modelContext.callTool = callTool;
}

function getVisibleModelContextTools(modelContext: ModelContext): ModelContextTool[] {
    const visibleTools: ModelContextTool[] = [];

    appendOriginalModelContextTools(modelContext, visibleTools);

    modelContext.tools.forEach((tool) => {
        appendVisibleModelContextTool(visibleTools, tool, true);
    });

    return visibleTools;
}

function appendOriginalModelContextTools(modelContext: ModelContext, visibleTools: ModelContextTool[]): void {
    const originalGetTools = modelContext[ORIGINAL_GET_TOOLS_KEY];

    if (typeof originalGetTools !== 'function') {
        return;
    }

    let originalTools;

    try {
        originalTools = originalGetTools();
    } catch (error) {
        return;
    }

    if (!Array.isArray(originalTools)) {
        return;
    }

    originalTools.forEach((tool) => {
        appendVisibleModelContextTool(visibleTools, tool, false);
    });
}

function appendVisibleModelContextTool(
    visibleTools: ModelContextTool[],
    tool: unknown,
    includeSwagWebMcpTools: boolean,
): void {
    const candidate = tool as Partial<ModelContextTool> | null;

    if (!candidate || typeof candidate.name !== 'string') {
        return;
    }

    if (!includeSwagWebMcpTools && isSwagWebMcpToolName(candidate.name)) {
        return;
    }

    if (visibleTools.some((existingTool) => existingTool && existingTool.name === candidate.name)) {
        return;
    }

    visibleTools.push(candidate as ModelContextTool);
}

async function callVisibleModelContextTool(
    modelContext: ModelContext,
    name: string,
    input: ToolInput,
): Promise<unknown> {
    const tool = getVisibleModelContextTools(modelContext).find((candidate) => {
        return candidate && candidate.name === name;
    });

    if (isSwagWebMcpToolName(name)) {
        if (!tool || typeof tool.execute !== 'function') {
            throw new Error(`Unknown modelContext tool: ${name}`);
        }

        return tool.execute(input);
    }

    const originalCallTool = modelContext[ORIGINAL_CALL_TOOL_KEY];

    if (typeof originalCallTool === 'function') {
        return originalCallTool(name, input);
    }

    if (!tool || typeof tool.execute !== 'function') {
        throw new Error(`Unknown modelContext tool: ${name}`);
    }

    return tool.execute(input);
}

function registerNativeModelContextTool(tool: ModelContextTool): string | null {
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

function unregisterNativeModelContextTool(toolName: string): boolean {
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

function isSwagWebMcpToolName(name: unknown): boolean {
    return typeof name === 'string' && name.startsWith(SWAG_WEB_MCP_TOOL_NAME_PREFIX);
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
