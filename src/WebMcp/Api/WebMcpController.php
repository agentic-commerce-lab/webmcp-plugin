<?php

declare(strict_types=1);

namespace Swag\WebMcp\WebMcp\Api;

use Shopware\Core\Checkout\Cart\SalesChannel\CartService;
use Shopware\Core\System\SalesChannel\SalesChannelContext;
use Swag\WebMcp\WebMcp\Config\WebMcpConfig;
use Swag\WebMcp\WebMcp\Config\WebMcpConfigProviderInterface;
use Swag\WebMcp\WebMcp\Model\CartPayloadBuilder;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class WebMcpController
{
    private const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

    public function __construct(
        private readonly WebMcpConfigProviderInterface $configProvider,
        private readonly CartService $cartService,
        private readonly CartPayloadBuilder $cartPayloadBuilder,
    ) {
    }

    #[Route(
        path: '/webmcp.wmcp',
        name: 'swag_web_mcp.document',
        defaults: ['_routeScope' => ['storefront'], 'auth_required' => false],
        methods: ['GET'],
    )]
    public function document(Request $request, ?SalesChannelContext $salesChannelContext = null): Response
    {
        $config = $this->configProvider->getConfig($salesChannelContext);
        if (!$config->enabled) {
            return new Response('', Response::HTTP_NOT_FOUND);
        }

        $document = $this->buildDocument($request->getSchemeAndHttpHost(), $config);
        $response = new Response(
            json_encode($document, \JSON_THROW_ON_ERROR | \JSON_UNESCAPED_SLASHES),
            Response::HTTP_OK,
            ['content-type' => 'application/webmcp+json'],
        );
        $response->headers->set('cache-control', 'public, max-age=300');

        return $response;
    }

    #[Route(
        path: '/webmcp/cart',
        name: 'swag_web_mcp.cart',
        defaults: ['_routeScope' => ['storefront'], 'auth_required' => false, 'XmlHttpRequest' => true],
        methods: ['GET'],
    )]
    public function cart(Request $request, ?SalesChannelContext $salesChannelContext = null): Response
    {
        $config = $this->configProvider->getConfig($salesChannelContext);
        if (!$config->enabled || !$config->getCartToolEnabled) {
            return new JsonResponse(['message' => 'WebMCP cart tool is disabled.'], Response::HTTP_NOT_FOUND);
        }

        if (!$salesChannelContext instanceof SalesChannelContext) {
            return new JsonResponse(['message' => 'Sales channel context is unavailable.'], Response::HTTP_BAD_REQUEST);
        }

        $cart = $this->cartService->getCart($salesChannelContext->getToken(), $salesChannelContext);
        $response = new JsonResponse($this->cartPayloadBuilder->build($cart, $salesChannelContext, $request));
        $response->headers->set('cache-control', 'private, no-store');

        return $response;
    }

    /**
     * @return array<string, mixed>
     */
    private function buildDocument(string $baseUrl, WebMcpConfig $config): array
    {
        $baseUrl = rtrim($baseUrl, '/');

        return [
            'version' => '0.2',
            'context' => $config->context,
            'elements' => [
                ...$this->coreShopwareElements($baseUrl),
                ...$this->staticElements($config->staticElementsJson, $baseUrl),
            ],
            'security' => $this->securityDefinition(),
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function coreShopwareElements(string $baseUrl): array
    {
        return [
            [
                'selector' => 'form[action*="/search"] input[name="search"]',
                'role' => 'input.search',
                'name' => 'SEARCH_QUERY',
            ],
            [
                'selector' => 'form[action*="/search"] button[type="submit"]',
                'role' => 'button.submit',
                'name' => 'SUBMIT_SEARCH',
                'action' => [
                    'kind' => 'GET',
                    'endpoint' => $baseUrl.'/search',
                    'params' => [
                        'search' => '$SEARCH_QUERY',
                    ],
                ],
            ],
            [
                'selector' => 'a[href*="/checkout/cart"], .header-cart',
                'role' => 'link.cart',
                'name' => 'VIEW_CART',
                'action' => [
                    'kind' => 'GET',
                    'endpoint' => $baseUrl.'/checkout/cart',
                ],
            ],
            [
                'selector' => 'form[action*="/checkout/line-item/add"] button[type="submit"]',
                'role' => 'button.add_to_cart',
                'name' => 'ADD_TO_CART',
                'action' => [
                    'kind' => 'POST',
                    'endpoint' => '@ADD_TO_CART',
                    'csrf_tag' => '$CSRF_TOKEN',
                ],
            ],
        ];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function staticElements(?string $staticElementsJson, string $baseUrl): array
    {
        if (null === $staticElementsJson) {
            return [];
        }

        try {
            $decoded = json_decode($staticElementsJson, true, 512, \JSON_THROW_ON_ERROR);
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

        $normalizedElements = [];
        foreach ($elements as $element) {
            if (!\is_array($element)) {
                continue;
            }

            $normalizedElement = $this->normalizeElement($element, $baseUrl);
            if (null !== $normalizedElement) {
                $normalizedElements[] = $normalizedElement;
            }
        }

        return $normalizedElements;
    }

    /**
     * @param array<string, mixed> $element
     *
     * @return array<string, mixed>|null
     */
    private function normalizeElement(array $element, string $baseUrl): ?array
    {
        $selector = $this->safeString($element['selector'] ?? null);
        $role = $this->safeString($element['role'] ?? null);
        $name = $this->safeString($element['name'] ?? null);

        if (null === $selector || null === $role || null === $name) {
            return null;
        }

        $normalizedElement = [
            'selector' => $selector,
            'role' => $role,
            'name' => $name,
        ];

        $description = $this->safeString($element['description'] ?? null);
        if (null !== $description) {
            $normalizedElement['description'] = substr($description, 0, 160);
        }

        $action = $this->normalizeAction($element['action'] ?? null, $baseUrl);
        if (null !== $action) {
            $normalizedElement['action'] = $action;
        }

        if (\is_array($element['metadata'] ?? null)) {
            $normalizedElement['metadata'] = $element['metadata'];
        }

        return $normalizedElement;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function normalizeAction(mixed $value, string $baseUrl): ?array
    {
        if (!\is_array($value)) {
            return null;
        }

        $kind = strtoupper($this->safeString($value['kind'] ?? null) ?? '');
        $endpoint = $this->normalizeEndpoint($value['endpoint'] ?? null, $baseUrl);

        if (!\in_array($kind, self::HTTP_METHODS, true) || null === $endpoint) {
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
            $optionalValue = $this->safeString($value[$optionalKey] ?? null);
            if (null !== $optionalValue) {
                $action[$optionalKey] = $optionalValue;
            }
        }

        return $action;
    }

    private function normalizeEndpoint(mixed $value, string $baseUrl): ?string
    {
        $endpoint = $this->safeString($value);
        if (null === $endpoint) {
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

    /**
     * @return array<string, mixed>
     */
    private function securityDefinition(): array
    {
        return [
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
        ];
    }

    private function safeString(mixed $value): ?string
    {
        if (!\is_string($value)) {
            return null;
        }

        $trimmed = trim($value);

        if ('' === $trimmed || 1 === preg_match('/[\x00-\x1F\x7F]/', $trimmed)) {
            return null;
        }

        return $trimmed;
    }
}
