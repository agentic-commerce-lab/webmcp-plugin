import { bootstrapWebMcpModelContext } from '../../../../public/webmcp-model-context';
import type { UnknownRecord } from '../../../../public/webmcp-model-context/types';

const { PluginBaseClass } = window as {
    PluginBaseClass: new (...args: any[]) => {
        options: UnknownRecord;
    };
};

export default class WebMcpModelContextPlugin extends PluginBaseClass {
    declare options: UnknownRecord;

    init(): void {
        bootstrapWebMcpModelContext(this.options);
    }
}
