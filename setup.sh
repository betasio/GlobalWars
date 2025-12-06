#!/bin/bash
# Comprehensive setup script for Hetzner server with Docker, user setup, Node Exporter, and OpenTelemetry
# Exit on error
set -e

echo "====================================================="
echo "🚀 STARTING SERVER SETUP"
echo "====================================================="

# Verify required environment variables
if [ -z "$OTEL_EXPORTER_OTLP_ENDPOINT" ] || [ -z "$OTEL_AUTH_HEADER" ]; then
    echo "❌ ERROR: Required environment variables are not set!"
    echo "Please set OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_AUTH_HEADER"
    exit 1
fi

echo "🔄 Updating system..."
apt update && apt upgrade -y

# Check if Docker is already installed
if command -v docker &> /dev/null; then
    echo "Docker is already installed"
else
    echo "🐳 Installing Docker..."
    # Install Docker using official script
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    systemctl enable --now docker
    echo "Docker installed successfully"
fi

echo "👤 Setting up globalwars user..."
# Create globalwars user if it doesn't exist
if id "globalwars" &> /dev/null; then
    echo "User globalwars already exists"
else
    useradd -m -s /bin/bash globalwars
    echo "User globalwars created"
fi

# Check if globalwars is already in docker group
if groups globalwars | grep -q '\bdocker\b'; then
    echo "User globalwars is already in the docker group"
else
    # Add globalwars to docker group
    usermod -aG docker globalwars
    echo "Added globalwars to docker group"
fi

# Create .ssh directory for globalwars if it doesn't exist
if [ ! -d "/home/globalwars/.ssh" ]; then
    mkdir -p /home/globalwars/.ssh
    chmod 700 /home/globalwars/.ssh
    echo "Created .ssh directory for globalwars"
fi

# Copy SSH keys from root if they exist and haven't been copied yet
if [ -f /root/.ssh/authorized_keys ] && [ ! -f /home/globalwars/.ssh/authorized_keys ]; then
    cp /root/.ssh/authorized_keys /home/globalwars/.ssh/
    chmod 600 /home/globalwars/.ssh/authorized_keys
    echo "SSH keys copied from root to globalwars"
fi

# Configure UDP buffer sizes for Cloudflare Tunnel
# https://github.com/quic-go/quic-go/wiki/UDP-Buffer-Sizes
echo "🔧 Configuring UDP buffer sizes..."
# Check if settings already exist in sysctl.conf
if grep -q "net.core.rmem_max" /etc/sysctl.conf && grep -q "net.core.wmem_max" /etc/sysctl.conf; then
    echo "UDP buffer size settings already configured"
else
    # Add UDP buffer size settings to sysctl.conf
    echo "# UDP buffer size settings for improved QUIC performance" >> /etc/sysctl.conf
    echo "net.core.rmem_max=7500000" >> /etc/sysctl.conf
    echo "net.core.wmem_max=7500000" >> /etc/sysctl.conf

    # Apply the settings immediately
    sysctl -p
    echo "UDP buffer sizes configured and applied"
fi

# Set proper ownership for globalwars's home directory
chown -R globalwars:globalwars /home/globalwars
echo "Set proper ownership for globalwars's home directory"

# Create directory for OpenTelemetry configuration
echo "📊 Setting up Node Exporter and OpenTelemetry Collector..."
OTEL_CONFIG_DIR="/home/globalwars/otel"

if [ ! -d "$OTEL_CONFIG_DIR" ]; then
    mkdir -p "$OTEL_CONFIG_DIR"
    echo "Created OpenTelemetry configuration directory"
fi

# Create OpenTelemetry Collector configuration
cat > "$OTEL_CONFIG_DIR/otel-collector-config.yaml" << EOF
receivers:
  prometheus:
    config:
      scrape_configs:
        - job_name: 'node'
          scrape_interval: 10s
          static_configs:
            - targets: ['localhost:9100']  # Node Exporter endpoint
          relabel_configs:
            - source_labels: [__address__]
              regex: '.*'
              target_label: globalwars.host
              replacement: "\${HOSTNAME}"

processors:
  batch:
    # Batch metrics before sending
    timeout: 10s
    send_batch_size: 1000

exporters:
  otlphttp:
    endpoint: "${OTEL_EXPORTER_OTLP_ENDPOINT}"
    headers:
      Authorization: "${OTEL_AUTH_HEADER}"
    tls:
      insecure: true  # Set to false in production with proper certs

service:
  pipelines:
    metrics:
      receivers: [prometheus]
      processors: [batch]
      exporters: [otlphttp]
EOF

# Set ownership of all files
chmod 600 "$OTEL_CONFIG_DIR/otel-collector-config.yaml"
chown -R globalwars:globalwars "$OTEL_CONFIG_DIR"

# Run Node Exporter
echo "🚀 Starting Node Exporter..."
docker pull prom/node-exporter:latest
docker rm -f node-exporter 2> /dev/null || true
docker run -d \
    --name=node-exporter \
    --restart=unless-stopped \
    --net="host" \
    --pid="host" \
    -v "/:/host:ro,rslave" \
    prom/node-exporter:latest \
    --path.rootfs=/host

# Run OpenTelemetry Collector
echo "🚀 Starting OpenTelemetry Collector..."
docker pull otel/opentelemetry-collector-contrib:latest
docker rm -f otel-collector 2> /dev/null || true
# Run OpenTelemetry Collector with appropriate permissions
echo "🚀 Starting OpenTelemetry Collector..."
docker pull otel/opentelemetry-collector-contrib:latest
docker rm -f otel-collector 2> /dev/null || true

docker run -d \
    --name=otel-collector \
    --restart=unless-stopped \
    --network=host \
    --user=0 \
    -v "$OTEL_CONFIG_DIR/otel-collector-config.yaml:/etc/otelcol-contrib/config.yaml:ro" \
    otel/opentelemetry-collector-contrib:latest

# Check if containers are running
if docker ps | grep -q node-exporter && docker ps | grep -q otel-collector; then
    echo "✅ Node Exporter and OpenTelemetry Collector started successfully!"
else
    echo "❌ Failed to start containers. Check logs with: docker logs node-exporter or docker logs otel-collector"
    exit 1
fi

echo "====================================================="
echo "🎉 SETUP COMPLETE!"
echo "====================================================="
echo "The globalwars user has been set up and has Docker permissions."
echo "UDP buffer sizes have been configured for optimal QUIC/WebSocket performance."
echo "Node Exporter is collecting system metrics."
echo "OpenTelemetry Collector is forwarding metrics to your endpoint."
echo ""
echo "📝 Configuration:"
echo "   - Config Directory: $OTEL_CONFIG_DIR"
echo "   - OpenTelemetry Endpoint: $OTEL_EXPORTER_OTLP_ENDPOINT"
echo "====================================================="
