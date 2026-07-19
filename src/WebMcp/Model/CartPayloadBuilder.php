<?php

declare(strict_types=1);

namespace Swag\WebMcp\WebMcp\Model;

use Shopware\Core\Checkout\Cart\Cart;
use Shopware\Core\Checkout\Cart\LineItem\LineItem;
use Shopware\Core\Checkout\Cart\Price\Struct\CalculatedPrice;
use Shopware\Core\Checkout\Cart\Price\Struct\CartPrice;
use Shopware\Core\System\SalesChannel\SalesChannelContext;
use Symfony\Component\HttpFoundation\Request;

final class CartPayloadBuilder
{
    /**
     * @return array<string, mixed>
     */
    public function build(Cart $cart, SalesChannelContext $context, Request $request): array
    {
        $baseUrl = rtrim($request->getSchemeAndHttpHost(), '/');
        $currency = $this->currencyCode($context);
        $lineItems = [];

        foreach ($cart->getLineItems() as $lineItem) {
            $lineItems[] = $this->normalizeLineItem($lineItem, $currency, $baseUrl);
        }

        return $this->removeNullValues([
            'name' => method_exists($cart, 'getName') ? $this->stringValue($cart->getName()) : null,
            'currency' => $currency,
            'cartUrl' => $baseUrl.'/checkout/cart',
            'checkoutUrl' => $baseUrl.'/checkout/confirm',
            'lineItemCount' => \count($lineItems),
            'itemCount' => $this->cartItemCount($lineItems),
            'lineItems' => $lineItems,
            'discounts' => $this->discountLineItems($lineItems),
            'taxes' => $this->normalizeCalculatedTaxes($cart->getPrice()->getCalculatedTaxes(), $currency),
            'totals' => $this->normalizeCartTotals($cart, $currency),
        ]);
    }

    /**
     * @return array<string, mixed>
     */
    private function normalizeLineItem(LineItem $lineItem, ?string $currency, string $baseUrl, int $level = 0): array
    {
        $payload = $lineItem->getPayload();
        $price = $lineItem->getPrice();
        $referencedId = $this->stringValue($lineItem->getReferencedId());
        $type = $this->stringValue($lineItem->getType());
        $children = [];

        if ($level < 2) {
            foreach ($lineItem->getChildren() as $childLineItem) {
                $children[] = $this->normalizeLineItem($childLineItem, $currency, $baseUrl, $level + 1);
            }
        }

        return $this->removeNullValues([
            'id' => $this->stringValue($lineItem->getId()),
            'referencedId' => $referencedId,
            'type' => $type,
            'label' => $this->stringValue($lineItem->getLabel()),
            'quantity' => $lineItem->getQuantity(),
            'good' => $lineItem->isGood(),
            'productNumber' => $this->payloadString($payload, 'productNumber'),
            'url' => LineItem::PRODUCT_LINE_ITEM_TYPE === $type && null !== $referencedId ? $baseUrl.'/detail/'.$referencedId : null,
            'unitPrice' => $price instanceof CalculatedPrice ? $this->money($price->getUnitPrice(), $currency) : null,
            'totalPrice' => $price instanceof CalculatedPrice ? $this->money($price->getTotalPrice(), $currency) : null,
            'taxes' => $price instanceof CalculatedPrice ? $this->normalizeCalculatedTaxes($price->getCalculatedTaxes(), $currency) : [],
            'taxRules' => $price instanceof CalculatedPrice ? $this->normalizeTaxRules($price->getTaxRules()) : [],
            'payload' => $this->normalizeLineItemPayload($payload),
            'children' => $children,
        ]);
    }

    /**
     * @param list<array<string, mixed>> $lineItems
     */
    private function cartItemCount(array $lineItems): int
    {
        $productCount = 0;
        $totalCount = 0;

        foreach ($lineItems as $lineItem) {
            $quantity = \is_int($lineItem['quantity'] ?? null) ? $lineItem['quantity'] : 0;
            $totalCount += $quantity;

            if (LineItem::PRODUCT_LINE_ITEM_TYPE === ($lineItem['type'] ?? null)) {
                $productCount += $quantity;
            }
        }

        return $productCount > 0 ? $productCount : $totalCount;
    }

    /**
     * @param list<array<string, mixed>> $lineItems
     *
     * @return list<array<string, mixed>>
     */
    private function discountLineItems(array $lineItems): array
    {
        return array_values(array_filter($lineItems, static function (array $lineItem): bool {
            $type = $lineItem['type'] ?? null;
            $totalPrice = $lineItem['totalPrice']['value'] ?? null;

            return 'discount' === $type
                || 'promotion' === $type
                || (\is_float($totalPrice) && $totalPrice < 0);
        }));
    }

    /**
     * @return array<string, mixed>
     */
    private function normalizeCartTotals(Cart $cart, ?string $currency): array
    {
        $price = $cart->getPrice();
        $taxTotal = $this->taxTotal($price);
        $discountTotal = $this->discountTotal($cart);
        $shippingTotal = $this->shippingTotal($cart);

        return $this->removeNullValues([
            'subtotal' => $this->money($price->getPositionPrice(), $currency),
            'positionPrice' => $this->money($price->getPositionPrice(), $currency),
            'netTotal' => $this->money($price->getNetPrice(), $currency),
            'total' => $this->money($price->getTotalPrice(), $currency),
            'rawTotal' => $this->money($price->getRawTotal(), $currency),
            'taxTotal' => null !== $taxTotal ? $this->money($taxTotal, $currency) : null,
            'discountTotal' => null !== $discountTotal ? $this->money($discountTotal, $currency) : null,
            'shippingTotal' => null !== $shippingTotal ? $this->money($shippingTotal, $currency) : null,
            'taxStatus' => $this->stringValue($price->getTaxStatus()),
        ]);
    }

    private function taxTotal(CartPrice $price): ?float
    {
        $total = 0.0;
        $found = false;

        foreach ($price->getCalculatedTaxes() as $tax) {
            $total += $tax->getTax();
            $found = true;
        }

        return $found ? $total : null;
    }

    private function discountTotal(Cart $cart): ?float
    {
        $total = 0.0;
        $found = false;

        foreach ($cart->getLineItems() as $lineItem) {
            if (!$lineItem->getPrice() instanceof CalculatedPrice) {
                continue;
            }

            $price = $lineItem->getPrice()->getTotalPrice();
            if ($price >= 0) {
                continue;
            }

            $total += $price;
            $found = true;
        }

        return $found ? $total : null;
    }

    private function shippingTotal(Cart $cart): ?float
    {
        $total = 0.0;
        $found = false;

        foreach ($cart->getDeliveries() as $delivery) {
            $total += $delivery->getShippingCosts()->getTotalPrice();
            $found = true;
        }

        return $found ? $total : null;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function normalizeCalculatedTaxes(mixed $taxes, ?string $currency): array
    {
        if (!is_iterable($taxes)) {
            return [];
        }

        $normalizedTaxes = [];
        foreach ($taxes as $tax) {
            if (!\is_object($tax)) {
                continue;
            }

            $normalizedTaxes[] = $this->removeNullValues([
                'tax' => method_exists($tax, 'getTax') ? $this->money($tax->getTax(), $currency) : null,
                'taxRate' => method_exists($tax, 'getTaxRate') ? $this->numberValue($tax->getTaxRate()) : null,
                'price' => method_exists($tax, 'getPrice') ? $this->money($tax->getPrice(), $currency) : null,
            ]);
        }

        return $normalizedTaxes;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function normalizeTaxRules(mixed $taxRules): array
    {
        if (!is_iterable($taxRules)) {
            return [];
        }

        $normalizedTaxRules = [];
        foreach ($taxRules as $taxRule) {
            if (!\is_object($taxRule)) {
                continue;
            }

            $normalizedTaxRules[] = $this->removeNullValues([
                'taxRate' => method_exists($taxRule, 'getTaxRate') ? $this->numberValue($taxRule->getTaxRate()) : null,
                'percentage' => method_exists($taxRule, 'getPercentage') ? $this->numberValue($taxRule->getPercentage()) : null,
            ]);
        }

        return $normalizedTaxRules;
    }

    /**
     * @param array<string, mixed> $payload
     *
     * @return array<string, mixed>
     */
    private function normalizeLineItemPayload(array $payload): array
    {
        return $this->removeNullValues([
            'productNumber' => $this->payloadString($payload, 'productNumber'),
            'parentId' => $this->payloadString($payload, 'parentId'),
            'optionIds' => $this->payloadStringList($payload, 'optionIds'),
            'options' => $this->normalizePayloadOptions($payload['options'] ?? null),
        ]);
    }

    /**
     * @return list<array<string, string>>
     */
    private function normalizePayloadOptions(mixed $options): array
    {
        if (!\is_array($options)) {
            return [];
        }

        $normalizedOptions = [];
        foreach ($options as $option) {
            if (!\is_array($option)) {
                continue;
            }

            $normalizedOption = $this->removeNullValues([
                'group' => $this->stringValue($option['group'] ?? null),
                'option' => $this->stringValue($option['option'] ?? null),
            ]);

            if ([] !== $normalizedOption) {
                $normalizedOptions[] = $normalizedOption;
            }
        }

        return $normalizedOptions;
    }

    /**
     * @param array<string, mixed> $payload
     *
     * @return list<string>
     */
    private function payloadStringList(array $payload, string $key): array
    {
        $value = $payload[$key] ?? null;
        if (!\is_array($value)) {
            return [];
        }

        return array_values(array_filter(array_map(fn (mixed $item): ?string => $this->stringValue($item), $value)));
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function payloadString(array $payload, string $key): ?string
    {
        return $this->stringValue($payload[$key] ?? null);
    }

    /**
     * @return array{value: float, currency?: string}|null
     */
    private function money(mixed $value, ?string $currency): ?array
    {
        $number = $this->numberValue($value);
        if (null === $number) {
            return null;
        }

        $money = ['value' => $number];
        if (null !== $currency && '' !== $currency) {
            $money['currency'] = $currency;
        }

        return $money;
    }

    private function currencyCode(SalesChannelContext $context): ?string
    {
        return $this->stringValue($context->getCurrency()->getIsoCode());
    }

    private function numberValue(mixed $value): ?float
    {
        if (!\is_int($value) && !\is_float($value)) {
            return null;
        }

        return (float) $value;
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
        return array_filter($value, static fn (mixed $item): bool => null !== $item && '' !== $item);
    }
}
