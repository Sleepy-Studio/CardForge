import { InviteError, type InviteRecord } from "./types.js";

/**
 * Pure admission rule shared by every store adapter. Returns the same object
 * when nothing changes, or the updated record when a guest claims the seat.
 * The host may re-enter; exactly one other account may become the guest.
 */
export function admitInvite(
  invite: InviteRecord | null,
  accountId: string,
  nowMs: number,
): InviteRecord {
  if (!invite || invite.status === "cancelled")
    throw new InviteError("INVITE_NOT_FOUND");
  if (invite.hostAccountId === accountId) {
    if (invite.status === "started") throw new InviteError("INVITE_USED");
    if (Date.parse(invite.expiresAt) <= nowMs)
      throw new InviteError("INVITE_EXPIRED");
    return invite;
  }
  if (invite.guestAccountId === accountId && invite.status !== "started")
    return invite;
  if (invite.guestAccountId !== null || invite.status !== "open")
    throw new InviteError("INVITE_USED");
  if (Date.parse(invite.expiresAt) <= nowMs)
    throw new InviteError("INVITE_EXPIRED");
  return { ...invite, guestAccountId: accountId, status: "claimed" };
}
