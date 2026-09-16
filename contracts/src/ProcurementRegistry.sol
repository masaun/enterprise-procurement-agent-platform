// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * On-chain activity/receipt history for the Enterprise Procurement platform.
 *
 * Roles:
 * - `owner` (Ownable) is the *platform* — it administers `authorizedAgents`,
 *   populating it only after the platform's own off-chain, live ERC-8004
 *   identity/reputation verification (see app/lib/identity/gate.ts) passes
 *   for a given external agent's wallet. This keeps the contract itself
 *   simple: it doesn't need to know the ERC-8004 registries' exact ABI.
 * - An `authorizedAgents` entry is an external agent's own treasury wallet
 *   (e.g. Hermes/OpenClaw, running the `agent-skills` CLI) — it calls
 *   `recordProcurement` itself, using its own key, after executing a
 *   procurement via KeeperHub. `msg.sender` is trusted as the agent address;
 *   nothing here custodies funds or executes anything on the enterprise's
 *   behalf.
 */
contract ProcurementRegistry is Ownable {
    enum Status {
        Completed,
        Rejected,
        Failed
    }

    struct Receipt {
        address enterprise;
        address agent;
        uint64 createdAt;
        Status status;
        bytes32 detailsHash;
    }

    /// @dev taskId -> receipt. A taskId can only be recorded once.
    mapping(bytes32 => Receipt) public receipts;

    /// @dev Enumerable index of every recorded taskId, in submission order.
    bytes32[] public taskIds;

    /// @dev Wallets allowed to call `recordProcurement`.
    mapping(address => bool) public authorizedAgents;

    event AgentAuthorized(address indexed agent);
    event AgentRevoked(address indexed agent);

    event ProcurementRecorded(
        bytes32 indexed taskId,
        address indexed enterprise,
        address indexed agent,
        Status status,
        string asset,
        uint256 amount,
        uint32 apyBps,
        bytes32 detailsHash,
        string detailsURI
    );

    error NotAuthorizedAgent(address agent);
    error TaskAlreadyRecorded(bytes32 taskId);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function addAuthorizedAgent(address agent) external onlyOwner {
        authorizedAgents[agent] = true;
        emit AgentAuthorized(agent);
    }

    function revokeAuthorizedAgent(address agent) external onlyOwner {
        authorizedAgents[agent] = false;
        emit AgentRevoked(agent);
    }

    /**
     * Records a completed (or rejected/failed) procurement task on-chain.
     * Callable only by an address the platform has authorized (see above).
     * `detailsHash` should be `keccak256` of the full off-chain JSON record
     * (request + policy + timeline) so the off-chain report ingested by
     * `./app` can be verified against what's on-chain; `detailsURI` is an
     * optional pointer (e.g. an HTTPS/IPFS URL) to that full record.
     */
    function recordProcurement(
        bytes32 taskId,
        address enterprise,
        Status status,
        string calldata asset,
        uint256 amount,
        uint32 apyBps,
        bytes32 detailsHash,
        string calldata detailsURI
    ) external {
        if (!authorizedAgents[msg.sender]) revert NotAuthorizedAgent(msg.sender);
        if (receipts[taskId].createdAt != 0) revert TaskAlreadyRecorded(taskId);

        receipts[taskId] = Receipt({
            enterprise: enterprise,
            agent: msg.sender,
            createdAt: uint64(block.timestamp),
            status: status,
            detailsHash: detailsHash
        });
        taskIds.push(taskId);

        emit ProcurementRecorded(taskId, enterprise, msg.sender, status, asset, amount, apyBps, detailsHash, detailsURI);
    }

    function getTaskCount() external view returns (uint256) {
        return taskIds.length;
    }

    function getTaskIdAt(uint256 index) external view returns (bytes32) {
        return taskIds[index];
    }
}
