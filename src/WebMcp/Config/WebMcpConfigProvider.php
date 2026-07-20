<?php

declare(strict_types=1);

namespace Swag\WebMcp\WebMcp\Config;

use Shopware\Core\System\SalesChannel\SalesChannelContext;
use Shopware\Core\System\SystemConfig\SystemConfigService;

final class WebMcpConfigProvider
{
    private const CONFIG_PREFIX = 'SwagWebMcp.config.';

    public function __construct(private readonly SystemConfigService $systemConfigService)
    {
    }

    public function getConfig(?SalesChannelContext $salesChannelContext): WebMcpConfig
    {
        $salesChannelId = $salesChannelContext?->getSalesChannelId();

        return new WebMcpConfig(
            enabled: $this->boolConfig('enabled', $salesChannelId),
            searchProductsToolEnabled: $this->boolConfig('searchProductsToolEnabled', $salesChannelId),
            getProductToolEnabled: $this->boolConfig('getProductToolEnabled', $salesChannelId),
            getProductCategoriesToolEnabled: $this->boolConfig('getProductCategoriesToolEnabled', $salesChannelId),
            getCartToolEnabled: $this->boolConfig('getCartToolEnabled', $salesChannelId),
            addToCartToolEnabled: $this->boolConfig('addToCartToolEnabled', $salesChannelId),
            updateLineItemToolEnabled: $this->boolConfig('updateLineItemToolEnabled', $salesChannelId),
            getSalesChannelContextToolEnabled: $this->boolConfig('getSalesChannelContextToolEnabled', $salesChannelId),
            navigateToolEnabled: $this->boolConfig('navigateToolEnabled', $salesChannelId),
        );
    }

    /**
     * Reads a bool flag. SystemConfigService already resolves sales-channel
     * inheritance; the flags are declared as `type="bool"` in config.xml, so a
     * missing value only occurs before the plugin defaults are persisted — we
     * fail open in that case to match the defaultValue of `true`.
     */
    private function boolConfig(string $key, ?string $salesChannelId): bool
    {
        $value = $this->systemConfigService->get(self::CONFIG_PREFIX.$key, $salesChannelId);

        return null === $value ? true : (bool) $value;
    }
}
