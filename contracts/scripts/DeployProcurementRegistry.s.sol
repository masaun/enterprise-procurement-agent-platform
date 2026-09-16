// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {ProcurementRegistry} from "../src/ProcurementRegistry.sol";

/**
 * Deploys ProcurementRegistry to whichever network `--rpc-url` points at
 * (this repo targets Base Sepolia), and verifies the deployed contract on
 * BaseScan Sepolia (https://sepolia.basescan.org). The deployer becomes the
 * contract owner — i.e. the platform's own administrative signer
 * (`CONTRACT_OWNER_PRIVATE_KEY` in ./app), not any external agent's treasury
 * key.
 *
 * Usage (compiles, then deploys AND verifies in one step):
 *   forge build
 *   forge script scripts/DeployProcurementRegistry.s.sol:DeployProcurementRegistry \
 *     --rpc-url base_sepolia --broadcast --verify -vvvv
 *
 * (`forge script` recompiles any changed sources on its own, so the explicit
 * `forge build` above is optional — it just surfaces compile errors, with
 * their own artifacts, before a broadcast is attempted.)
 *
 * `--verify` triggers Foundry's built-in verifier, which picks up BaseScan
 * Sepolia's API endpoint + `BASESCAN_API_KEY` from the `[etherscan.base_sepolia]`
 * entry in ../foundry.toml (matched to `--rpc-url base_sepolia` via the
 * shared `base_sepolia` key). No separate verification call is needed.
 *
 * If verification doesn't land during the broadcast (e.g. BaseScan hasn't
 * indexed the deploy tx yet), re-run it standalone — `run()` below prints a
 * ready-to-use `forge verify-contract` command with the actual deployed
 * address and constructor args filled in.
 */
contract DeployProcurementRegistry is Script {
    function run() external returns (ProcurementRegistry registry) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        vm.startBroadcast(deployerKey);
        registry = new ProcurementRegistry(deployer);
        vm.stopBroadcast();

        console.log("ProcurementRegistry deployed at:", address(registry));
        console.log("Owner:", deployer);
        console.log("");
        console.log("If auto-verification (--verify) didn't complete, verify manually on BaseScan Sepolia:");
        console.log(
            string.concat(
                "  forge verify-contract ",
                vm.toString(address(registry)),
                " src/ProcurementRegistry.sol:ProcurementRegistry",
                " --chain 84532",
                " --etherscan-api-key $BASESCAN_API_KEY",
                " --verifier-url https://api-sepolia.basescan.org/api",
                ' --constructor-args $(cast abi-encode "constructor(address)" ',
                vm.toString(deployer),
                ")"
            )
        );
    }
}
