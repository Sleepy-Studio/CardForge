import { ServerError } from "@colyseus/core";
import { verifyMatchTicket } from "./auth.js";
import { config } from "./config.js";
import { metrics } from "./metrics.js";
import { cardForgeStore } from "./store.js";

/** Identity attached to every room client; derived only from a verified ticket. */
export interface RoomIdentity {
  readonly accountId: string;
  readonly displayName: string;
}

/**
 * Colyseus calls this before any seat is reserved. The client supplies only
 * the opaque ticket; account identity is never read from join options.
 */
export async function authenticateRoomJoin(
  token: string,
): Promise<RoomIdentity> {
  const accountId = verifyMatchTicket(config.sessionSecret, token ?? "");
  if (!accountId) {
    metrics.authEvents.inc({ kind: "room_ticket", result: "rejected" });
    throw new ServerError(401, "Sign in again to play online.");
  }
  const account = await cardForgeStore.getAccount(accountId);
  if (!account || account.status !== "active") {
    metrics.authEvents.inc({ kind: "room_ticket", result: "inactive" });
    throw new ServerError(403, "This account cannot play right now.");
  }
  return { accountId: account.accountId, displayName: account.displayName };
}

export function identityOf(client: { auth?: unknown }): RoomIdentity {
  const auth = client.auth as RoomIdentity | undefined;
  if (!auth?.accountId) throw new ServerError(401, "Missing room identity.");
  return auth;
}
