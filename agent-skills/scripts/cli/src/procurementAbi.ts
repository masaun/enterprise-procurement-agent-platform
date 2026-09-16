/**
 * Hand-extracted ABI subset for `ProcurementRegistry.sol` (./contracts) —
 * only the functions/events this CLI needs. Mirrors the compiled artifact at
 * `contracts/out/ProcurementRegistry.sol/ProcurementRegistry.json`; if the
 * contract's interface changes, re-extract from that file rather than
 * hand-editing this one out of sync.
 */
export const PROCUREMENT_REGISTRY_ABI = [
  {
    type: "function",
    name: "authorizedAgents",
    inputs: [{ name: "", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getTaskCount",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getTaskIdAt",
    inputs: [{ name: "index", type: "uint256", internalType: "uint256" }],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "receipts",
    inputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    outputs: [
      { name: "enterprise", type: "address", internalType: "address" },
      { name: "agent", type: "address", internalType: "address" },
      { name: "createdAt", type: "uint64", internalType: "uint64" },
      { name: "status", type: "uint8", internalType: "enum ProcurementRegistry.Status" },
      { name: "detailsHash", type: "bytes32", internalType: "bytes32" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "recordProcurement",
    inputs: [
      { name: "taskId", type: "bytes32", internalType: "bytes32" },
      { name: "enterprise", type: "address", internalType: "address" },
      { name: "status", type: "uint8", internalType: "enum ProcurementRegistry.Status" },
      { name: "asset", type: "string", internalType: "string" },
      { name: "amount", type: "uint256", internalType: "uint256" },
      { name: "apyBps", type: "uint32", internalType: "uint32" },
      { name: "detailsHash", type: "bytes32", internalType: "bytes32" },
      { name: "detailsURI", type: "string", internalType: "string" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "event",
    name: "ProcurementRecorded",
    inputs: [
      { name: "taskId", type: "bytes32", indexed: true, internalType: "bytes32" },
      { name: "enterprise", type: "address", indexed: true, internalType: "address" },
      { name: "agent", type: "address", indexed: true, internalType: "address" },
      { name: "status", type: "uint8", indexed: false, internalType: "enum ProcurementRegistry.Status" },
      { name: "asset", type: "string", indexed: false, internalType: "string" },
      { name: "amount", type: "uint256", indexed: false, internalType: "uint256" },
      { name: "apyBps", type: "uint32", indexed: false, internalType: "uint32" },
      { name: "detailsHash", type: "bytes32", indexed: false, internalType: "bytes32" },
      { name: "detailsURI", type: "string", indexed: false, internalType: "string" },
    ],
    anonymous: false,
  },
] as const;

/** Matches the Solidity `enum Status { Completed, Rejected, Failed }`. */
export const REGISTRY_STATUS = {
  completed: 0,
  rejected: 1,
  failed: 2,
} as const;

export type RegistryStatusLabel = keyof typeof REGISTRY_STATUS;
