<?php

declare(strict_types=1);

namespace Swag\WebMcp\WebMcp\Config;

final class SystemConfigWebMcpConfigProvider implements WebMcpConfigProviderInterface
{
    private const CONFIG_PREFIX = 'SwagWebMcp.config.';

    public function __construct(private readonly object $systemConfigService)
    {
    }

    public function getConfig(mixed $salesChannelContext): WebMcpConfig
    {
        $salesChannelId = $this->salesChannelId($salesChannelContext);

        return new WebMcpConfig(
            enabled: $this->boolConfig('enabled', $salesChannelId, true),
            context: $this->stringConfig('context', $salesChannelId, 'Shopware storefront interaction graph'),
            searchProductsToolEnabled: $this->boolConfig('searchProductsToolEnabled', $salesChannelId, true),
            getProductToolEnabled: $this->boolConfig('getProductToolEnabled', $salesChannelId, true),
            staticElementsJson: $this->nullableStringConfig('staticElementsJson', $salesChannelId),
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

    private function stringConfig(string $key, ?string $salesChannelId, string $default): string
    {
        $value = $this->read($key, $salesChannelId);

        return \is_string($value) && '' !== trim($value) ? $value : $default;
    }

    private function nullableStringConfig(string $key, ?string $salesChannelId): ?string
    {
        $value = $this->read($key, $salesChannelId);

        return \is_string($value) && '' !== trim($value) ? $value : null;
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
