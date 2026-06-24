const HELLO_WORLD_TOOL_NAME = 'shopware.webmcp.hello_world';
const CONFIG_ELEMENT_ID = 'swag-web-mcp-config';

export function registerConfiguredToolsFromDocument(configElement = document.getElementById(CONFIG_ELEMENT_ID)) {
    const config = readConfig(configElement);

    window.SwagWebMcp = {
        ...(window.SwagWebMcp || {}),
        config,
        loaded: true,
        registerConfiguredTools: () => registerConfiguredTools(config),
        registerHelloWorldTool: () => registerHelloWorldTool(),
    };

    if (config.enabled) {
        registerConfiguredTools(config);
    }

    return config;
}

export function registerConfiguredTools(config = readConfig()) {
    if (config.tools.helloWorld) {
        registerHelloWorldTool();
    }
}

export function registerHelloWorldTool() {
    const modelContext = getModelContext();
    const tool = createHelloWorldTool();

    upsertTool(modelContext, tool);
    addHelpers(modelContext);

    document.dispatchEvent(new CustomEvent('webmcp:model-context-ready', {
        detail: {
            toolName: HELLO_WORLD_TOOL_NAME,
            modelContext,
        },
    }));
}

function readConfig(configElement = document.getElementById(CONFIG_ELEMENT_ID)) {
    const defaults = {
        enabled: true,
        tools: {
            helloWorld: true,
        },
    };

    if (!configElement) {
        return defaults;
    }

    try {
        const parsed = JSON.parse(configElement.textContent || '{}');

        return {
            enabled: parsed.enabled !== false,
            tools: {
                helloWorld: !parsed.tools || parsed.tools.helloWorld !== false,
            },
        };
    } catch (error) {
        return defaults;
    }
}

function getModelContext() {
    if (!document.modelContext || typeof document.modelContext !== 'object') {
        document.modelContext = {};
    }

    if (!Array.isArray(document.modelContext.tools)) {
        document.modelContext.tools = [];
    }

    return document.modelContext;
}

function createHelloWorldTool() {
    const execute = async (input = {}) => {
        const subject = typeof input.subject === 'string' && input.subject.trim() !== ''
            ? input.subject.trim()
            : 'world';

        return {
            content: [
                {
                    type: 'text',
                    text: `Hello, ${subject} from Shopware WebMCP.`,
                },
            ],
        };
    };

    return {
        name: HELLO_WORLD_TOOL_NAME,
        title: 'Hello world',
        description: 'Returns a hello world response from the Shopware storefront.',
        inputSchema: {
            type: 'object',
            properties: {
                subject: {
                    type: 'string',
                    description: 'Optional name or subject to greet.',
                },
            },
            additionalProperties: false,
        },
        execute,
        handler: execute,
    };
}

function upsertTool(modelContext, tool) {
    const existingIndex = modelContext.tools.findIndex((candidate) => {
        return candidate && candidate.name === tool.name;
    });

    if (existingIndex >= 0) {
        modelContext.tools[existingIndex] = tool;

        return;
    }

    if (typeof modelContext.registerTool === 'function') {
        modelContext.registerTool(tool);
    }

    const registeredIndex = modelContext.tools.findIndex((candidate) => {
        return candidate && candidate.name === tool.name;
    });

    if (registeredIndex < 0) {
        modelContext.tools.push(tool);
    }
}

function addHelpers(modelContext) {
    if (typeof modelContext.getTools !== 'function') {
        modelContext.getTools = () => modelContext.tools.slice();
    }

    if (typeof modelContext.callTool !== 'function') {
        modelContext.callTool = async (name, input = {}) => {
            const tool = modelContext.tools.find((candidate) => candidate && candidate.name === name);
            if (!tool || typeof tool.execute !== 'function') {
                throw new Error(`Unknown modelContext tool: ${name}`);
            }

            return tool.execute(input);
        };
    }
}

registerConfiguredToolsFromDocument();

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => registerConfiguredToolsFromDocument(), { once: true });
} else {
    window.setTimeout(() => registerConfiguredToolsFromDocument(), 0);
}

window.addEventListener('load', () => registerConfiguredToolsFromDocument(), { once: true });
document.addEventListener('webmcp:model-context-request', () => registerConfiguredToolsFromDocument());
