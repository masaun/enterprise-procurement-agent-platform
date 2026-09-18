// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {ProcurementRegistryFactory} from "../src/ProcurementRegistryFactory.sol";

/**
 * Deploys ProcurementRegistryFactory to whichever network `--rpc-url` points
 * at (this repo targets Base Sepolia), and verifies the deployed contract on
 * BaseScan Sepolia (https://sepolia.basescan.org). The factory itself has no
 * owner — it's a permissionless deployer of `ProcurementRegistry` instances,
 * each owned by whoever calls `createNewProcurementRegistry()` (see that
 * contract's doc comment) — so `DEPLOYER_PRIVATE_KEY` here only pays gas for
 * this one deployment and has no ongoing administrative role afterwards.
 *
 * Usage (compiles, then deploys AND verifies in one step):
 *   forge build
 *   forge script scripts/DeployProcurementRegistryFactory.s.sol:DeployProcurementRegistryFactory \
 *     --rpc-url base_sepolia --broadcast --verify -vvvv
 *
 * If verification doesn't land during the broadcast (e.g. BaseScan hasn't
 * indexed the deploy tx yet), re-run it standalone — `run()` below prints a
 * ready-to-use `forge verify-contract` command with the actual deployed
 * address filled in.
 */
contract DeployProcurementRegistryFactory is Script {
    function run() external returns (ProcurementRegistryFactory factory) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        vm.startBroadcast(deployerKey);
        factory = new ProcurementRegistryFactory();
        vm.stopBroadcast();

        console.log("ProcurementRegistryFactory deployed at:", address(factory));
        console.log("");
        console.log("If auto-verification (--verify) didn't complete, verify manually on BaseScan Sepolia:");
        console.log(
            string.concat(
                "  forge verify-contract ",
                vm.toString(address(factory)),
                " src/ProcurementRegistryFactory.sol:ProcurementRegistryFactory",
                " --chain 84532",
                " --etherscan-api-key $BASESCAN_API_KEY",
                " --verifier-url https://api-sepolia.basescan.org/api"
            )
        );
    }
}
