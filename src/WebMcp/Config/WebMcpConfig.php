<?php

declare(strict_types=1);

namespace Swag\WebMcp\WebMcp\Config;

final class WebMcpConfig
{
    public function __construct(
        public readonly bool $enabled,
        public readonly bool $searchProductsToolEnabled = true,
        public readonly bool $getProductToolEnabled = true,
        public readonly bool $getProductCategoriesToolEnabled = true,
        public readonly bool $getListingFiltersToolEnabled = true,
        public readonly bool $filterProductsToolEnabled = true,
        public readonly bool $getCartToolEnabled = true,
        public readonly bool $addToCartToolEnabled = true,
        public readonly bool $updateLineItemToolEnabled = true,
        public readonly bool $clearCartToolEnabled = true,
        public readonly bool $selectVariantToolEnabled = true,
        public readonly bool $getSalesChannelContextToolEnabled = true,
        public readonly bool $navigateToolEnabled = true,
    ) {
    }
}
