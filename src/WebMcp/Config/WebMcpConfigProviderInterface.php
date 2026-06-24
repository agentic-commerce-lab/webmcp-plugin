<?php

declare(strict_types=1);

namespace Swag\WebMcp\WebMcp\Config;

interface WebMcpConfigProviderInterface
{
    public function getConfig(mixed $salesChannelContext): WebMcpConfig;
}
