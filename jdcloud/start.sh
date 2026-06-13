#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NO_INSTALL=1 "${SCRIPT_DIR}/install-and-run.sh"
