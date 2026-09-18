#!/usr/bin/env bash
# Runs the ProcurementRegistry Foundry test suite from anywhere.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
forge test --match-path "tests/ProcurementRegistryFactory.t.sol" -vvv
