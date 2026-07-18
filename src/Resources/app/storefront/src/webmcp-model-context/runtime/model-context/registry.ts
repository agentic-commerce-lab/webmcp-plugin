import type { ModelContext, ModelContextTool, ToolInput, UnknownRecord } from '../types';
import { isPlainObject } from '../tools/storefront-tool.utils';
import { registerNativeModelContextTool, unregisterNativeModelContextTool } from './native-bridge';

const SWAG_WEB_MCP_TOOL_NAME_PREFIX = 'shopware_webmcp_';
const ORIGINAL_GET_TOOLS_KEY = '__swagWebMcpOriginalGetTools';
const ORIGINAL_CALL_TOOL_KEY = '__swagWebMcpOriginalCallTool';
const WRAPPED_HELPER_KEY = '__swagWebMcpWrapped';

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

function isSwagWebMcpToolName(name: unknown): boolean {
    return typeof name === 'string' && name.startsWith(SWAG_WEB_MCP_TOOL_NAME_PREFIX);
}
