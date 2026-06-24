<?php

declare(strict_types=1);

namespace Swag\WebMcp\WebMcp\Catalog;

use Swag\WebMcp\WebMcp\Config\WebMcpConfig;
use Swag\WebMcp\WebMcp\Model\WebMcpElement;

final class StaticConfigElementProvider implements ElementProviderInterface
{
    /**
     * @return list<WebMcpElement>
     */
    public function getElements(string $baseUrl, mixed $salesChannelContext, ?WebMcpConfig $config = null): array
    {
        if (null === $config || null === $config->staticElementsJson) {
            return [];
        }

        try {
            $decoded = json_decode($config->staticElementsJson, true, 512, \JSON_THROW_ON_ERROR);
        } catch (\Throwable) {
            return [];
        }

        if (!\is_array($decoded)) {
            return [];
        }

        $elements = \is_array($decoded['elements'] ?? null) ? $decoded['elements'] : $decoded;
        if (!array_is_list($elements)) {
            return [];
        }

        $definitions = [];
        foreach ($elements as $element) {
            if (!\is_array($element)) {
                continue;
            }

            $definition = $this->elementFromArray($element, rtrim($baseUrl, '/'));
            if (null !== $definition) {
                $definitions[] = $definition;
            }
        }

        return $definitions;
    }

    /**
     * @param array<string, mixed> $element
     */
    private function elementFromArray(array $element, string $baseUrl): ?WebMcpElement
    {
        $selector = $this->nonEmptyString($element['selector'] ?? null);
        $role = $this->nonEmptyString($element['role'] ?? null);
        $name = $this->nonEmptyString($element['name'] ?? null);

        if (null === $selector || null === $role || null === $name) {
            return null;
        }

        try {
            return new WebMcpElement(
                selector: $selector,
                role: $role,
                name: $name,
                action: $this->action($element['action'] ?? null, $baseUrl),
                description: $this->description($element['description'] ?? null),
                metadata: \is_array($element['metadata'] ?? null) ? $element['metadata'] : [],
            );
        } catch (\InvalidArgumentException) {
            return null;
        }
    }

    /**
     * @return array<string, mixed>|null
     */
    private function action(mixed $value, string $baseUrl): ?array
    {
        if (!\is_array($value)) {
            return null;
        }

        $kind = strtoupper($this->nonEmptyString($value['kind'] ?? null) ?? '');
        if (!\in_array($kind, ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], true)) {
            return null;
        }

        $endpoint = $this->endpoint($value['endpoint'] ?? null, $baseUrl);
        if (null === $endpoint) {
            return null;
        }

        $action = [
            'kind' => $kind,
            'endpoint' => $endpoint,
        ];

        if (\is_array($value['params'] ?? null)) {
            $action['params'] = $value['params'];
        }

        foreach (['csrf_tag', 'payload_jwe'] as $optionalKey) {
            $optionalValue = $this->nonEmptyString($value[$optionalKey] ?? null);
            if (null !== $optionalValue) {
                $action[$optionalKey] = $optionalValue;
            }
        }

        return $action;
    }

    private function endpoint(mixed $value, string $baseUrl): ?string
    {
        $endpoint = $this->nonEmptyString($value);
        if (null === $endpoint || preg_match('/[\x00-\x1F\x7F]/', $endpoint)) {
            return null;
        }

        if (str_starts_with($endpoint, '@')) {
            return $endpoint;
        }

        if (str_starts_with($endpoint, '/')) {
            return $baseUrl.$endpoint;
        }

        if (str_starts_with($endpoint, 'https://') || str_starts_with($endpoint, 'http://')) {
            return false !== filter_var($endpoint, \FILTER_VALIDATE_URL) ? $endpoint : null;
        }

        return null;
    }

    private function description(mixed $value): ?string
    {
        $description = $this->nonEmptyString($value);
        if (null === $description) {
            return null;
        }

        return substr($description, 0, 160);
    }

    private function nonEmptyString(mixed $value): ?string
    {
        if (!\is_string($value)) {
            return null;
        }

        $trimmed = trim($value);

        return '' !== $trimmed ? $trimmed : null;
    }
}
