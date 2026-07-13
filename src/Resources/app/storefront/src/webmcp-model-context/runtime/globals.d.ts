import type {
    ModelContext,
    NativeModelContext,
    UnknownRecord,
    WebMcpDocument,
    WebMcpRuntimeConfig,
} from './types';

declare global {
    interface Document {
        modelContext?: ModelContext;
        webMcp?: UnknownRecord & {
            document?: WebMcpDocument | null;
            getDocument?: () => WebMcpDocument | null;
            getElements?: () => UnknownRecord[];
        };
    }

    interface Navigator {
        modelContext?: NativeModelContext;
        modelContextTesting?: NativeModelContext;
    }

    interface Window {
        [key: string]: any;
        PluginManager?: {
            register?: (...args: any[]) => unknown;
            getPluginInstances?: (pluginName: string) => { forEach: (callback: (instance: any) => void) => void };
            initializePluginsInParentElement?: (element: Element) => unknown;
            initializePlugins?: () => unknown;
        };
        PluginBaseClass?: new (...args: any[]) => {
            el?: Element;
            options?: UnknownRecord;
            init?: () => void;
        };
        SwagWebMcp?: UnknownRecord & {
            config?: WebMcpRuntimeConfig;
            document?: WebMcpDocument | null;
            loaded?: boolean;
        };
        SwagWebMcpRuntime?: UnknownRecord;
        Shopware?: UnknownRecord;
        storefrontSettings?: UnknownRecord;
        router?: Record<string, string>;
        csrf?: {
            token?: string;
        };
        swAccessKey?: string;
    }
}

export {};
