export type SupportedBank = { code: string; name: string };

export const SUPPORTED_BANKS: readonly SupportedBank[] = [
  { code: "BPI", name: "Bank of the Philippine Islands" },
  { code: "BDO", name: "BDO Unibank" },
  { code: "UBP", name: "UnionBank of the Philippines" },
  { code: "METROBANK", name: "Metrobank" },
  { code: "LANDBANK", name: "Land Bank of the Philippines" },
  { code: "PNB", name: "Philippine National Bank" },
  { code: "SECURITYBANK", name: "Security Bank" },
  { code: "CTBC", name: "CTBC Bank Philippines" },
  { code: "RCBC", name: "Rizal Commercial Banking Corp." },
  { code: "GCASH", name: "GCash" },
  { code: "MAYA", name: "Maya" },
] as const;

const BY_CODE = new Map(SUPPORTED_BANKS.map((b) => [b.code, b.name]));

export function getBankName(code: string): string | null {
  return BY_CODE.get(code) ?? null;
}
