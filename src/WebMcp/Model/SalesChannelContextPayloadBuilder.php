<?php

declare(strict_types=1);

namespace Swag\WebMcp\WebMcp\Model;

use Shopware\Core\Checkout\Customer\CustomerEntity;
use Shopware\Core\System\SalesChannel\SalesChannelContext;
use Symfony\Component\HttpFoundation\Request;

/**
 * Read-only projection of the active {@see SalesChannelContext} — the Shopware-specific
 * edge for agents (sales channel, language, currency, customer group, country, tax mode,
 * login state). Resolved server-side from the shopper's session, so it always reflects the
 * same context the user browses with.
 *
 * Unlike the cart projection (ADR 0004, moved to the frontend), this stays server-side on
 * purpose: it is a curated allowlist that keeps customer PII off the wire — it exposes only
 * whether a customer is logged in / a guest, never the customer entity. The verbose,
 * PII-heavy raw context never crosses to the browser.
 *
 * The `SalesChannelContext` getters used here are typed and stable across the plugin's
 * supported Shopware range (verified 6.6.0.0 → 6.7.x), so no defensive reflection is needed.
 */
final class SalesChannelContextPayloadBuilder
{
    /**
     * @return array<string, mixed>
     */
    public function build(SalesChannelContext $context, Request $request): array
    {
        $salesChannel = $context->getSalesChannel();
        $currency = $context->getCurrency();
        $customerGroup = $context->getCurrentCustomerGroup();
        $country = $context->getShippingLocation()->getCountry();
        $paymentMethod = $context->getPaymentMethod();
        $shippingMethod = $context->getShippingMethod();

        return $this->removeNullValues([
            'salesChannel' => $this->entityRef($salesChannel->getId(), $salesChannel->getName()),
            'languageId' => $this->stringValue($context->getLanguageId()),
            'currency' => $this->removeNullValues([
                'id' => $this->stringValue($currency->getId()),
                'isoCode' => $this->stringValue($currency->getIsoCode()),
                'symbol' => $this->stringValue($currency->getSymbol()),
            ]) ?: null,
            'customerGroup' => $this->entityRef($customerGroup->getId(), $customerGroup->getName()),
            'country' => $this->removeNullValues([
                'id' => $this->stringValue($country->getId()),
                'iso' => $this->stringValue($country->getIso()),
                'name' => $this->stringValue($country->getName()),
            ]) ?: null,
            'taxState' => $this->stringValue($context->getTaxState()),
            'paymentMethod' => $this->entityRef($paymentMethod->getId(), $paymentMethod->getName()),
            'shippingMethod' => $this->entityRef($shippingMethod->getId(), $shippingMethod->getName()),
            'customer' => $this->customer($context->getCustomer()),
            'baseUrl' => rtrim($request->getSchemeAndHttpHost(), '/'),
        ]);
    }

    /**
     * @return array<string, string>|null
     */
    private function entityRef(string $id, ?string $name): ?array
    {
        $ref = $this->removeNullValues([
            'id' => $this->stringValue($id),
            'name' => $this->stringValue($name),
        ]);

        return [] !== $ref ? $ref : null;
    }

    /**
     * @return array<string, bool>
     */
    private function customer(?CustomerEntity $customer): array
    {
        return $this->removeNullValues([
            'loggedIn' => null !== $customer,
            'guest' => null !== $customer ? $customer->getGuest() : null,
        ]);
    }

    private function stringValue(?string $value): ?string
    {
        if (null === $value) {
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
