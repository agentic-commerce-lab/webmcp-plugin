<?php

declare(strict_types=1);

namespace Swag\WebMcp\WebMcp\Model;

use Shopware\Core\System\SalesChannel\SalesChannelContext;
use Symfony\Component\HttpFoundation\Request;

/**
 * Read-only projection of the active {@see SalesChannelContext} — the Shopware-specific
 * edge for agents (sales channel, language, currency, customer group, country, tax mode,
 * login state). Resolved server-side from the shopper's session, so it always reflects
 * the same context the user browses with. Defensive throughout to tolerate Shopware
 * version differences.
 */
final class SalesChannelContextPayloadBuilder
{
    /**
     * @return array<string, mixed>
     */
    public function build(SalesChannelContext $context, Request $request): array
    {
        return $this->removeNullValues([
            'salesChannel' => $this->salesChannel($context),
            'languageId' => $this->stringValue($context->getLanguageId()),
            'currency' => $this->currency($context),
            'customerGroup' => $this->entityRef($this->call($context, 'getCurrentCustomerGroup')),
            'country' => $this->country($context),
            'taxState' => $this->stringValue($this->call($context, 'getTaxState')),
            'paymentMethod' => $this->entityRef($this->call($context, 'getPaymentMethod')),
            'shippingMethod' => $this->entityRef($this->call($context, 'getShippingMethod')),
            'customer' => $this->customer($context),
            'baseUrl' => rtrim($request->getSchemeAndHttpHost(), '/'),
        ]);
    }

    /**
     * @return array<string, mixed>|null
     */
    private function salesChannel(SalesChannelContext $context): ?array
    {
        $salesChannel = $this->call($context, 'getSalesChannel');
        if (null === $salesChannel) {
            return $this->removeNullValues(['id' => $this->stringValue($this->call($context, 'getSalesChannelId'))]) ?: null;
        }

        return $this->removeNullValues([
            'id' => $this->stringValue($this->call($salesChannel, 'getId')),
            'name' => $this->stringValue($this->call($salesChannel, 'getName')),
        ]) ?: null;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function currency(SalesChannelContext $context): ?array
    {
        $currency = $this->call($context, 'getCurrency');
        if (null === $currency) {
            return null;
        }

        return $this->removeNullValues([
            'id' => $this->stringValue($this->call($currency, 'getId')),
            'isoCode' => $this->stringValue($this->call($currency, 'getIsoCode')),
            'symbol' => $this->stringValue($this->call($currency, 'getSymbol')),
        ]) ?: null;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function country(SalesChannelContext $context): ?array
    {
        $shippingLocation = $this->call($context, 'getShippingLocation');
        $country = null === $shippingLocation ? null : $this->call($shippingLocation, 'getCountry');
        if (null === $country) {
            return null;
        }

        return $this->removeNullValues([
            'id' => $this->stringValue($this->call($country, 'getId')),
            'iso' => $this->stringValue($this->call($country, 'getIso')),
            'name' => $this->stringValue($this->call($country, 'getName')),
        ]) ?: null;
    }

    /**
     * @return array<string, mixed>
     */
    private function customer(SalesChannelContext $context): array
    {
        $customer = $this->call($context, 'getCustomer');

        return $this->removeNullValues([
            'loggedIn' => null !== $customer,
            'guest' => null !== $customer ? (bool) $this->call($customer, 'getGuest') : null,
        ]);
    }

    /**
     * @return array<string, mixed>|null
     */
    private function entityRef(mixed $entity): ?array
    {
        if (!\is_object($entity)) {
            return null;
        }

        return $this->removeNullValues([
            'id' => $this->stringValue($this->call($entity, 'getId')),
            'name' => $this->stringValue($this->call($entity, 'getName')),
        ]) ?: null;
    }

    private function call(object $target, string $method): mixed
    {
        return method_exists($target, $method) ? $target->{$method}() : null;
    }

    private function stringValue(mixed $value): ?string
    {
        if (!\is_string($value)) {
            return null;
        }

        $trimmed = trim($value);

        return '' !== $trimmed ? $trimmed : null;
    }

    /**
     * @param array<string, mixed> $value
     *
     * @return array<string, mixed>
     */
    private function removeNullValues(array $value): array
    {
        return array_filter($value, static fn (mixed $item): bool => null !== $item);
    }
}
