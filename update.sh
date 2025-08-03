echo "🔄 Updating Fantasy Football Command Center..."

APP_DIR="/mnt/user/appdata/fantasy-football-app"
echo APP_DIR
cd "$APP_DIR"

# Create backup before update
echo "💾 Creating backup..."
DATE=$(date +%Y%m%d_%H%M%S)
docker-compose exec fantasy-football-app tar -czf "/app/backups/pre-update-backup-$DATE.tar.gz" -C /usr/share/nginx/html .

# Pull latest changes and rebuild
echo "🔨 Rebuilding container..."
docker-compose down
docker-compose build --no-cache
docker-compose up -d

echo "✅ Update complete!"
