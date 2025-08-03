#!/bin/bash

# Fantasy Football App - Simple Restart Script for Unraid
# One command to rule them all!

set -e

echo "🏈 Fantasy Football App - Simple Restart"
echo "========================================"

# Configuration
APP_DIR="/mnt/user/appdata/fantasy-football-app"
CONTAINER_NAME="absolutely-chaotic-draft-league"
IMAGE_NAME="fantasy-football-app"

# Colors for better output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to print colored messages
log() {
    echo -e "${BLUE}$1${NC}"
}

success() {
    echo -e "${GREEN}$1${NC}"
}

warning() {
    echo -e "${YELLOW}$1${NC}"
}

error() {
    echo -e "${RED}$1${NC}"
}

# Navigate to app directory
log "📁 Navigating to app directory..."
cd "$APP_DIR" || {
    error "❌ Cannot find app directory: $APP_DIR"
    exit 1
}

# Stop and remove existing container
log "🛑 Stopping existing container..."
if docker ps -q -f name="$CONTAINER_NAME" | grep -q .; then
    docker stop "$CONTAINER_NAME"
    success "✅ Container stopped"
else
    warning "⚠️  Container was not running"
fi

log "🗑️  Removing old container..."
if docker ps -aq -f name="$CONTAINER_NAME" | grep -q .; then
    docker rm "$CONTAINER_NAME"
    success "✅ Container removed"
else
    warning "⚠️  No container to remove"
fi

# Build new image
log "🔨 Building new image..."
if docker build -t "$IMAGE_NAME" .; then
    success "✅ Image built successfully"
else
    error "❌ Failed to build image"
    exit 1
fi

# Run new container
log "🚀 Starting new container..."
if docker run -d \
    --name "$CONTAINER_NAME" \
    -p 8080:80 \
    -v "$APP_DIR/config:/app/config" \
    -v "$APP_DIR/logs:/var/log/nginx" \
    -e FANTASY_LEAGUE_NAME="Absolutely Chaotic Draft League" \
    -e FANTASY_TEAM_NAME="Show Me Your TDs" \
    -e FANTASY_LEAGUE_SIZE=12 \
    -e FANTASY_SCORING_FORMAT="Half PPR" \
    -e FANTASY_TEAM_RECORD="8-5" \
    -e FANTASY_TOTAL_POINTS=1847 \
    -e FANTASY_LEAGUE_RANKING=3 \
    -e FANTASY_PLAYOFF_ODDS=87 \
    -e SLEEPER_LEAGUE_ID="1251955408977788928" \
    -e FANTASY_LEARNING_MODE="beginner" \
    -e FANTASY_THEME_COLOR="teal" \
    --restart unless-stopped \
    "$IMAGE_NAME"; then
    success "✅ Container started successfully"
else
    error "❌ Failed to start container"
    exit 1
fi

# Wait a moment for container to start
log "⏳ Waiting for container to be ready..."
sleep 3

# Check if container is running
if docker ps -q -f name="$CONTAINER_NAME" | grep -q .; then
    success "✅ Container is running!"
    
    # Get server IP
    SERVER_IP=$(hostname -I | awk '{print $1}' 2>/dev/null || echo "your-server-ip")
    
    echo ""
    success "🎉 Fantasy Football App is ready!"
    echo ""
    log "🌐 Access your app at:"
    echo "   • http://$SERVER_IP:8080"
    echo "   • http://tower:8080 (if your server is named tower)"
    echo "   • http://localhost:8080 (from server)"
    echo ""
    log "📊 Container status:"
    docker ps --filter name="$CONTAINER_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
    echo ""
    log "💡 Useful commands:"
    echo "   • View logs: docker logs $CONTAINER_NAME"
    echo "   • Stop app: docker stop $CONTAINER_NAME"
    echo "   • Restart again: ./simple-restart.sh"
    
else
    error "❌ Container failed to start properly"
    log "📜 Container logs:"
    docker logs "$CONTAINER_NAME" 2>/dev/null || echo "No logs available"
    exit 1
fi

# Optional: Show recent logs
echo ""
read -p "🔍 Would you like to see the latest logs? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    log "📜 Latest application logs:"
    docker logs --tail=10 "$CONTAINER_NAME"
fi

echo ""
success "🏈 All done! Your Fantasy Football Command Center is ready to go!"