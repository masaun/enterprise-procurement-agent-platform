/**
 * Hand-extracted ABI subset for `ProcurementRegistryFactory.sol`
 * (./contracts) — mirrors
 * `contracts/out/ProcurementRegistryFactory.sol/ProcurementRegistryFactory.json`.
 * Re-extract from the compiled artifact if the contract's interface changes.
 */
export const PROCUREMENT_REGISTRY_FACTORY_ABI = [
  {
    type: "function",
    name: "createNewProcurementRegistry",
    inputs: [],
    outputs: [{ name: "registry", type: "address", internalType: "address" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "getDeployedRegistriesCount",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getRegistriesByCreator",
    inputs: [{ name: "creator", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "address[]", internalType: "address[]" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getRegistryForCreator",
    inputs: [{ name: "creator", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
  {
    type: "error",
    name: "RegistryAlreadyExists",
    inputs: [
      { name: "creator", type: "address", internalType: "address" },
      { name: "existing", type: "address", internalType: "address" },
    ],
  },
  {
    type: "event",
    name: "ProcurementRegistryCreated",
    inputs: [
      { name: "registry", type: "address", indexed: true, internalType: "address" },
      { name: "owner", type: "address", indexed: true, internalType: "address" },
      { name: "index", type: "uint256", indexed: false, internalType: "uint256" },
    ],
    anonymous: false,
  },
] as const;
