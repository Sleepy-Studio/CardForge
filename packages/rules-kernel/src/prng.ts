export interface RngState {
  readonly seed: number;
  index: number;
}

function mix32(value: number): number {
  let x = value | 0;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return (x ^ (x >>> 15)) >>> 0;
}

export function nextInt(rng: RngState, ceiling: number): number {
  if (!Number.isSafeInteger(ceiling) || ceiling <= 0)
    throw new Error("RNG ceiling must be a positive integer");
  const value = mix32((rng.seed + rng.index * 0x9e3779b9) >>> 0);
  rng.index += 1;
  return value % ceiling;
}

export function shuffle<T>(values: readonly T[], rng: RngState): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = nextInt(rng, index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
}
