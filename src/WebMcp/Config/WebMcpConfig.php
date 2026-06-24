<?php

declare(strict_types=1);

namespace Swag\WebMcp\WebMcp\Config;

final class WebMcpConfig
{
    public function __construct(
        public readonly bool $enabled,
        public readonly string $context,
        public readonly ?string $staticElementsJson = null,
    ) {
    }
}
