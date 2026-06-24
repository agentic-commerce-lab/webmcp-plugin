<?php

declare(strict_types=1);

namespace Swag\WebMcp\WebMcp\Model;

final class WebMcpDocument
{
    /**
     * @param list<WebMcpElement> $elements
     * @param array<string, mixed> $security
     */
    public function __construct(
        private readonly string $version,
        private readonly string $context,
        private readonly array $elements,
        private readonly array $security = [],
    ) {
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $document = [
            'version' => $this->version,
            'context' => $this->context,
            'elements' => array_map(
                static fn (WebMcpElement $element): array => $element->toArray(),
                $this->elements,
            ),
        ];

        if ([] !== $this->security) {
            $document['security'] = $this->security;
        }

        return $document;
    }
}
