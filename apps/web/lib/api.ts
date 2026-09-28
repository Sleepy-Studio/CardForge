"use client";

import { useMemo } from "react";
import { useRuntimeConfig } from "./runtime-config";

/** Error raised for any non-2xx API response, with a player-safe message. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const friendly: Record<string, string> = {
  AUTHENTICATION_REQUIRED: "Please sign in to continue.",
  INVALID_CREDENTIALS: "That email and password do not match.",
  EMAIL_TAKEN: "An account with that email already exists.",
  SIGNUP_CODE_REQUIRED:
    "CardForge is in closed alpha. Enter your invite code to register.",
  CLAIM_INVALID: "That claim code is invalid or has expired.",
  ACCOUNT_HAS_CREDENTIAL: "That account already has a sign-in method.",
  RATE_LIMITED: "Too many attempts. Please wait a minute and try again.",
  ILLEGAL_DECK: "This deck is not legal yet.",
  DECK_LIMIT_REACHED:
    "You have reached the deck limit. Delete a deck to make room.",
  INSUFFICIENT_FUNDS: "You do not have enough currency for that.",
  CRAFTING_DISABLED: "Crafting is temporarily unavailable.",
  STARTER_ALREADY_CHOSEN: "You have already chosen a starter.",
  INVITE_NOT_FOUND: "That invite does not exist or was cancelled.",
  QUEST_INCOMPLETE: "That quest is not complete yet.",
  QUEST_ALREADY_CLAIMED: "You have already claimed that reward.",
  REPLAY_NOT_FOUND: "That replay is not available.",
  MATCH_IN_PROGRESS: "This match is still being played.",
  INTERNAL_ERROR: "Something went wrong on our side. Please try again.",
};

export function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof TypeError)
    return "Cannot reach the CardForge servers. Check your connection.";
  return error instanceof Error ? error.message : "Something went wrong.";
}

export type ApiFetch = <T>(
  path: string,
  init?: {
    readonly method?: string;
    readonly body?: unknown;
    readonly signal?: AbortSignal;
  },
) => Promise<T>;

export function createApi(apiUrl: string): ApiFetch {
  return async <T>(
    path: string,
    init: {
      readonly method?: string;
      readonly body?: unknown;
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<T> => {
    const response = await fetch(`${apiUrl}${path}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      credentials: "include",
      headers:
        init.body === undefined ? {} : { "content-type": "application/json" },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      ...(init.signal ? { signal: init.signal } : {}),
    });
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    let payload: Record<string, unknown> = {};
    try {
      payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      payload = {};
    }
    if (!response.ok) {
      const code =
        typeof payload.error === "string"
          ? payload.error
          : `HTTP_${response.status}`;
      const message =
        (typeof payload.message === "string" && payload.message) ||
        friendly[code] ||
        "Request failed.";
      throw new ApiError(
        response.status,
        code,
        message,
        payload.details ?? payload.issues,
      );
    }
    return payload as T;
  };
}

export function useApi(): ApiFetch {
  const { apiUrl } = useRuntimeConfig();
  return useMemo(() => createApi(apiUrl), [apiUrl]);
}
