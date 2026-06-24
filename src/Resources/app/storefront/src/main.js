const PluginManager = window.PluginManager;

PluginManager.register(
    'SwagWebMcpModelContext',
    () => import('./webmcp-model-context/webmcp-model-context.plugin'),
    '[data-swag-web-mcp-model-context]',
);
