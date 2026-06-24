<?php

declare(strict_types=1);

namespace Swag\WebMcp\WebMcp\Catalog;

use Swag\WebMcp\WebMcp\Config\WebMcpConfig;
use Swag\WebMcp\WebMcp\Model\WebMcpElement;

final class CoreShopwareElementProvider implements ElementProviderInterface
{
    /**
     * @return list<WebMcpElement>
     */
    public function getElements(string $baseUrl, mixed $salesChannelContext, ?WebMcpConfig $config = null): array
    {
        $baseUrl = rtrim($baseUrl, '/');

        return [
            new WebMcpElement(
                selector: 'form[action*="/search"] input[name="search"]',
                role: 'input.search',
                name: 'SEARCH_QUERY',
            ),
            new WebMcpElement(
                selector: 'form[action*="/search"] button[type="submit"]',
                role: 'button.submit',
                name: 'SUBMIT_SEARCH',
                action: [
                    'kind' => 'GET',
                    'endpoint' => $baseUrl.'/search',
                    'params' => [
                        'search' => '$SEARCH_QUERY',
                    ],
                ],
            ),
            new WebMcpElement(
                selector: 'a[href*="/checkout/cart"], .header-cart',
                role: 'link.cart',
                name: 'VIEW_CART',
                action: [
                    'kind' => 'GET',
                    'endpoint' => $baseUrl.'/checkout/cart',
                ],
            ),
            new WebMcpElement(
                selector: 'form[action*="/checkout/line-item/add"] button[type="submit"]',
                role: 'button.add_to_cart',
                name: 'ADD_TO_CART',
                action: [
                    'kind' => 'POST',
                    'endpoint' => '@ADD_TO_CART',
                    'csrf_tag' => '$CSRF_TOKEN',
                ],
            ),
        ];
    }
}
