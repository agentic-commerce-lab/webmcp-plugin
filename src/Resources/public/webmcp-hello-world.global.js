(function () {
    'use strict';

    var toolName = 'shopware.webmcp.hello_world';

    function registerHelloWorldTool() {
        var modelContext = getModelContext();
        var tool = createTool();

        upsertTool(modelContext, tool);
        addHelpers(modelContext);

        document.dispatchEvent(new CustomEvent('webmcp:model-context-ready', {
            detail: {
                toolName: toolName,
                modelContext: modelContext
            }
        }));
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

    function createTool() {
        var execute = function (input) {
            var subject = input && typeof input.subject === 'string' && input.subject.trim() !== ''
                ? input.subject.trim()
                : 'world';

            return Promise.resolve({
                content: [
                    {
                        type: 'text',
                        text: 'Hello, ' + subject + ' from Shopware WebMCP.'
                    }
                ]
            });
        };

        return {
            name: toolName,
            title: 'Hello world',
            description: 'Returns a hello world response from the Shopware storefront.',
            inputSchema: {
                type: 'object',
                properties: {
                    subject: {
                        type: 'string',
                        description: 'Optional name or subject to greet.'
                    }
                },
                additionalProperties: false
            },
            execute: execute,
            handler: execute
        };
    }

    function upsertTool(modelContext, tool) {
        var existingIndex = modelContext.tools.findIndex(function (candidate) {
            return candidate && candidate.name === tool.name;
        });

        if (existingIndex >= 0) {
            modelContext.tools[existingIndex] = tool;

            return;
        }

        if (typeof modelContext.registerTool === 'function') {
            modelContext.registerTool(tool);
        }

        var registeredIndex = modelContext.tools.findIndex(function (candidate) {
            return candidate && candidate.name === tool.name;
        });

        if (registeredIndex < 0) {
            modelContext.tools.push(tool);
        }
    }

    function addHelpers(modelContext) {
        if (typeof modelContext.getTools !== 'function') {
            modelContext.getTools = function () {
                return modelContext.tools.slice();
            };
        }

        if (typeof modelContext.callTool !== 'function') {
            modelContext.callTool = function (name, input) {
                var tool = modelContext.tools.find(function (candidate) {
                    return candidate && candidate.name === name;
                });

                if (!tool || typeof tool.execute !== 'function') {
                    throw new Error('Unknown modelContext tool: ' + name);
                }

                return tool.execute(input || {});
            };
        }
    }

    window.SwagWebMcp = Object.assign({}, window.SwagWebMcp || {}, {
        registerHelloWorldTool: registerHelloWorldTool
    });

    registerHelloWorldTool();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', registerHelloWorldTool, { once: true });
    } else {
        window.setTimeout(registerHelloWorldTool, 0);
    }

    window.addEventListener('load', registerHelloWorldTool, { once: true });
    document.addEventListener('webmcp:model-context-request', registerHelloWorldTool);
}());
