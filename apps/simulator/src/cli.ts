#!/usr/bin/env node
import { runArchetypeMatrix, runBatch } from "./simulation.js";

function integerOption(name: string, fallback: number): number {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const raw = process.argv[index + 1];
  const value = Number(raw);
  if (!raw || !Number.isSafeInteger(value))
    throw new Error(`${name} requires an integer`);
  return value;
}

const games = integerOption("--games", 1_000);
const seed = integerOption("--seed", 1);
const started = performance.now();
const matrix = process.argv.includes("--matrix");
const gamesPerSeat = integerOption("--games-per-seat", 2);
const summary = matrix
  ? runArchetypeMatrix(gamesPerSeat, seed)
  : runBatch(games, seed);
const elapsedMs = Math.round(performance.now() - started);

console.log(
  JSON.stringify(
    {
      ...summary,
      elapsedMs,
      replaysVerified: matrix ? summary.games : games,
    },
    null,
    2,
  ),
);
