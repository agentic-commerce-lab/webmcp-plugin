<?php

declare(strict_types=1);

use Shopware\Core\System\SystemConfig\SystemConfigService;
use Swag\WebMcp\WebMcp\Api\WebMcpController;
use Swag\WebMcp\WebMcp\Config\SystemConfigWebMcpConfigProvider;
use Swag\WebMcp\WebMcp\Config\WebMcpConfigProviderInterface;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;

use function Symfony\Component\DependencyInjection\Loader\Configurator\service;

return static function (ContainerConfigurator $container): void {
    $services = $container->services();

    $services->defaults()
        ->autowire()
        ->autoconfigure()
        ->private();

    $services->load('Swag\\WebMcp\\', __DIR__.'/../../*')
        ->exclude([__DIR__.'/../../Resources']);

    $services->alias(WebMcpConfigProviderInterface::class, SystemConfigWebMcpConfigProvider::class);

    $services->set(SystemConfigWebMcpConfigProvider::class)
        ->arg('$systemConfigService', service(SystemConfigService::class));

    $services->set(WebMcpController::class)
        ->tag('controller.service_arguments');
};
