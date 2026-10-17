import { z } from "zod";

export const binary32Max = 3.4028234663852886e38;
const scalar = z.number().min(-binary32Max).max(binary32Max);
export const floatStat = z
  .object({ base: scalar, add: scalar, subtract: scalar, multiply: scalar })
  .strict();
export type FloatStat = z.infer<typeof floatStat>;

export function statValue(stat: FloatStat, operands: readonly number[] = []) {
  const f = Math.fround;
  let add = f(stat.add);
  for (const operand of operands) add = f(add + f(operand));
  let value = f(stat.base);
  if (add !== 0) value = f(add + value);
  const subtract = f(stat.subtract);
  if (subtract !== 0) value = f(value - subtract);
  const multiply = f(stat.multiply);
  return multiply === 0 ? value : f(value * multiply);
}
