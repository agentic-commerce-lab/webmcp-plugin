export type UnknownRecord = Record<string, any>;

export type ToolInput = UnknownRecord;

export interface StorefrontToolOptions {
    baseUrl?: string | null;
    accessKey?: string | null;
    contextToken?: string | null;
}

export interface ToolResult {
    content: Array<{
        type: string;
        text: string;
    }>;
    structuredContent: UnknownRecord;
}

export interface ModelContextTool {
    name: string;
    title?: string;
    description?: string;
    inputSchema?: UnknownRecord;
    annotations?: UnknownRecord;
    execute: (input?: ToolInput) => ToolResult | Promise<ToolResult>;
    handler?: (input?: ToolInput) => ToolResult | Promise<ToolResult>;
}

export interface ModelContext {
    [key: string]: unknown;
    tools: ModelContextTool[];
    getTools?: () => ModelContextTool[];
    callTool?: (name: string, input?: ToolInput) => unknown;
}

export interface NativeModelContextTool {
    name: string;
    title?: string;
    description?: string;
    inputSchema?: UnknownRecord;
    annotations?: UnknownRecord;
    execute?: (input?: unknown) => unknown;
    handler?: (input?: unknown) => unknown;
}

export interface NativeModelContext {
    registerTool: (...args: any[]) => unknown;
    unregisterTool?: (...args: any[]) => unknown;
}

export interface WebMcpRuntimeConfig {
    enabled: boolean;
    context: string;
    baseUrl: string | null;
    storeApiAccessKey: string | null;
    staticElements?: unknown;
    staticElementsJson: string | null;
    tools: {
        searchProducts: boolean;
        getProduct: boolean;
        getProductCategories: boolean;
        navigate: boolean;
        getCart: boolean;
        addToCart: boolean;
        updateLineItem: boolean;
        removeFromCart: boolean;
    };
}

export type WebMcpToolKey = keyof WebMcpRuntimeConfig['tools'];

export interface WebMcpDocument {
    version: string;
    context: string;
    elements: UnknownRecord[];
    security: UnknownRecord;
}

export interface ProductLookupInput {
    id?: string;
    sku?: string;
    url?: string;
}

export interface CartLineItemLookupInput extends ProductLookupInput {
    lineItemId?: string;
}

export interface QuantityInput extends ProductLookupInput {
    lineItemId?: string;
    quantity: number;
}

export interface CartQuantityInput extends CartLineItemLookupInput {
    quantity: number;
}

export interface ProductSummary {
    id?: string;
    sku?: string | null;
    productNumber?: string | null;
    name: string;
    price?: string | null;
    priceValue?: number | null;
    currency?: string | null;
    description?: string | null;
    manufacturer?: string | null;
    available?: boolean;
    stock?: number | null;
    url?: string | null;
}

export interface CartSummary {
    itemCount?: number;
    cartWidgetRefreshed?: boolean;
    lineItems?: UnknownRecord[];
    totalPrice?: UnknownRecord | null;
    totals?: {
        total?: UnknownRecord | null;
    };
    checkoutUrl?: string;
}
