import {
  cardDefinitionSchema,
  type CardDefinition,
} from "@cardforge/card-schema";

function cells(line: string): string[] {
  const output: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"' && quoted && line[index + 1] === '"') {
      value += '"';
      index += 1;
    } else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) {
      output.push(value);
      value = "";
    } else value += character;
  }
  output.push(value);
  return output;
}

export function importCardsCsv(csv: string): readonly CardDefinition[] {
  const lines = csv.trim().split(/\r?\n/);
  const headers = cells(lines.shift() ?? "");
  return lines.filter(Boolean).map((line, rowIndex) => {
    const row = Object.fromEntries(
      headers.map((header, index) => [header, cells(line)[index] ?? ""]),
    );
    const number = (key: string) =>
      row[key] === "" || row[key] === undefined ? undefined : Number(row[key]);
    const candidate = {
      cardId: row.cardId,
      revision: number("revision"),
      name: row.name,
      type: row.type,
      aspects: row.aspects?.split("|").filter(Boolean),
      setId: row.setId,
      focusCost: number("focusCost"),
      playTime: number("playTime"),
      ...(number("power") === undefined ? {} : { power: number("power") }),
      ...(number("vitality") === undefined
        ? {}
        : { vitality: number("vitality") }),
      ...(number("presence") === undefined
        ? {}
        : { presence: number("presence") }),
      ...(number("strikeTime") === undefined
        ? {}
        : { strikeTime: number("strikeTime") }),
    };
    const parsed = cardDefinitionSchema.safeParse(candidate);
    if (!parsed.success)
      throw new Error(
        `CSV row ${rowIndex + 2} is invalid: ${parsed.error.issues.map((issue) => issue.message).join(", ")}`,
      );
    return parsed.data as CardDefinition;
  });
}
