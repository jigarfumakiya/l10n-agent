import { createHash } from "node:crypto";
import { type Message, messageValues } from "./model.js";

/** Stable short hash of a message, used by the lockfile to notice changes. */
export function hashMessage(message: Message): string {
  const canonical = JSON.stringify([message.kind, messageValues(message)]);
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}
