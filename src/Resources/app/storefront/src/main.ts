const PluginManager = window.PluginManager as {
    register: (...args: any[]) => unknown;
};

PluginManager.register(
    'SwagWebMcpModelContext',
    () => import('./webmcp-model-context/webmcp-model-context.plugin'),
    '[data-swag-web-mcp-model-context]',
);
