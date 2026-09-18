// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ProcurementRegistry} from "./ProcurementRegistry.sol";

/**
 * Deploys new `ProcurementRegistry` instances on demand. The registry's
 * `Ownable` owner is set to `msg.sender` at creation time — i.e. whichever
 * wallet signs `createNewProcurementRegistry()`, typically an enterprise
 * admin's own connected wallet (see app/lib/chain/factoryBrowser.ts), not a
 * platform-held key. That caller can then call
 * `addAuthorizedAgent()`/`revokeAuthorizedAgent()` directly on the registry
 * it just created, without depending on this app's own
 * `CONTRACT_OWNER_PRIVATE_KEY`.
 *
 * Permissionless: anyone can create a registry, but each wallet may own at
 * most one — a wallet that already has one gets `RegistryAlreadyExists` on a
 * second `createNewProcurementRegistry()` call instead of accumulating more.
 * Each registry is fully independent — its own `authorizedAgents` allowlist
 * and receipt history.
 */
contract ProcurementRegistryFactory {
    /// @dev Every registry ever created by this factory, in creation order.
    address[] public deployedRegistries;

    /// @dev Creator (the address that called createNewProcurementRegistry,
    /// i.e. the registry's initial owner) -> registries it created. At most
    /// one entry per creator — see `createNewProcurementRegistry`.
    mapping(address => address[]) public registriesByCreator;

    event ProcurementRegistryCreated(address indexed registry, address indexed owner, uint256 index);

    error RegistryAlreadyExists(address creator, address existing);

    /**
     * Deploys a new `ProcurementRegistry` owned by `msg.sender` and returns
     * its address. Reverts if `msg.sender` already owns one.
     */
    function createNewProcurementRegistry() external returns (address registry) {
        address[] storage existing = registriesByCreator[msg.sender];
        if (existing.length != 0) revert RegistryAlreadyExists(msg.sender, existing[0]);

        ProcurementRegistry newRegistry = new ProcurementRegistry(msg.sender);
        registry = address(newRegistry);

        deployedRegistries.push(registry);
        existing.push(registry);

        emit ProcurementRegistryCreated(registry, msg.sender, deployedRegistries.length - 1);
    }

    function getDeployedRegistriesCount() external view returns (uint256) {
        return deployedRegistries.length;
    }

    function getRegistriesByCreator(address creator) external view returns (address[] memory) {
        return registriesByCreator[creator];
    }

    /// @dev Convenience singular accessor: the one registry `creator` owns,
    /// or `address(0)` if it hasn't created one yet.
    function getRegistryForCreator(address creator) external view returns (address) {
        address[] storage existing = registriesByCreator[creator];
        return existing.length != 0 ? existing[0] : address(0);
    }
}
