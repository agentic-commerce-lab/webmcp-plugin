#!/usr/bin/env sh
#
# Local dev shop helper for the WebMCP plugin.
#
# Spins up a full Shopware (Dockware) with this plugin mounted into it and
# gives you a few smooth commands for the day-to-day dev loop.
#
#   bin/shop.sh up        Start the shop (creates .env from .env.example first)
#   bin/shop.sh deploy    Transpile the TS runtime and (re)install the plugin
#   bin/shop.sh down      Stop and remove the shop container
#   bin/shop.sh logs      Follow the shop logs
#   bin/shop.sh shell     Open a shell inside the shop container
#   bin/shop.sh console …  Run a bin/console command in the shop
#   bin/shop.sh open      Print the shop / admin / adminer / mail URLs
#
# Ports and the Shopware version are configured in .env (see .env.example).
set -eu

PLUGIN_NAME="SwagWebMcp"
SERVICE="shop"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# --- .env handling -----------------------------------------------------------
ensure_env() {
    if [ ! -f .env ]; then
        echo "→ No .env found, creating one from .env.example"
        cp .env.example .env
    fi
}

load_env() {
    [ -f .env ] || return 0
    set -a
    # shellcheck disable=SC1091
    . ./.env
    set +a
}

# Defaults mirror .env.example so URLs are correct even without a .env.
SHOP_HTTP_PORT="${SHOP_HTTP_PORT:-8000}"
SHOP_MAIL_PORT="${SHOP_MAIL_PORT:-1080}"

compose() {
    docker compose --profile dev "$@"
}

# Run a command inside the shop container as the web user so cache/files keep
# the right ownership.
in_shop() {
    compose exec -T -u www-data "$SERVICE" bash -lc "cd /var/www/html && $*"
}

console() {
    in_shop "php bin/console $*"
}

# The Dockware demo seeds the storefront domain as "http://localhost". When we
# publish the shop on a different host port, the browser sends "localhost:PORT"
# which no longer matches, so Shopware answers 400. Realign the domain with the
# port we actually expose.
ensure_domain() {
    if [ "${SHOP_HTTP_PORT}" = "80" ]; then
        url="http://localhost"
    else
        url="http://localhost:${SHOP_HTTP_PORT}"
    fi
    echo "→ Aligning storefront domain with ${url}"
    compose exec -T "$SERVICE" mysql -h127.0.0.1 -uroot -proot shopware \
        -e "UPDATE sales_channel_domain SET url='${url}' WHERE url LIKE 'http://localhost%';" 2>/dev/null || true
}

wait_until_ready() {
    printf '→ Waiting for Shopware to boot'
    i=0
    while [ "$i" -lt 60 ]; do
        code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:${SHOP_HTTP_PORT}/admin" 2>/dev/null || true)"
        case "$code" in
            200 | 301 | 302)
                printf ' ready.\n'
                return 0
                ;;
        esac
        printf '.'
        i=$((i + 1))
        sleep 5
    done
    printf '\n'
    echo "! Shop did not become ready in time. Check: bin/shop.sh logs" >&2
    return 1
}

print_urls() {
    echo ""
    echo "  Storefront   http://localhost:${SHOP_HTTP_PORT}"
    echo "  Admin        http://localhost:${SHOP_HTTP_PORT}/admin          (admin / shopware)"
    echo "  Adminer      http://localhost:${SHOP_HTTP_PORT}/adminer.php    (root / root, db: shopware)"
    echo "  Mail         http://localhost:${SHOP_MAIL_PORT}"
    echo ""
}

cmd="${1:-help}"
[ "$#" -gt 0 ] && shift || true

case "$cmd" in
up)
    ensure_env
    load_env
    compose up -d "$SERVICE"
    wait_until_ready
    ensure_domain
    echo "→ Run 'bin/shop.sh deploy' to build the TS runtime and install the plugin."
    print_urls
    ;;

deploy)
    load_env
    echo "→ Transpiling TypeScript runtime (bun run build)"
    bun run build
    echo "→ Registering plugin in Shopware"
    console "plugin:refresh"
    # install --activate is a no-op error if already installed; keep it idempotent.
    in_shop "php bin/console plugin:install --activate ${PLUGIN_NAME} || php bin/console plugin:activate ${PLUGIN_NAME} || true"
    echo "→ Compiling storefront assets"
    console "theme:compile"
    console "assets:install"
    console "cache:clear"
    echo "✓ Plugin transpiled and installed."
    print_urls
    ;;

down)
    load_env
    compose down
    ;;

restart)
    load_env
    compose restart "$SERVICE"
    wait_until_ready
    ;;

logs)
    load_env
    compose logs -f "$SERVICE"
    ;;

shell)
    load_env
    compose exec -u www-data "$SERVICE" bash
    ;;

console)
    load_env
    console "$*"
    ;;

open | urls)
    load_env
    print_urls
    ;;

help | *)
    sed -n '3,20p' "$0" | sed 's/^# \{0,1\}//'
    ;;
esac
