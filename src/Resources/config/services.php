<?php

declare(strict_types=1);

use Shopware\Core\System\SystemConfig\SystemConfigService;
use Swag\WebMcp\WebMcp\Api\WebMcpController;
use Swag\WebMcp\WebMcp\Catalog\CoreShopwareElementProvider;
use Swag\WebMcp\WebMcp\Catalog\StaticConfigElementProvider;
use Swag\WebMcp\WebMcp\Catalog\WebMcpDocumentBuilder;
use Swag\WebMcp\WebMcp\Config\SystemConfigWebMcpConfigProvider;
use Swag\WebMcp\WebMcp\Config\WebMcpConfigProviderInterface;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;

use function Symfony\Component\DependencyInjection\Loader\Configurator\service;
use function Symfony\Component\DependencyInjection\Loader\Configurator\tagged_iterator;

return static function (ContainerConfigurator $container): void {
    $services = $container->services();

    $services->defaults()
        ->autowire()
        ->autoconfigure()
        ->private();

    $services->load('Swag\\WebMcp\\', __DIR__.'/../../*')
        ->exclude([__DIR__.'/../../Resources']);

    $services->set(CoreShopwareElementProvider::class)
        ->tag('swag_web_mcp.element_provider');

    $services->set(StaticConfigElementProvider::class)
        ->tag('swag_web_mcp.element_provider');

    $services->alias(WebMcpConfigProviderInterface::class, SystemConfigWebMcpConfigProvider::class);

    $services->set(SystemConfigWebMcpConfigProvider::class)
        ->arg('$systemConfigService', service(SystemConfigService::class));

    $services->set(WebMcpDocumentBuilder::class)
        ->arg('$elementProviders', tagged_iterator('swag_web_mcp.element_provider'));

    $services->set(WebMcpController::class)
        ->tag('controller.service_arguments');
};
