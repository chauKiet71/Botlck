import type { OwnerMode } from "./config.js";

export interface OwnerContext {
  agentId?: string;
  sessionKey?: string;
  requesterSenderId?: string;
  nativeChannelId?: string;
}

function required(value: string | undefined, fallback: string): string {
  const clean = value?.trim();
  return clean ? clean : fallback;
}

export function resolveOwnerKey(context: OwnerContext, mode: OwnerMode): string {
  const agent = required(context.agentId, "main");
  const session = required(context.sessionKey, `agent:${agent}:main`);
  const requester = required(context.requesterSenderId, session);
  const channel = required(context.nativeChannelId, "unknown-channel");

  switch (mode) {
    case "requester":
      return `requester:${requester}`;
    case "channel-requester":
      return `channel:${channel}:requester:${requester}`;
    case "session":
      return `session:${session}`;
    case "agent":
    default:
      return `agent:${agent}`;
  }
}
