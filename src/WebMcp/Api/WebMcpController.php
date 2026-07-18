<?php

declare(strict_types=1);

namespace Swag\WebMcp\WebMcp\Api;

use Shopware\Core\Checkout\Cart\LineItem\LineItem;
use Shopware\Core\Checkout\Cart\LineItemFactoryRegistry;
use Shopware\Core\Checkout\Cart\SalesChannel\CartService;
use Shopware\Core\System\SalesChannel\SalesChannelContext;
use Swag\WebMcp\WebMcp\Config\WebMcpConfig;
use Swag\WebMcp\WebMcp\Config\WebMcpConfigProviderInterface;
use Swag\WebMcp\WebMcp\Model\CartPayloadBuilder;
use Swag\WebMcp\WebMcp\Model\SalesChannelContextPayloadBuilder;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class WebMcpController
{
    private const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
    private const MAX_QUANTITY = 100;

    public function __construct(
        private readonly WebMcpConfigProviderInterface $configProvider,
        private readonly CartService $cartService,
        private readonly CartPayloadBuilder $cartPayloadBuilder,
        private readonly LineItemFactoryRegistry $lineItemFactory,
        private readonly SalesChannelContextPayloadBuilder $salesChannelContextPayloadBuilder,
    ) {
    }

    #[Route(
        path: '/webmcp.wmcp',
        name: 'frontend.swag_web_mcp.document',
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
        name: 'frontend.swag_web_mcp.cart',
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
     * Read-only sales channel context (sales channel, language, currency, customer
     * group, country, tax mode, login state) resolved from the shopper's session.
     * Never cached.
     */
    #[Route(
        path: '/webmcp/sales-channel-context',
        name: 'frontend.swag_web_mcp.sales_channel_context',
        defaults: ['_routeScope' => ['storefront'], 'auth_required' => false, 'XmlHttpRequest' => true],
        methods: ['GET'],
    )]
    public function salesChannelContext(Request $request, ?SalesChannelContext $salesChannelContext = null): Response
    {
        $config = $this->configProvider->getConfig($salesChannelContext);
        if (!$config->enabled || !$config->getSalesChannelContextToolEnabled) {
            return $this->errorResponse('WebMCP sales channel context tool is disabled.', Response::HTTP_NOT_FOUND);
        }

        if (!$salesChannelContext instanceof SalesChannelContext) {
            return $this->errorResponse('Sales channel context is unavailable.', Response::HTTP_BAD_REQUEST);
        }

        $response = new JsonResponse($this->salesChannelContextPayloadBuilder->build($salesChannelContext, $request));
        $response->headers->set('cache-control', 'private, no-store');

        return $response;
    }

    /**
     * Adds `quantity` of a product to the shopper's cart (relative). Runs in the
     * shopper's own session — the storefront-scoped, same-origin request resolves
     * the identical SalesChannelContext the user browses with, so agent and user
     * share one cart. The response is never cached.
     */
    #[Route(
        path: '/webmcp/cart/line-item',
        name: 'frontend.swag_web_mcp.cart.add',
        defaults: ['_routeScope' => ['storefront'], 'auth_required' => false, 'XmlHttpRequest' => true],
        methods: ['POST'],
    )]
    public function addLineItem(Request $request, ?SalesChannelContext $salesChannelContext = null): Response
    {
        return $this->writeLineItem($request, $salesChannelContext, false);
    }

    /**
     * Sets a product line item to an exact target `quantity` (declarative, idempotent);
     * `0` removes it. Adds the product if it is not in the cart yet. Same session,
     * same cart, never cached (see {@see addLineItem()}).
     */
    #[Route(
        path: '/webmcp/cart/line-item',
        name: 'frontend.swag_web_mcp.cart.update',
        defaults: ['_routeScope' => ['storefront'], 'auth_required' => false, 'XmlHttpRequest' => true],
        methods: ['PATCH'],
    )]
    public function updateLineItem(Request $request, ?SalesChannelContext $salesChannelContext = null): Response
    {
        return $this->writeLineItem($request, $salesChannelContext, true);
    }

    private function writeLineItem(Request $request, ?SalesChannelContext $salesChannelContext, bool $setTarget): Response
    {
        $config = $this->configProvider->getConfig($salesChannelContext);
        $toolEnabled = $setTarget ? $config->updateLineItemToolEnabled : $config->addToCartToolEnabled;
        if (!$config->enabled || !$toolEnabled) {
            return $this->errorResponse('WebMCP cart write tool is disabled.', Response::HTTP_NOT_FOUND);
        }

        if (!$salesChannelContext instanceof SalesChannelContext) {
            return $this->errorResponse('Sales channel context is unavailable.', Response::HTTP_BAD_REQUEST);
        }

        $payload = $this->decodeJsonBody($request);
        $productId = \is_string($payload['productId'] ?? null) ? trim($payload['productId']) : '';
        if ('' === $productId) {
            return $this->errorResponse('A productId is required.', Response::HTTP_BAD_REQUEST);
        }

        // add: quantity is a relative amount (>= 1, default 1); update: target (>= 0, required).
        $quantity = $this->normalizeQuantity($payload['quantity'] ?? null, $setTarget ? 0 : 1, $setTarget ? null : 1);
        if (null === $quantity) {
            return $this->errorResponse('A valid quantity is required.', Response::HTTP_BAD_REQUEST);
        }

        $cart = $this->cartService->getCart($salesChannelContext->getToken(), $salesChannelContext);

        if (!$setTarget) {
            $cart = $this->cartService->add($cart, $this->productLineItem($productId, $quantity, $salesChannelContext), $salesChannelContext);
        } elseif ($quantity <= 0) {
            if ($cart->has($productId)) {
                $cart = $this->cartService->remove($cart, $productId, $salesChannelContext);
            }
        } elseif ($cart->has($productId)) {
            $cart = $this->cartService->changeQuantity($cart, $productId, $quantity, $salesChannelContext);
        } else {
            $cart = $this->cartService->add($cart, $this->productLineItem($productId, $quantity, $salesChannelContext), $salesChannelContext);
        }

        $response = new JsonResponse($this->cartPayloadBuilder->build($cart, $salesChannelContext, $request));
        $response->headers->set('cache-control', 'private, no-store');

        return $response;
    }

    private function productLineItem(string $productId, int $quantity, SalesChannelContext $context): LineItem
    {
        // Keying the line item id to the product id keeps it addressable by product
        // across add/update/remove and matches Shopware's default product line item id.
        return $this->lineItemFactory->create([
            'id' => $productId,
            'type' => LineItem::PRODUCT_LINE_ITEM_TYPE,
            'referencedId' => $productId,
            'quantity' => max(1, $quantity),
        ], $context);
    }

    private function errorResponse(string $message, int $status): JsonResponse
    {
        $response = new JsonResponse(['message' => $message], $status);
        $response->headers->set('cache-control', 'private, no-store');

        return $response;
    }

    /**
     * @return array<string, mixed>
     */
    private function decodeJsonBody(Request $request): array
    {
        try {
            $decoded = json_decode((string) $request->getContent(), true, 512, \JSON_THROW_ON_ERROR);
        } catch (\Throwable) {
            return [];
        }

        return \is_array($decoded) ? $decoded : [];
    }

    private function normalizeQuantity(mixed $value, int $min, ?int $default): ?int
    {
        if (null === $value) {
            return $default;
        }

        if (\is_int($value)) {
            $quantity = $value;
        } elseif (\is_float($value) && floor($value) === $value) {
            $quantity = (int) $value;
        } elseif (\is_string($value) && 1 === preg_match('/^-?\d+$/', trim($value))) {
            $quantity = (int) trim($value);
        } else {
            return null;
        }

        if ($quantity < $min || $quantity > self::MAX_QUANTITY) {
            return null;
        }

        return $quantity;
    }

    /**
     * @return array<string, mixed>
     */
    private function buildDocument(string $baseUrl, WebMcpConfig $config): array
    {
        $baseUrl = rtrim($baseUrl, '/');

        // The executable contract is the imperative tool registry exposed client-side
        // via document.modelContext (per the WebMCP standard). This server descriptor
        // stays thin: context plus any merchant-configured static affordances.
        return [
            'version' => '0.3',
            'context' => $config->context,
            'elements' => $this->staticElements($config->staticElementsJson, $baseUrl),
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
