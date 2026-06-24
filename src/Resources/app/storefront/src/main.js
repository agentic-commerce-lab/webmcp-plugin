import WebMcpModelContextPlugin from './webmcp-model-context/webmcp-model-context.plugin';

const PluginManager = window.PluginManager;

PluginManager.register('SwagWebMcpModelContext', WebMcpModelContextPlugin, '#swag-web-mcp-config');
