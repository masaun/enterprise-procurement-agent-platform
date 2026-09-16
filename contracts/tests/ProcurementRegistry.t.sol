// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ProcurementRegistry} from "../src/ProcurementRegistry.sol";

contract ProcurementRegistryTest is Test {
    ProcurementRegistry internal registry;

    address internal owner = makeAddr("owner");
    address internal agent = makeAddr("agent");
    address internal otherAgent = makeAddr("otherAgent");
    address internal enterprise = makeAddr("enterprise");

    function setUp() public {
        registry = new ProcurementRegistry(owner);
    }

    function test_OwnerIsSetCorrectly() public view {
        assertEq(registry.owner(), owner);
    }

    function test_OnlyOwnerCanAuthorizeAgent() public {
        vm.expectRevert();
        registry.addAuthorizedAgent(agent);

        vm.prank(owner);
        registry.addAuthorizedAgent(agent);
        assertTrue(registry.authorizedAgents(agent));
    }

    function test_OnlyOwnerCanRevokeAgent() public {
        vm.prank(owner);
        registry.addAuthorizedAgent(agent);

        vm.expectRevert();
        registry.revokeAuthorizedAgent(agent);

        vm.prank(owner);
        registry.revokeAuthorizedAgent(agent);
        assertFalse(registry.authorizedAgents(agent));
    }

    function test_UnauthorizedAgentCannotRecord() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(ProcurementRegistry.NotAuthorizedAgent.selector, agent));
        registry.recordProcurement(
            bytes32("task-1"), enterprise, ProcurementRegistry.Status.Completed, "USDC", 1_000_000e6, 420, bytes32("hash"), ""
        );
    }

    function test_AuthorizedAgentCanRecord() public {
        vm.prank(owner);
        registry.addAuthorizedAgent(agent);

        vm.prank(agent);
        vm.expectEmit(true, true, true, true);
        emit ProcurementRegistry.ProcurementRecorded(
            bytes32("task-1"), enterprise, agent, ProcurementRegistry.Status.Completed, "USDC", 1_000_000e6, 420, bytes32("hash"), "https://example.com/task-1.json"
        );
        registry.recordProcurement(
            bytes32("task-1"),
            enterprise,
            ProcurementRegistry.Status.Completed,
            "USDC",
            1_000_000e6,
            420,
            bytes32("hash"),
            "https://example.com/task-1.json"
        );

        (address recEnterprise, address recAgent,, ProcurementRegistry.Status status, bytes32 detailsHash) =
            registry.receipts(bytes32("task-1"));
        assertEq(recEnterprise, enterprise);
        assertEq(recAgent, agent);
        assertEq(uint8(status), uint8(ProcurementRegistry.Status.Completed));
        assertEq(detailsHash, bytes32("hash"));

        assertEq(registry.getTaskCount(), 1);
        assertEq(registry.getTaskIdAt(0), bytes32("task-1"));
    }

    function test_DuplicateTaskIdReverts() public {
        vm.prank(owner);
        registry.addAuthorizedAgent(agent);

        vm.prank(agent);
        registry.recordProcurement(
            bytes32("task-1"), enterprise, ProcurementRegistry.Status.Completed, "USDC", 1, 400, bytes32("h1"), ""
        );

        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(ProcurementRegistry.TaskAlreadyRecorded.selector, bytes32("task-1")));
        registry.recordProcurement(
            bytes32("task-1"), enterprise, ProcurementRegistry.Status.Failed, "USDC", 1, 400, bytes32("h2"), ""
        );
    }

    function test_MultipleAgentsCanRecordDistinctTasks() public {
        vm.startPrank(owner);
        registry.addAuthorizedAgent(agent);
        registry.addAuthorizedAgent(otherAgent);
        vm.stopPrank();

        vm.prank(agent);
        registry.recordProcurement(
            bytes32("task-1"), enterprise, ProcurementRegistry.Status.Completed, "USDC", 1, 400, bytes32("h1"), ""
        );

        vm.prank(otherAgent);
        registry.recordProcurement(
            bytes32("task-2"), enterprise, ProcurementRegistry.Status.Rejected, "USDC", 1, 300, bytes32("h2"), ""
        );

        assertEq(registry.getTaskCount(), 2);
    }
}
