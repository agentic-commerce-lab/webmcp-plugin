import { bootstrapWebMcpModelContext } from './runtime';
import type { UnknownRecord } from './runtime/types';

const { PluginBaseClass } = window as {
    PluginBaseClass: new (...args: any[]) => {
        el: Element;
        options: UnknownRecord;
    };
};

export default class WebMcpModelContextPlugin extends PluginBaseClass {
    declare el: Element;
    declare options: UnknownRecord;

    init(): void {
        bootstrapWebMcpModelContext(this.el);
    }
}
