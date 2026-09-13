import { describe, it, expect } from "vitest";
import { parseMessage, ProtocolError } from "../../packages/protocol/src/serializer";

// Covers context.md risk #22 ("protocol has no real versioning"). Re-checked
// during the 2026-09-12 Hub audit and found already implemented — this test
// locks that behavior in so a future regression is caught, since nothing
// previously verified it. See decision.md, 2026-09-12, "protocol versioning
// already enforced".
describe("parseMessage — protocol version enforcement", () => {
  it("accepts a message with the current protocol version", () => {
    const msg = parseMessage(JSON.stringify({ v: "1", type: "hub:ping", ts: Date.now() }));
    expect(msg.type).toBe("hub:ping");
  });

  it("rejects a message with a mismatched protocol version", () => {
    expect(() =>
      parseMessage(JSON.stringify({ v: "2", type: "hub:ping", ts: Date.now() })),
    ).toThrow(ProtocolError);
  });

  it("rejects a message missing the version field entirely", () => {
    expect(() => parseMessage(JSON.stringify({ type: "hub:ping", ts: Date.now() }))).toThrow(
      ProtocolError,
    );
  });

  it("rejects malformed JSON", () => {
    expect(() => parseMessage("not json")).toThrow(ProtocolError);
  });
});
