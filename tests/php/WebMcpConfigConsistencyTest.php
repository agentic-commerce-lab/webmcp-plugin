<?php

declare(strict_types=1);

namespace Swag\WebMcp\Tests;

use PHPUnit\Framework\TestCase;
use Swag\WebMcp\WebMcp\Config\WebMcpConfig;

/**
 * Guards against drift between the plugin's system configuration (config.xml)
 * and the typed {@see WebMcpConfig} object: every config flag must be exposed
 * as a WebMcpConfig property and vice versa, under the same name.
 */
final class WebMcpConfigConsistencyTest extends TestCase
{
    private const CONFIG_XML = __DIR__.'/../../src/Resources/config/config.xml';

    public function testConfigXmlAndWebMcpConfigExposeTheSameFlags(): void
    {
        self::assertSame(
            $this->configXmlFieldNames(),
            $this->webMcpConfigPropertyNames(),
            'config.xml fields and WebMcpConfig properties are out of sync. '
            .'Add or remove the flag in both src/Resources/config/config.xml and WebMcpConfig.',
        );
    }

    /**
     * @return list<string>
     */
    private function configXmlFieldNames(): array
    {
        $xml = simplexml_load_file(self::CONFIG_XML);
        self::assertNotFalse($xml, 'config.xml could not be parsed.');

        $names = [];
        foreach ($xml->card->{'input-field'} as $field) {
            $names[] = (string) $field->name;
        }

        sort($names);

        return $names;
    }

    /**
     * @return list<string>
     */
    private function webMcpConfigPropertyNames(): array
    {
        $constructor = (new \ReflectionClass(WebMcpConfig::class))->getConstructor();
        self::assertNotNull($constructor, 'WebMcpConfig has no constructor.');

        $names = [];
        foreach ($constructor->getParameters() as $parameter) {
            $names[] = $parameter->getName();
        }

        sort($names);

        return $names;
    }
}
