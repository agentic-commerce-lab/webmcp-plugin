<?php

declare(strict_types=1);

namespace Swag\WebMcp\WebMcp\Config;

final class WebMcpConfig
{
    public function __construct(
        public readonly bool $enabled,
        public readonly string $context,
        public readonly bool $searchProductsToolEnabled = true,
        public readonly bool $getProductToolEnabled = true,
        public readonly bool $getProductCategoriesToolEnabled = true,
        public readonly bool $getCartToolEnabled = true,
        public readonly bool $addToCartToolEnabled = true,
        public readonly bool $updateLineItemToolEnabled = true,
        public readonly bool $removeFromCartToolEnabled = true,
        public readonly ?string $staticElementsJson = null,
    ) {
    }
}
