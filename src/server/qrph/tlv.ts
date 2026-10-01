import "server-only";

export type TlvNode = { tag: string; length: number; value: string };

export function parseTlv(input: string): TlvNode[] {
  const nodes: TlvNode[] = [];
  let i = 0;
  while (i < input.length) {
    if (i + 4 > input.length) throw new Error(`TLV truncated at position ${i}`);
    const tag = input.slice(i, i + 2);
    const lenStr = input.slice(i + 2, i + 4);
    if (!/^\d{2}$/.test(lenStr)) throw new Error(`Invalid TLV length "${lenStr}" at position ${i}`);
    const length = Number(lenStr);
    const start = i + 4;
    const end = start + length;
    if (end > input.length) throw new Error(`TLV value overrun at tag ${tag}`);
    nodes.push({ tag, length, value: input.slice(start, end) });
    i = end;
  }
  return nodes;
}

export function toMap(nodes: TlvNode[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const node of nodes) map[node.tag] = node.value;
  return map;
}

export function parseTemplate(value: string): Record<string, string> {
  return toMap(parseTlv(value));
}
