#!/bin/sh

# Docker entrypoint script for Fantasy Football App
# Injects environment variables into the HTML file

set -e

echo "🏈 Starting Fantasy Football Command Center..."
echo "League: ${FANTASY_LEAGUE_NAME:-'My Fantasy League'}"
echo "Team: ${FANTASY_TEAM_NAME:-'My Team'}"

# Path to the HTML file
HTML_FILE="/usr/share/nginx/html/index.html"

# Function to update meta tag content
update_meta_tag() {
    local name="$1"
    local content="$2"
    local file="$3"
    
    if [ -n "$content" ]; then
        sed -i "s|<meta name=\"$name\" content=\"[^\"]*\">|<meta name=\"$name\" content=\"$content\">|g" "$file"
        echo "✅ Updated $name: $content"
    fi
}

# Create backup of original HTML file
if [ ! -f "$HTML_FILE.orig" ]; then
    cp "$HTML_FILE" "$HTML_FILE.orig"
    echo "📁 Created backup of original HTML file"
else
    # Restore from backup to ensure clean state
    cp "$HTML_FILE.orig" "$HTML_FILE"
fi

echo "🔧 Injecting environment variables into HTML..."

# Update meta tags with environment variables
update_meta_tag "FANTASY_LEAGUE_NAME" "$FANTASY_LEAGUE_NAME" "$HTML_FILE"
update_meta_tag "FANTASY_TEAM_NAME" "$FANTASY_TEAM_NAME" "$HTML_FILE"
update_meta_tag "FANTASY_LEAGUE_SIZE" "$FANTASY_LEAGUE_SIZE" "$HTML_FILE"
update_meta_tag "FANTASY_SCORING_FORMAT" "$FANTASY_SCORING_FORMAT" "$HTML_FILE"
update_meta_tag "FANTASY_TEAM_RECORD" "$FANTASY_TEAM_RECORD" "$HTML_FILE"
update_meta_tag "FANTASY_TOTAL_POINTS" "$FANTASY_TOTAL_POINTS" "$HTML_FILE"
update_meta_tag "FANTASY_LEAGUE_RANKING" "$FANTASY_LEAGUE_RANKING" "$HTML_FILE"
update_meta_tag "FANTASY_PLAYOFF_ODDS" "$FANTASY_PLAYOFF_ODDS" "$HTML_FILE"
update_meta_tag "SLEEPER_LEAGUE_ID" "$SLEEPER_LEAGUE_ID" "$HTML_FILE"
update_meta_tag "FANTASY_LEARNING_MODE" "$FANTASY_LEARNING_MODE" "$HTML_FILE"
update_meta_tag "FANTASY_THEME_COLOR" "$FANTASY_THEME_COLOR" "$HTML_FILE"

# Update page title if team name is provided
if [ -n "$FANTASY_TEAM_NAME" ]; then
    sed -i "s|<title[^>]*>.*</title>|<title>$FANTASY_TEAM_NAME - Fantasy Football Command Center</title>|g" "$HTML_FILE"
    echo "📝 Updated page title: $FANTASY_TEAM_NAME"
fi

# Set proper permissions
chown nginx:nginx "$HTML_FILE"
chmod 644 "$HTML_FILE"

echo "✨ Environment variable injection complete!"
echo "🚀 Starting nginx server on port 80..."
echo "📊 Access your fantasy dashboard at: http://localhost:8080"

# Execute the main command
exec "$@"