import * as OpenCC from "opencc-js";

export const HAN_RE = /[\u3400-\u9fff]/;

const CONVERSION_PAIRS: Array<{ from: string; to: string }> = [
  { from: "cn", to: "tw" },
  { from: "tw", to: "cn" },
  { from: "cn", to: "t" },
  { from: "t", to: "cn" },
  { from: "cn", to: "hk" },
  { from: "hk", to: "cn" },
  { from: "tw", to: "t" },
  { from: "t", to: "tw" },
  { from: "tw", to: "hk" },
  { from: "hk", to: "tw" },
  { from: "t", to: "hk" },
  { from: "hk", to: "t" },
];

const CONVERTERS = CONVERSION_PAIRS.map((pair) =>
  OpenCC.Converter({ from: pair.from, to: pair.to }),
);

export function expandHanSearchVariants(text: string): string[] {
  const normalized = text.toLocaleLowerCase();
  if (!HAN_RE.test(normalized)) {
    return [normalized];
  }

  const variants = new Set<string>([normalized]);
  let frontier = [normalized];
  for (let hop = 0; hop < 2; hop += 1) {
    const nextFrontier: string[] = [];
    for (const value of frontier) {
      for (const converter of CONVERTERS) {
        const converted = converter(value);
        if (!variants.has(converted)) {
          variants.add(converted);
          nextFrontier.push(converted);
        }
      }
    }
    frontier = nextFrontier;
    if (frontier.length === 0) break;
  }
  return Array.from(variants);
}

export function expandHanSearchToken(token: string): string[] {
  return expandHanSearchVariants(token);
}
