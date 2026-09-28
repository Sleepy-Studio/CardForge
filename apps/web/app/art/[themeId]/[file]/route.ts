import {
  generateBoardArt,
  generateCardArt,
  generateCardBack,
} from "@/lib/card-art";
import { cardMap } from "@/lib/cards";
import { isThemeId, themes } from "@/lib/themes";

/**
 * Generated card illustrations: /art/<themeId>/<cardId>.svg, plus
 * /art/<themeId>/card-back.svg and /art/<themeId>/board.svg. Deterministic, so responses cache for a
 * long time; lib/themes.ts#artRevision busts caches when the art changes.
 */
export function GET(
  _request: Request,
  context: { params: Promise<{ themeId: string; file: string }> },
): Promise<Response> {
  return context.params.then(({ themeId, file }) => {
    if (!isThemeId(themeId) || !file.endsWith(".svg"))
      return new Response("Not found", { status: 404 });
    const id = decodeURIComponent(file.slice(0, -4));
    const theme = themes[themeId];
    let body: string | null = null;
    if (id === "card-back") body = generateCardBack(themeId, theme.palette);
    else if (id === "board") body = generateBoardArt(themeId);
    else {
      const card = cardMap.get(id);
      if (card) body = generateCardArt(card, themeId);
    }
    if (!body) return new Response("Not found", { status: 404 });
    return new Response(body, {
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    });
  });
}
