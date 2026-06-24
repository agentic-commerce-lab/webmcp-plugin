import { bootstrapWebMcpModelContext } from '../../../../public/webmcp-model-context';

const { PluginBaseClass } = window;

export default class WebMcpModelContextPlugin extends PluginBaseClass {
    init() {
        bootstrapWebMcpModelContext(this.options);
    }
}
