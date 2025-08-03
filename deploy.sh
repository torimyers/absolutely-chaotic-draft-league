echo "🏈 Deploying Fantasy Football Command Center to Unraid..."

# Set variables
APP_DIR="/mnt/user/appdata/fantasy-football-app"
CONTAINER_NAME="absolutely-chaotic-draft-league"

# Create directories
echo "📁 Creating directories..."
mkdir -p "$APP_DIR/logs"
mkdir -p "$APP_DIR/backups"

# Stop existing container if running
echo "🛑 Stopping existing container..."
docker-compose down 2>/dev/null || true

# Build and start
echo "🔨 Building and starting container..."
cd "$APP_DIR"
docker-compose up -d --build

# Wait for container to be healthy
echo "⏳ Waiting for container to be healthy..."
timeout=60
counter=0
while [ $counter -lt $timeout ]; do
    if docker exec $CONTAINER_NAME curl -f http://localhost/health >/dev/null 2>&1; then
        echo "✅ Container is healthy!"
        break
    fi
    echo "Waiting... ($counter/$timeout)"
    sleep 2
    counter=$((counter + 2))
done

if [ $counter -ge $timeout ]; then
    echo "❌ Container failed to become healthy within $timeout seconds"
    docker-compose logs
    exit 1
fi

# Show status
echo "📊 Deployment Status:"
docker-compose ps
echo ""
echo "🌐 Access your app at: http://$(hostname -I | awk '{print $1}'):8080"
echo "🔍 Health check: http://$(hostname -I | awk '{print $1}'):8080/health"
echo "📜 Logs: docker-compose logs -f"
echo ""
echo "🎉 Fantasy Football Command Center is now running!"
