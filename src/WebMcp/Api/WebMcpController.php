<?php

declare(strict_types=1);

namespace Swag\WebMcp\WebMcp\Api;

use Shopware\Core\System\SalesChannel\SalesChannelContext;
use Swag\WebMcp\WebMcp\Catalog\WebMcpDocumentBuilder;
use Swag\WebMcp\WebMcp\Config\WebMcpConfigProviderInterface;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class WebMcpController
{
    public function __construct(
        private readonly WebMcpDocumentBuilder $documentBuilder,
        private readonly WebMcpConfigProviderInterface $configProvider,
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

        $document = $this->documentBuilder->build($request->getSchemeAndHttpHost(), $salesChannelContext, $config);
        $response = new Response(
            json_encode($document->toArray(), \JSON_THROW_ON_ERROR | \JSON_UNESCAPED_SLASHES),
            Response::HTTP_OK,
            ['content-type' => 'application/webmcp+json'],
        );
        $response->headers->set('cache-control', 'public, max-age=300');

        return $response;
    }
}
