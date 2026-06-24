<?php

declare(strict_types=1);

namespace Swag\WebMcp\WebMcp\Catalog;

use Swag\WebMcp\WebMcp\Config\WebMcpConfig;
use Swag\WebMcp\WebMcp\Model\WebMcpDocument;
use Swag\WebMcp\WebMcp\Model\WebMcpElement;

final class WebMcpDocumentBuilder
{
    /**
     * @param iterable<ElementProviderInterface> $elementProviders
     */
    public function __construct(private readonly iterable $elementProviders)
    {
    }

    public function build(string $baseUrl, mixed $salesChannelContext, WebMcpConfig $config): WebMcpDocument
    {
        $baseUrl = rtrim($baseUrl, '/');
        $elements = [];

        foreach ($this->elementProviders as $elementProvider) {
            foreach ($elementProvider->getElements($baseUrl, $salesChannelContext, $config) as $element) {
                if ($element instanceof WebMcpElement) {
                    $elements[] = $element;
                }
            }
        }

        return new WebMcpDocument(
            version: '0.2',
            context: $config->context,
            elements: $elements,
            security: [
                'endpoints' => [
                    '@ADD_TO_CART' => [
                        'tokenised' => true,
                        'expires' => 300,
                        'scopes' => ['cart:write'],
                    ],
                ],
                'csrf' => [
                    'token_field' => '_csrf_token',
                    'header_name' => 'X-CSRF-Token',
                    'mode' => 'synchroniser',
                ],
            ],
        );
    }
}
