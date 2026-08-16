import { randomBytes } from "node:crypto";
import { Room, type Client } from "@colyseus/core";
import { AuthoritativeMatchSession, SessionError } from "./session.js";

function serverSeed(): number {
  return randomBytes(4).readUInt32LE(0);
}

export class TempoFrontRoom extends Room {
  override maxClients = 2;
  #match!: AuthoritativeMatchSession;

  override messages = {
    ready: (client: Client) => {
      client.send("seat", { seat: this.#match.seatFor(client.sessionId) });
      client.send("snapshot", this.#match.snapshot(client.sessionId));
    },
    command: (client: Client, payload: unknown) => {
      try {
        const events = this.#match.submit(client.sessionId, payload);
        for (const recipient of this.clients)
          recipient.send(
            "snapshot",
            this.#match.snapshot(recipient.sessionId, events),
          );
      } catch (error) {
        if (error instanceof SessionError) {
          client.send("command_error", {
            code: error.code,
            message: error.message,
          });
          return;
        }
        throw error;
      }
    },
  };

  override onCreate(): void {
    this.#match = new AuthoritativeMatchSession({
      matchId: this.roomId,
      seed: serverSeed(),
    });
  }

  override async onJoin(client: Client): Promise<void> {
    this.#match.join(client.sessionId);
    if (this.clients.length >= this.maxClients) await this.lock();
  }

  override async onDrop(client: Client): Promise<void> {
    await this.allowReconnection(client, 30);
  }

  override onReconnect(client: Client): void {
    client.send("snapshot", this.#match.snapshot(client.sessionId));
  }
}
