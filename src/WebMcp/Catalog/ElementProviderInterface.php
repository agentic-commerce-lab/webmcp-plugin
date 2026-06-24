<?php

declare(strict_types=1);

namespace Swag\WebMcp\WebMcp\Catalog;

use Swag\WebMcp\WebMcp\Config\WebMcpConfig;
use Swag\WebMcp\WebMcp\Model\WebMcpElement;

interface ElementProviderInterface
{
    /**
     * @return list<WebMcpElement>
     */
    public function getElements(string $baseUrl, mixed $salesChannelContext, ?WebMcpConfig $config = null): array;
}
