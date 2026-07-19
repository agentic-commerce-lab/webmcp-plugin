<?php

declare(strict_types=1);

namespace Swag\WebMcp\WebMcp\Config;

use Shopware\Core\System\SystemConfig\SystemConfigService;

final class SystemConfigWebMcpConfigProvider implements WebMcpConfigProviderInterface
{
    private const CONFIG_PREFIX = 'SwagWebMcp.config.';

    public function __construct(private readonly SystemConfigService $systemConfigService)
    {
    }

    public function getConfig(mixed $salesChannelContext): WebMcpConfig
    {
        $salesChannelId = $this->salesChannelId($salesChannelContext);

        return new WebMcpConfig(
            enabled: $this->boolConfig('enabled', $salesChannelId, true),
            searchProductsToolEnabled: $this->boolConfig('searchProductsToolEnabled', $salesChannelId, true),
            getProductToolEnabled: $this->boolConfig('getProductToolEnabled', $salesChannelId, true),
            getProductCategoriesToolEnabled: $this->boolConfig('getProductCategoriesToolEnabled', $salesChannelId, true),
            getCartToolEnabled: $this->boolConfig('getCartToolEnabled', $salesChannelId, true),
            addToCartToolEnabled: $this->boolConfig('addToCartToolEnabled', $salesChannelId, true),
            updateLineItemToolEnabled: $this->boolConfig('updateLineItemToolEnabled', $salesChannelId, true),
            getSalesChannelContextToolEnabled: $this->boolConfig('getSalesChannelContextToolEnabled', $salesChannelId, true),
        );
    }

    private function boolConfig(string $key, ?string $salesChannelId, bool $default): bool
    {
        $value = $this->read($key, $salesChannelId);

        if (\is_bool($value)) {
            return $value;
        }

        if (\is_string($value)) {
            return match (strtolower(trim($value))) {
                '1', 'true', 'yes', 'on' => true,
                '0', 'false', 'no', 'off' => false,
                default => $default,
            };
        }

        if (\is_int($value)) {
            return 1 === $value;
        }

        return $default;
    }

    private function read(string $key, ?string $salesChannelId): mixed
    {
        $fullKey = self::CONFIG_PREFIX.$key;

        $value = $this->systemConfigService->get($fullKey, $salesChannelId);
        if (null !== $value || null === $salesChannelId) {
            return $value;
        }

        return $this->systemConfigService->get($fullKey);
    }

    private function salesChannelId(mixed $salesChannelContext): ?string
    {
        if (!\is_object($salesChannelContext) || !method_exists($salesChannelContext, 'getSalesChannelId')) {
            return null;
        }

        try {
            $salesChannelId = $salesChannelContext->getSalesChannelId();
        } catch (\Throwable) {
            return null;
        }

        return \is_string($salesChannelId) && '' !== $salesChannelId ? $salesChannelId : null;
    }
}
