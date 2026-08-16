"use client";

import { useEffect, useRef, useState } from "react";
import type { FrontId, PlayerId, SlotId } from "@cardforge/card-schema";
import type { GameState } from "@cardforge/rules-kernel";
import { Application, Graphics, Text, TextStyle } from "pixi.js";
import { browserEngine } from "@/lib/match-ui";

export interface BoardIntent {
  readonly front: FrontId;
  readonly slot?: SlotId;
  readonly playerId?: PlayerId;
  readonly entityId?: string;
}

interface BoardCanvasProps {
  readonly state: GameState;
  readonly selectedId: string | null;
  readonly legalSlots: ReadonlySet<string>;
  readonly legalTargets: ReadonlySet<string>;
  readonly legalFronts: ReadonlySet<FrontId>;
  readonly onIntent: (intent: BoardIntent) => void;
}

const fronts = ["left", "center", "right"] as const;
const slots = ["vanguard", "support"] as const;

function destroyChildren(app: Application): void {
  for (const child of app.stage.removeChildren())
    child.destroy({ children: true });
}

export function BoardCanvas({
  state,
  selectedId,
  legalSlots,
  legalTargets,
  legalFronts,
  onIntent,
}: BoardCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const intentRef = useRef(onIntent);
  const [canvasRevision, setCanvasRevision] = useState(0);
  intentRef.current = onIntent;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let observer: ResizeObserver | null = null;
    const app = new Application();
    void app
      .init({
        resizeTo: host,
        preference: "webgl",
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio, 2),
        backgroundAlpha: 0,
      })
      .then(() => {
        if (disposed) {
          app.destroy(true, { children: true });
          return;
        }
        appRef.current = app;
        app.canvas.setAttribute("aria-hidden", "true");
        host.appendChild(app.canvas);
        observer = new ResizeObserver(() =>
          setCanvasRevision((revision) => revision + 1),
        );
        observer.observe(host);
        setCanvasRevision((revision) => revision + 1);
      });
    return () => {
      disposed = true;
      observer?.disconnect();
      if (appRef.current === app) {
        appRef.current = null;
        app.destroy(true, { children: true });
      }
    };
  }, []);

  useEffect(() => {
    const app = appRef.current;
    if (!app) return;
    destroyChildren(app);
    const width = Math.max(app.screen.width, 720);
    const height = Math.max(app.screen.height, 500);
    const laneGap = 18;
    const outer = 24;
    const laneWidth = (width - outer * 2 - laneGap * 2) / 3;
    const colors = [0x45d9ff, 0xb85cff, 0xffbf54] as const;

    const field = new Graphics()
      .roundRect(2, 2, width - 4, height - 4, 24)
      .fill({ color: 0x07101d, alpha: 0.94 })
      .stroke({ color: 0x1a3853, width: 2, alpha: 0.9 });
    app.stage.addChild(field);

    const starLayer = new Graphics();
    for (let index = 0; index < 72; index += 1) {
      const x = (index * 83 + 31) % Math.floor(width);
      const y = (index * 47 + 19) % Math.floor(height);
      const radius = index % 7 === 0 ? 1.4 : 0.7;
      starLayer.circle(x, y, radius).fill({
        color: index % 3 === 0 ? 0x45d9ff : 0xffffff,
        alpha: index % 5 === 0 ? 0.35 : 0.15,
      });
    }
    app.stage.addChild(starLayer);

    const headlineStyle = new TextStyle({
      fontFamily: "ui-monospace, SFMono-Regular, monospace",
      fontSize: 11,
      fontWeight: "700",
      fill: 0xc9eaff,
      letterSpacing: 2,
    });
    const cardStyle = new TextStyle({
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: 12,
      fontWeight: "600",
      fill: 0xf4fbff,
      wordWrap: true,
      wordWrapWidth: laneWidth - 36,
    });
    const metaStyle = new TextStyle({
      fontFamily: "ui-monospace, SFMono-Regular, monospace",
      fontSize: 10,
      fill: 0x8eb3ca,
    });

    const slotY = {
      p2: { support: 66, vanguard: 146 },
      p1: { vanguard: height - 226, support: height - 146 },
    } as const;
    const slotHeight = 64;

    for (const [frontIndex, front] of fronts.entries()) {
      const x = outer + frontIndex * (laneWidth + laneGap);
      const color = colors[frontIndex];
      const isLegalFront = legalFronts.has(front);
      const lane = new Graphics()
        .roundRect(x, 24, laneWidth, height - 48, 18)
        .fill({ color: 0x0c1a2a, alpha: 0.7 })
        .stroke({
          color: isLegalFront ? 0x6dffba : color,
          width: isLegalFront ? 3 : 1,
          alpha: isLegalFront ? 0.95 : 0.35,
        });
      lane.eventMode = isLegalFront ? "static" : "none";
      lane.cursor = isLegalFront ? "pointer" : "default";
      lane.on("pointertap", () => intentRef.current({ front }));
      app.stage.addChild(lane);

      const title = new Text({
        text: front.toUpperCase(),
        style: headlineStyle,
      });
      title.x = x + 14;
      title.y = 34;
      app.stage.addChild(title);

      const site = state.fronts[front].site;
      const siteBand = new Graphics()
        .roundRect(x + 12, height / 2 - 18, laneWidth - 24, 36, 10)
        .fill({ color: site ? color : 0x101f2e, alpha: site ? 0.28 : 0.7 })
        .stroke({ color, width: 1, alpha: 0.35 });
      app.stage.addChild(siteBand);
      const siteText = new Text({
        text: site
          ? `SITE // ${browserEngine.cards.get(site.cardId)?.name ?? site.cardId}`
          : "SITE // OPEN",
        style: metaStyle,
      });
      siteText.x = x + 22;
      siteText.y = height / 2 - 6;
      app.stage.addChild(siteText);

      for (const playerId of ["p2", "p1"] as const) {
        for (const slot of slots) {
          const y = slotY[playerId][slot];
          const key = `${front}:${slot}`;
          const instance = state.fronts[front].slots[playerId][slot];
          const isLegalSlot = playerId === "p1" && legalSlots.has(key);
          const isTarget = instance
            ? legalTargets.has(instance.instanceId)
            : false;
          const isSelected = instance?.instanceId === selectedId;
          const frame = new Graphics()
            .roundRect(x + 12, y, laneWidth - 24, slotHeight, 12)
            .fill({
              color: instance ? 0x122c42 : 0x091522,
              alpha: instance ? 0.96 : 0.6,
            })
            .stroke({
              color: isTarget
                ? 0xff6e91
                : isLegalSlot
                  ? 0x6dffba
                  : isSelected
                    ? 0xffffff
                    : 0x27465d,
              width: isTarget || isLegalSlot || isSelected ? 3 : 1,
              alpha: 0.95,
            });
          const interactive = isLegalSlot || isTarget || Boolean(instance);
          frame.eventMode = interactive ? "static" : "none";
          frame.cursor = interactive ? "pointer" : "default";
          frame.on("pointertap", () =>
            intentRef.current({
              front,
              slot,
              playerId,
              ...(instance ? { entityId: instance.instanceId } : {}),
            }),
          );
          app.stage.addChild(frame);

          if (instance) {
            const definition = browserEngine.cards.get(instance.cardId);
            const label = new Text({
              text: definition?.name ?? instance.cardId,
              style: cardStyle,
            });
            label.x = x + 24;
            label.y = y + 10;
            app.stage.addChild(label);
            const stats = new Text({
              text: `${definition?.power ?? 0} PWR  •  ${(definition?.vitality ?? 0) - instance.damage} VIT  •  ${definition?.presence ?? 0} PRE`,
              style: metaStyle,
            });
            stats.x = x + 24;
            stats.y = y + 40;
            app.stage.addChild(stats);
          } else {
            const empty = new Text({
              text: `${playerId === "p1" ? "YOUR" : "RIVAL"} ${slot.toUpperCase()}`,
              style: metaStyle,
            });
            empty.x = x + 24;
            empty.y = y + 25;
            app.stage.addChild(empty);
          }
        }
      }
    }

    const centerLine = new Graphics()
      .moveTo(outer, height / 2)
      .lineTo(width - outer, height / 2)
      .stroke({ color: 0x7ce7ff, width: 1, alpha: 0.18 });
    app.stage.addChild(centerLine);
  }, [
    state,
    selectedId,
    legalSlots,
    legalTargets,
    legalFronts,
    canvasRevision,
  ]);

  return <div className="board-canvas" ref={hostRef} />;
}
