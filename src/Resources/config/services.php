<?php

declare(strict_types=1);

use Swag\WebMcp\WebMcp\Api\WebMcpController;
use Symfony\Component\DependencyInjection\Loader\Configurator\ContainerConfigurator;

return static function (ContainerConfigurator $container): void {
    $services = $container->services();

    $services->defaults()
        ->autowire()
        ->autoconfigure()
        ->private();

    $services->load('Swag\\WebMcp\\', __DIR__.'/../../*')
        ->exclude([__DIR__.'/../../Resources']);

    $services->set(WebMcpController::class)
        ->tag('controller.service_arguments');
};
