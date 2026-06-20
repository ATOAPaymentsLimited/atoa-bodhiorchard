#!/bin/bash
# Copyright 2025-2026 Arun Rajkumar
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# deploy.sh — pull latest code and redeploy on the VPS.
# Usage: ./deploy.sh

set -e

ENV_FILE=".env.production"
ARCHIVED_LOGS_DIR="./archived_logs"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found."
  echo "  cp .env.production.example .env.production && nano .env.production"
  exit 1
fi

echo "==> Archiving existing container logs"
mkdir -p "$ARCHIVED_LOGS_DIR"

CONTAINERS=$(docker compose -f docker-compose.prod.yml ps -q 2>/dev/null || true)

if [ -n "$CONTAINERS" ]; then
  echo "  Found $(echo "$CONTAINERS" | wc -w) container(s) to archive"
  
  for container_id in $CONTAINERS; do
    container_name=$(docker inspect --format='{{.Name}}' "$container_id" 2>/dev/null | sed 's/\///' || echo "unknown")
    
    if [ "$container_name" != "unknown" ]; then
      log_path=$(docker inspect --format='{{.LogPath}}' "$container_id" 2>/dev/null)
      
      if [ -z "$log_path" ]; then
        continue
      fi
      
      log_dir=$(dirname "$log_path")
      archive_subdir="$ARCHIVED_LOGS_DIR/${container_name}_${TIMESTAMP}"
      
      echo "  Archiving logs from ${container_name}"
      
      mkdir -p "$archive_subdir"
      
      if sudo cp "$log_path" "$archive_subdir/" 2>/dev/null; then
        # Try to copy rotated logs too
        for rotated in "$log_dir"/*.log.[0-9]*; do
          if [ -f "$rotated" ] && sudo test -f "$rotated" 2>/dev/null; then
            sudo cp "$rotated" "$archive_subdir/" 2>/dev/null || true
          fi
        done
        
        sudo chown -R appuser:appuser "$archive_subdir"
        
        tar -czf "${archive_subdir}.tar.gz" -C "$ARCHIVED_LOGS_DIR" "$(basename $archive_subdir)" 2>/dev/null
        
        if [ -f "${archive_subdir}.tar.gz" ]; then
          compressed_size=$(du -h "${archive_subdir}.tar.gz" 2>/dev/null | cut -f1)
          echo "    Archived to $(basename ${archive_subdir}).tar.gz (${compressed_size})"
          rm -rf "$archive_subdir"
        fi
      fi
    fi
  done
else
  echo "  No running containers found"
fi

echo ""
echo "==> Pulling latest code"
git pull

echo ""
echo "==> Building images"
docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" build

echo ""
echo "==> Starting services"
docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" up -d

echo ""
echo "==> Done. Useful commands:"
echo "    Status : docker compose -f docker-compose.prod.yml ps"
echo "    Logs   : docker compose -f docker-compose.prod.yml logs -f"
echo "    Backend: docker compose -f docker-compose.prod.yml logs -f backend"
echo "    Archived logs: ls -lh $ARCHIVED_LOGS_DIR/"