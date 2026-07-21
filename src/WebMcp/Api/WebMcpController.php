<?php

declare(strict_types=1);

namespace Swag\WebMcp\WebMcp\Api;

use Shopware\Core\System\SalesChannel\SalesChannelContext;
use Swag\WebMcp\WebMcp\Config\WebMcpConfigProvider;
use Swag\WebMcp\WebMcp\Model\SalesChannelContextPayloadBuilder;
use Symfony\Component\HttpFoundation\JsonResponse;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class WebMcpController
{
    public function __construct(
        private readonly WebMcpConfigProvider $configProvider,
        private readonly SalesChannelContextPayloadBuilder $salesChannelContextPayloadBuilder,
    ) {
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

        return $this->uncachedJson($this->salesChannelContextPayloadBuilder->build($salesChannelContext, $request));
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function uncachedJson(array $payload, int $status = Response::HTTP_OK): JsonResponse
    {
        $response = new JsonResponse($payload, $status);
        $response->headers->set('cache-control', 'private, no-store');

        return $response;
    }

    private function errorResponse(string $message, int $status): JsonResponse
    {
        return $this->uncachedJson(['message' => $message], $status);
    }
}
