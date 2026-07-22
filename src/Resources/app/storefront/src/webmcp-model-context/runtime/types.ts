export type UnknownRecord = Record<string, any>;

export type ToolInput = UnknownRecord;

export interface StorefrontToolOptions {
    baseUrl?: string | null;
    accessKey?: string | null;
    contextToken?: string | null;
    navigationCategoryId?: string | null;
    currencyIsoCode?: string | null;
    activeCategoryId?: string | null;
    activeSearchTerm?: string | null;
    currentProductId?: string | null;
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
    baseUrl: string | null;
    storeApiAccessKey: string | null;
    navigationCategoryId: string | null;
    currencyIsoCode: string | null;
    activeCategoryId: string | null;
    activeSearchTerm: string | null;
    currentProductId: string | null;
    tools: {
        searchProducts: boolean;
        getProduct: boolean;
        getProductCategories: boolean;
        getListingFilters: boolean;
        filterProducts: boolean;
        getCart: boolean;
        addToCart: boolean;
        updateLineItem: boolean;
        clearCart: boolean;
        selectVariant: boolean;
        getSalesChannelContext: boolean;
        navigate: boolean;
    };
}

export type WebMcpToolKey = keyof WebMcpRuntimeConfig['tools'];

export interface ProductLookupInput {
    id?: string | undefined;
    sku?: string | undefined;
    url?: string | undefined;
}

export interface QuantityInput extends ProductLookupInput {
    quantity: number;
    showCartOverlay?: boolean | undefined;
}

export interface CartQuantityInput extends ProductLookupInput {
    quantity: number;
    showCartOverlay?: boolean | undefined;
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
