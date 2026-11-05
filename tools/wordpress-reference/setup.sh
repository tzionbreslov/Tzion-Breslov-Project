#!/usr/bin/env bash
# Rebuild the local WordPress reference of tzionbreslov.com from ../wp-extracted
# (the unpacked All-in-One WP Migration backup). Serves http://localhost:8088.
# BACKUP_DIR defaults to ../../../wp-extracted (outside the repo — it holds
# private data: donor entries, password hashes, API keys). Never commit it.
set -euo pipefail
cd "$(dirname "$0")"
BACKUP_DIR="${BACKUP_DIR:-../../../wp-extracted}"
mkdir -p .data
export MSYS_NO_PATHCONV=1   # Git Bash on Windows: don't rewrite container paths

# The dump has no SET NAMES; without it MySQL imports UTF-8 as latin1 (mojibake).
{ echo "SET NAMES utf8mb4;"; sed 's/SERVMASK_PREFIX_/wp_/g' "$BACKUP_DIR/database.sql"; } > .data/db.sql

docker compose down -v
docker compose up -d db wordpress
until docker compose exec -T db mysql -h127.0.0.1 -uwp -pwp wp -e "select 1 from wp_users limit 1" >/dev/null 2>&1; do sleep 3; done

# Copy (not bind-mount) wp-content: Docker Desktop bind mounts made every page take ~20s.
for d in themes plugins uploads; do docker compose cp "$BACKUP_DIR/$d" wordpress:/var/www/html/wp-content/; done
docker compose exec -T wordpress chown -R www-data:www-data /var/www/html/wp-content

W="docker compose run --rm -T cli"
$W search-replace 'https://tzionbreslov.com' 'http://localhost:8088' --all-tables --quiet --skip-plugins --skip-themes
$W search-replace 'https://www.tzionbreslov.com' 'http://localhost:8088' --all-tables --quiet --skip-plugins --skip-themes
# The live site's active plugins minus SiteGround's hosting-only ones.
$W plugin activate advanced-custom-fields-pro carousel-block feeds-for-youtube gravityforms gravityformsmailchimp gravityformsppcp ultimate-addons-for-gutenberg wordpress-seo
$W theme activate tzionbreslov
$W config set WP_HTTP_BLOCK_EXTERNAL true --raw
$W config set DISABLE_WP_CRON true --raw
# Legacy-widget blocks (footer Quick Links) are signed with the live salts.
$W eval-file /var/www/html/resign-legacy-widgets.php
$W rewrite structure '/%postname%/' --hard
echo "WordPress reference ready at http://localhost:8088"
