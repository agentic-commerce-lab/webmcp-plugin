FROM oven/bun:1.3.14-alpine AS bun

FROM php:8.2-cli-alpine

RUN apk add --no-cache \
        libstdc++ \
        icu-dev \
        libpng-dev \
        libzip-dev \
        zip \
    && docker-php-ext-install \
        gd \
        intl \
        pdo_mysql \
        zip

COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun

WORKDIR /app

ENV COMPOSER_CACHE_DIR=/tmp/composer-cache
ENV COMPOSER_ROOT_VERSION=0.1.0

CMD ["composer", "qa"]
