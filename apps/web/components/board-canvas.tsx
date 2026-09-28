"use client";

import { useEffect, useRef, useState } from "react";
import type { FrontId, PlayerId, SlotId } from "@cardforge/card-schema";
import type { GameState } from "@cardforge/rules-kernel";
import { Application, Graphics, Text, TextStyle } from "pixi.js";
import {
  browserEngine,
  type BoardAnchor,
  type PresentationBatch,
  type PresentationTone,
} from "@/lib/match-ui";

export interface BoardIntent {
  readonly front: FrontId;
  readonly slot?: SlotId;
  readonly playerId?: PlayerId;
  readonly entityId?: string;
}

export type BoardHitTest = (
  clientX: number,
  clientY: number,
) => BoardIntent | null;

interface BoardCanvasProps {
  readonly state: Pick<GameState, "fronts">;
  readonly viewerId: PlayerId;
  readonly selectedId: string | null;
  readonly legalSlots: ReadonlySet<string>;
  readonly legalTargets: ReadonlySet<string>;
  readonly legalFronts: ReadonlySet<FrontId>;
  readonly presentation: PresentationBatch | null;
  readonly reducedMotion: boolean;
  readonly themePalette?: Readonly<Record<string, string>>;
  readonly onIntent: (intent: BoardIntent) => void;
  /** Receives a hit-test function for drag-and-drop from the DOM hand. */
  readonly onHitTest?: (hitTest: BoardHitTest) => void;
  /** Draw aiming lines from this source to every legal target. */
  readonly aimFrom?: string | null;
  /** Draw an aiming line to the enemy Leader as well. */
  readonly aimAtLeader?: boolean;
}

const fronts = ["left", "center", "right"] as const;
const slots = ["vanguard", "support"] as const;
const cueColors: Readonly<Record<PresentationTone, number>> = {
  motion: 0x6dffba,
  impact: 0xff6e91,
  guard: 0x45d9ff,
  objective: 0xffbf54,
  victory: 0xffffff,
};

function themeColor(value: string | undefined, fallback: number): number {
  return value?.startsWith("#")
    ? Number.parseInt(value.slice(1), 16)
    : fallback;
}

function destroyChildren(app: Application): void {
  for (const child of app.stage.removeChildren())
    child.destroy({ children: true });
}

export function BoardCanvas({
  state,
  viewerId,
  selectedId,
  legalSlots,
  legalTargets,
  legalFronts,
  presentation,
  reducedMotion,
  themePalette,
  onIntent,
  onHitTest,
  aimFrom = null,
  aimAtLeader = false,
}: BoardCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const intentRef = useRef(onIntent);
  const hitAreasRef = useRef<
    { x: number; y: number; w: number; h: number; intent: BoardIntent }[]
  >([]);
  const layoutRef = useRef({ scale: 1, offsetX: 0 });
  const [canvasRevision, setCanvasRevision] = useState(0);
  intentRef.current = onIntent;

  useEffect(() => {
    onHitTest?.((clientX, clientY) => {
      const host = hostRef.current;
      if (!host) return null;
      const bounds = host.getBoundingClientRect();
      const { scale, offsetX } = layoutRef.current;
      const x = (clientX - bounds.left - offsetX) / scale;
      const y = (clientY - bounds.top) / scale;
      // Slots are listed after lanes, so prefer the most specific area.
      const hit = [...hitAreasRef.current]
        .reverse()
        .find(
          (area) =>
            x >= area.x &&
            x <= area.x + area.w &&
            y >= area.y &&
            y <= area.y + area.h,
        );
      return hit?.intent ?? null;
    });
  }, [onHitTest]);

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
    // Lay out at a readable logical size and scale down to fit, instead of
    // clipping, so tablets, Steam Deck, and landscape phones see the board.
    const width = Math.max(app.screen.width, 720);
    const height = Math.max(app.screen.height, 500);
    const scale = Math.min(
      app.screen.width / width,
      app.screen.height / height,
      1,
    );
    app.stage.scale.set(scale);
    // Center the scaled board horizontally when height is the limit.
    const offsetX = Math.max(0, (app.screen.width - width * scale) / 2);
    app.stage.position.set(offsetX, 0);
    layoutRef.current = { scale, offsetX };
    hitAreasRef.current = [];
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
      opponent: { support: 66, vanguard: 146 },
      viewer: { vanguard: height - 226, support: height - 146 },
    } as const;
    const slotHeight = 64;

    const anchorPoint = (anchor: BoardAnchor) => {
      const frontIndex = anchor.front ? fronts.indexOf(anchor.front) : 1;
      const x = outer + frontIndex * (laneWidth + laneGap) + laneWidth / 2;
      if (anchor.leader)
        return {
          x,
          y: anchor.playerId === viewerId ? height - 18 : 18,
        };
      if (anchor.slot && anchor.playerId) {
        const side = anchor.playerId === viewerId ? "viewer" : "opponent";
        return { x, y: slotY[side][anchor.slot] + slotHeight / 2 };
      }
      return { x, y: height / 2 };
    };

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
      hitAreasRef.current.push({
        x,
        y: 24,
        w: laneWidth,
        h: height - 48,
        intent: { front },
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

      const opponentId = viewerId === "p1" ? "p2" : "p1";
      for (const playerId of [opponentId, viewerId] as const) {
        for (const slot of slots) {
          const y = slotY[playerId === viewerId ? "viewer" : "opponent"][slot];
          const key = `${front}:${slot}`;
          const instance = state.fronts[front].slots[playerId][slot];
          const isLegalSlot = playerId === viewerId && legalSlots.has(key);
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
          hitAreasRef.current.push({
            x: x + 12,
            y,
            w: laneWidth - 24,
            h: slotHeight,
            intent: {
              front,
              slot,
              playerId,
              ...(instance ? { entityId: instance.instanceId } : {}),
            },
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
            const statuses = [
              ...(instance.barrier ? ["Barrier"] : []),
              ...instance.statuses.map(
                (status) =>
                  `${status.statusId[0].toUpperCase()}${status.statusId.slice(1)}${status.value > 1 ? ` ${status.value}` : ""}`,
              ),
            ];
            const stats = new Text({
              text: `⚔ ${definition?.power ?? 0}   ♥ ${(definition?.vitality ?? 0) - instance.damage}   ◆ ${definition?.presence ?? 0}${
                instance.ready ? "" : "   · spent"
              }${statuses.length ? `\n${statuses.join(", ")}` : ""}`,
              style: metaStyle,
            });
            stats.x = x + 24;
            stats.y = y + (statuses.length ? 30 : 40);
            if (!instance.ready) label.alpha = 0.7;
            app.stage.addChild(stats);
          } else {
            const empty = new Text({
              text: `${playerId === viewerId ? "YOUR" : "RIVAL"} ${slot.toUpperCase()}`,
              style: metaStyle,
            });
            empty.x = x + 24;
            empty.y = y + 25;
            app.stage.addChild(empty);
          }
        }
      }
    }

    if (aimFrom || aimAtLeader) {
      const sourceAnchor = (() => {
        for (const front of fronts)
          for (const playerId of ["p1", "p2"] as const)
            for (const slot of slots)
              if (
                state.fronts[front].slots[playerId][slot]?.instanceId ===
                aimFrom
              )
                return anchorPoint({ front, playerId, slot });
        return { x: width / 2, y: height - 8 };
      })();
      const aim = new Graphics();
      const aimColor = themeColor(themePalette?.danger, 0xff6e91);
      const targetPoints: { x: number; y: number }[] = [];
      for (const front of fronts)
        for (const playerId of ["p1", "p2"] as const)
          for (const slot of slots) {
            const instance = state.fronts[front].slots[playerId][slot];
            if (instance && legalTargets.has(instance.instanceId))
              targetPoints.push(anchorPoint({ front, playerId, slot }));
          }
      if (aimAtLeader) {
        const enemy = viewerId === "p1" ? "p2" : "p1";
        const leaderPoint = anchorPoint({
          playerId: enemy,
          leader: true,
          front: "center",
        });
        targetPoints.push(leaderPoint);
        aim
          .circle(leaderPoint.x, leaderPoint.y + 6, 16)
          .stroke({ color: aimColor, width: 3, alpha: 0.9 });
      }
      for (const point of targetPoints) {
        const dx = point.x - sourceAnchor.x;
        const dy = point.y - sourceAnchor.y;
        const length = Math.hypot(dx, dy);
        for (let offset = 0; offset < length - 8; offset += 14) {
          const from = offset / length;
          const to = Math.min(1, (offset + 7) / length);
          aim
            .moveTo(sourceAnchor.x + dx * from, sourceAnchor.y + dy * from)
            .lineTo(sourceAnchor.x + dx * to, sourceAnchor.y + dy * to);
        }
      }
      aim.stroke({ color: aimColor, width: 2, alpha: 0.75 });
      app.stage.addChild(aim);
    }

    const centerLine = new Graphics()
      .moveTo(outer, height / 2)
      .lineTo(width - outer, height / 2)
      .stroke({ color: 0x7ce7ff, width: 1, alpha: 0.18 });
    app.stage.addChild(centerLine);

    let animateCueLayer: (() => void) | undefined;
    if (presentation && presentation.cues.length > 0) {
      const cueLayer = new Graphics();
      for (const cue of presentation.cues.slice(-4)) {
        const color =
          cue.tone === "impact"
            ? themeColor(themePalette?.danger, cueColors[cue.tone])
            : cue.tone === "motion"
              ? themeColor(themePalette?.primary, cueColors[cue.tone])
              : cue.tone === "guard"
                ? themeColor(themePalette?.secondary, cueColors[cue.tone])
                : cueColors[cue.tone];
        const source = cue.source ? anchorPoint(cue.source) : undefined;
        const target = cue.target ? anchorPoint(cue.target) : undefined;
        if (source && target)
          cueLayer
            .moveTo(source.x, source.y)
            .lineTo(target.x, target.y)
            .stroke({
              color,
              width: cue.kind === "damage" ? 5 : 3,
              alpha: 0.8,
            });
        if (source)
          cueLayer
            .circle(source.x, source.y, 13)
            .stroke({ color, width: 3, alpha: 0.75 });
        if (target) {
          if (cue.target?.front && !cue.target.slot && !cue.target.leader) {
            const targetIndex = fronts.indexOf(cue.target.front);
            const laneX = outer + targetIndex * (laneWidth + laneGap);
            cueLayer
              .roundRect(laneX + 5, 27, laneWidth - 10, height - 54, 16)
              .stroke({ color, width: 4, alpha: 0.85 });
          } else
            cueLayer
              .circle(target.x, target.y, cue.kind === "defeat" ? 31 : 24)
              .stroke({ color, width: 5, alpha: 0.9 });
        }
      }
      app.stage.addChild(cueLayer);
      if (!reducedMotion) {
        let elapsed = 0;
        animateCueLayer = () => {
          elapsed += app.ticker.deltaMS;
          const progress = Math.min(elapsed / 1_050, 1);
          cueLayer.alpha = 1 - progress * progress;
          cueLayer.scale.set(1 + Math.sin(progress * Math.PI) * 0.035);
          cueLayer.pivot.set(width / 2, height / 2);
          cueLayer.position.set(width / 2, height / 2);
          if (progress >= 1 && animateCueLayer)
            app.ticker?.remove(animateCueLayer);
        };
        app.ticker.add(animateCueLayer);
      }
    }

    return () => {
      // The app may already be destroyed when the component unmounts.
      if (animateCueLayer && appRef.current === app)
        app.ticker?.remove(animateCueLayer);
    };
  }, [
    state,
    selectedId,
    legalSlots,
    legalTargets,
    legalFronts,
    viewerId,
    canvasRevision,
    presentation,
    reducedMotion,
    themePalette,
    aimFrom,
    aimAtLeader,
  ]);

  return (
    <div
      className="board-canvas"
      data-cue-count={presentation?.cues.length ?? 0}
      data-event-sequence={presentation?.sequence ?? 0}
      ref={hostRef}
    />
  );
}
