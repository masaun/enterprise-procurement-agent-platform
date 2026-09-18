// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ProcurementRegistryFactory} from "../src/ProcurementRegistryFactory.sol";
import {ProcurementRegistry} from "../src/ProcurementRegistry.sol";

contract ProcurementRegistryFactoryTest is Test {
    ProcurementRegistryFactory internal factory;

    address internal admin = makeAddr("admin");
    address internal otherAdmin = makeAddr("otherAdmin");
    address internal agent = makeAddr("agent");

    function setUp() public {
        factory = new ProcurementRegistryFactory();
    }

    function test_CreateNewProcurementRegistry_SetsCallerAsOwner() public {
        vm.prank(admin);
        address registryAddress = factory.createNewProcurementRegistry();

        assertEq(ProcurementRegistry(registryAddress).owner(), admin);
    }

    function test_CreateNewProcurementRegistry_TracksDeployedRegistries() public {
        vm.prank(admin);
        address first = factory.createNewProcurementRegistry();

        vm.prank(otherAdmin);
        address second = factory.createNewProcurementRegistry();

        assertEq(factory.getDeployedRegistriesCount(), 2);
        assertEq(factory.deployedRegistries(0), first);
        assertEq(factory.deployedRegistries(1), second);

        address[] memory adminRegistries = factory.getRegistriesByCreator(admin);
        assertEq(adminRegistries.length, 1);
        assertEq(adminRegistries[0], first);
    }

    function test_CreateNewProcurementRegistry_RevertsOnSecondCallBySameCreator() public {
        vm.prank(admin);
        address first = factory.createNewProcurementRegistry();

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ProcurementRegistryFactory.RegistryAlreadyExists.selector, admin, first));
        factory.createNewProcurementRegistry();
    }

    function test_GetRegistryForCreator_ReturnsZeroAddressBeforeCreationAndTheRegistryAfter() public {
        assertEq(factory.getRegistryForCreator(admin), address(0));

        vm.prank(admin);
        address registryAddress = factory.createNewProcurementRegistry();

        assertEq(factory.getRegistryForCreator(admin), registryAddress);
    }

    function test_CreateNewProcurementRegistry_EmitsEvent() public {
        address predicted = vm.computeCreateAddress(address(factory), vm.getNonce(address(factory)));

        vm.expectEmit(true, true, false, true);
        emit ProcurementRegistryFactory.ProcurementRegistryCreated(predicted, admin, 0);

        vm.prank(admin);
        factory.createNewProcurementRegistry();
    }

    function test_OwnerOfCreatedRegistryCanAuthorizeAndRevokeAgent() public {
        vm.prank(admin);
        address registryAddress = factory.createNewProcurementRegistry();
        ProcurementRegistry registry = ProcurementRegistry(registryAddress);

        vm.prank(admin);
        registry.addAuthorizedAgent(agent);
        assertTrue(registry.authorizedAgents(agent));

        vm.prank(admin);
        registry.revokeAuthorizedAgent(agent);
        assertFalse(registry.authorizedAgents(agent));
    }

    function test_NonOwnerCannotAuthorizeAgentOnCreatedRegistry() public {
        vm.prank(admin);
        address registryAddress = factory.createNewProcurementRegistry();

        vm.prank(otherAdmin);
        vm.expectRevert();
        ProcurementRegistry(registryAddress).addAuthorizedAgent(agent);
    }
}
