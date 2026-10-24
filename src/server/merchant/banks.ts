export type SupportedBank = {
  code: string;
  name: string;
  /** What a tile shows in large type; `name` goes under it when it says more. */
  short: string;
  kind: "wallet" | "bank";
};

// E-wallets first: most small shops are paid out to GCash or Maya.
export const SUPPORTED_BANKS: readonly SupportedBank[] = [
  { code: "GCASH", name: "GCash", short: "GCash", kind: "wallet" },
  { code: "MAYA", name: "Maya", short: "Maya", kind: "wallet" },
  { code: "BPI", name: "Bank of the Philippine Islands", short: "BPI", kind: "bank" },
  { code: "BDO", name: "BDO Unibank", short: "BDO", kind: "bank" },
  { code: "UBP", name: "UnionBank of the Philippines", short: "UnionBank", kind: "bank" },
  { code: "METROBANK", name: "Metrobank", short: "Metrobank", kind: "bank" },
  { code: "LANDBANK", name: "Land Bank of the Philippines", short: "Landbank", kind: "bank" },
  { code: "PNB", name: "Philippine National Bank", short: "PNB", kind: "bank" },
  { code: "SECURITYBANK", name: "Security Bank", short: "Security Bank", kind: "bank" },
  { code: "CTBC", name: "CTBC Bank Philippines", short: "CTBC", kind: "bank" },
  { code: "RCBC", name: "Rizal Commercial Banking Corp.", short: "RCBC", kind: "bank" },
] as const;

const BY_CODE = new Map(SUPPORTED_BANKS.map((b) => [b.code, b.name]));

export function getBankName(code: string): string | null {
  return BY_CODE.get(code) ?? null;
}
