#!/usr/bin/env bash
# Deploys ProcurementRegistryFactory to Base Sepolia and verifies it on BaseScan
# Sepolia in one command (wraps `forge script DeployProcurementRegistryFactory.s.sol --verify`).
#
# Usage:
#   ./scripts/DeployProcurementRegistryFactory.s.sh [extra forge script flags]
#
# Requires DEPLOYER_PRIVATE_KEY, BASE_SEPOLIA_RPC_URL, BASESCAN_API_KEY — either
# already exported, or set in contracts/.env (cp .env.example .env && fill in).
# DEPLOYER_PRIVATE_KEY only pays gas for this one deployment — the factory
# itself has no owner, and it never becomes the owner of any
# ProcurementRegistry created through it (see ProcurementRegistryFactory.sol).
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

missing=()
for var in DEPLOYER_PRIVATE_KEY BASE_SEPOLIA_RPC_URL BASESCAN_API_KEY; do
  if [ -z "${!var:-}" ]; then
    missing+=("$var")
  fi
done
if [ ${#missing[@]} -gt 0 ]; then
  echo "Missing required env var(s): ${missing[*]}" >&2
  echo "Set them in contracts/.env (see .env.example) or export them before running this script." >&2
  exit 1
fi

forge build

forge script scripts/DeployProcurementRegistryFactory.s.sol:DeployProcurementRegistryFactory \
  --rpc-url base_sepolia --broadcast --verify -vvvv "$@"
