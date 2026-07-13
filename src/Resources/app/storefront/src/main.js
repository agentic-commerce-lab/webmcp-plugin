import './webmcp-model-context/runtime';

const pluginManager = window.PluginManager;

if (typeof pluginManager?.register === 'function') {
    pluginManager.register(
        'SwagWebMcpModelContext',
        () => import('./webmcp-model-context/webmcp-model-context.plugin'),
        '[data-swag-web-mcp-model-context]',
    );
}
