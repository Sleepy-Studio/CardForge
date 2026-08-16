import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { coreSetSource } from "@cardforge/content-core-set";
import { defaultTheme } from "@cardforge/theme-default";
import { orbitalTheme } from "@cardforge/theme-test-scifi";
import { renderCardSvg } from "./card-renderer.js";
import {
  compileContentPack,
  compilePresentation,
  validatePackGraph,
  validateTheme,
} from "./compiler.js";
import { importCardsCsv } from "./csv-import.js";

void describe("content factory", () => {
  void it("compiles semantic gameplay once for two complete presentations", () => {
    const pack = compileContentPack(coreSetSource);
    const fantasy = compilePresentation(pack, defaultTheme);
    const scienceFiction = compilePresentation(pack, orbitalTheme);
    assert.equal(pack.cards.length, 61);
    assert.equal(fantasy.gameplayHash, scienceFiction.gameplayHash);
    assert.notEqual(fantasy.presentationHash, scienceFiction.presentationHash);
    const salvage = scienceFiction.cards.find(
      (card) => card.cardId === "tactic.recover",
    );
    assert.match(salvage?.rulesText ?? "", /Scrapyard/);
    assert.doesNotMatch(salvage?.rulesText ?? "", /discard/);
  });

  void it("renders an accessible theme-driven SVG card preview", () => {
    const card = coreSetSource.cards.find(
      (candidate) => candidate.cardId === "entity.linebreaker",
    );
    assert.ok(card);
    const fantasy = renderCardSvg(card, defaultTheme);
    const scienceFiction = renderCardSvg(card, orbitalTheme);
    assert.match(fantasy, /aether-rune|#07111d|Linebreaker/);
    assert.match(scienceFiction, /#02060d|Linebreaker/);
    assert.notEqual(fantasy, scienceFiction);
  });

  void it("rejects incomplete themes and circular pack dependencies", () => {
    assert.throws(
      () => validateTheme({ ...orbitalTheme, eventPresentation: {} }),
      /Theme is incomplete/,
    );
    assert.throws(
      () =>
        validatePackGraph([
          {
            packId: "pack-a",
            revision: 1,
            gameId: "game",
            ruleset: "rules@1",
            setIds: ["set-a"],
            dependencies: ["pack-b"],
          },
          {
            packId: "pack-b",
            revision: 1,
            gameId: "game",
            ruleset: "rules@1",
            setIds: ["set-b"],
            dependencies: ["pack-a"],
          },
        ]),
      /Circular pack dependency/,
    );
  });

  void it("imports typed spreadsheet rows and rejects malformed values", () => {
    const header =
      "cardId,revision,name,type,aspects,setId,focusCost,playTime,power,vitality,presence,strikeTime";
    const valid = importCardsCsv(
      `${header}\nentity.csv-scout,1,CSV Scout,entity,motion,core-prototype,2,2,2,3,1,3`,
    );
    assert.equal(valid[0]?.cardId, "entity.csv-scout");
    assert.throws(
      () =>
        importCardsCsv(
          `${header}\nentity.bad,one,Bad,entity,motion,core-prototype,2,2,2,3,1,3`,
        ),
      /CSV row 2 is invalid/,
    );
  });
});
