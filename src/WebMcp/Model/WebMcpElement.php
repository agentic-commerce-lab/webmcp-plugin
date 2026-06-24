<?php

declare(strict_types=1);

namespace Swag\WebMcp\WebMcp\Model;

final class WebMcpElement
{
    /**
     * @param array<string, mixed>|null $action
     * @param array<string, mixed> $metadata
     */
    public function __construct(
        private readonly string $selector,
        private readonly string $role,
        private readonly string $name,
        private readonly ?array $action = null,
        private readonly ?string $description = null,
        private readonly array $metadata = [],
    ) {
        foreach (['selector' => $this->selector, 'role' => $this->role, 'name' => $this->name] as $field => $value) {
            if ('' === trim($value) || preg_match('/[\x00-\x1F\x7F]/', $value)) {
                throw new \InvalidArgumentException(sprintf('WebMCP element %s must be a non-empty safe string.', $field));
            }
        }

        if (null !== $this->description && strlen($this->description) > 160) {
            throw new \InvalidArgumentException('WebMCP element descriptions must be 160 characters or fewer.');
        }
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(): array
    {
        $element = [
            'selector' => $this->selector,
            'role' => $this->role,
            'name' => $this->name,
        ];

        if (null !== $this->description) {
            $element['description'] = $this->description;
        }

        if (null !== $this->action) {
            $element['action'] = $this->action;
        }

        if ([] !== $this->metadata) {
            $element['metadata'] = $this->metadata;
        }

        return $element;
    }
}
