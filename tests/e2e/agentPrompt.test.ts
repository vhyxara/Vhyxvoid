import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { createPrompter, type PromptInput } from "../../packages/agent/src/prompt";

// The interactive half of the `vhyxvoid init` fix (see agentInitCommand.test.ts
// for the process-level regression). A fake terminal stands in for a TTY:
// keystrokes are emitted as `data` events and every pause/resume/raw-mode call
// is recorded. The original bug was stdin being left paused between prompts, so
// the assertions that matter most are "each prompt resumes stdin" and "the
// wizard can ask several questions in a row".

class FakeTty extends EventEmitter {
  isTTY = true;
  raw: boolean[] = [];
  resume = vi.fn();
  pause = vi.fn();
  setEncoding = vi.fn();
  setRawMode(mode: boolean) {
    this.raw.push(mode);
  }
  [Symbol.asyncIterator](): AsyncIterator<string | Buffer> {
    throw new Error("a TTY prompt must not read stdin as a stream");
  }
  type(text: string) {
    this.emit("data", text);
  }
}

function setup() {
  const input = new FakeTty();
  const out: string[] = [];
  const onInterrupt = vi.fn();
  const prompter = createPrompter(input as unknown as PromptInput, { write: (s) => out.push(s) }, onInterrupt);
  return { input, out, onInterrupt, prompter, screen: () => out.join("") };
}

describe("createPrompter — TTY", () => {
  it("returns what was typed, honours backspace, and echoes the characters", async () => {
    const { input, prompter, screen } = setup();
    const answer = prompter.ask("Label");

    input.type("abc");
    input.type("\u007f");
    input.type("d\r");

    expect(await answer).toBe("abd");
    expect(screen()).toContain("Label: ");
    expect(screen()).toContain("abc\b \bd");
  });

  it("echoes * for a secret, never the characters, and ignores any default", async () => {
    const { input, prompter, screen } = setup();
    const answer = prompter.askSecret("API key secret");

    input.type("hunter2\r");

    expect(await answer).toBe("hunter2");
    expect(screen()).not.toContain("hunter2");
    expect(screen()).toContain("*******");
  });

  it("falls back to the default on a blank answer and shows it in the prompt", async () => {
    const { input, prompter, screen } = setup();
    const answer = prompter.ask("Port", "3000");

    input.type("\r");

    expect(await answer).toBe("3000");
    expect(screen()).toContain("Port (3000): ");
  });

  it("resumes stdin for every prompt, so several questions in a row all get answered", async () => {
    const { input, prompter } = setup();

    const first = prompter.ask("one");
    input.type("1\r");
    await first;
    expect(input.pause).toHaveBeenCalledTimes(1); // released between prompts...

    const second = prompter.askSecret("two");
    input.type("2\r");
    await second;

    const third = prompter.ask("three");
    input.type("3\r");
    expect(await third).toBe("3");

    // ...and taken back for each one. Never leaves the terminal in raw mode.
    expect(input.resume).toHaveBeenCalledTimes(3);
    expect(input.raw).toEqual([true, false, true, false, true, false]);
  });

  it("hands the terminal back and calls onInterrupt on Ctrl-C", async () => {
    const { input, prompter, onInterrupt } = setup();

    void prompter.ask("Label");
    input.type("\u0003");

    expect(onInterrupt).toHaveBeenCalledTimes(1);
    expect(input.raw).toEqual([true, false]);
  });

  it("ignores arrow-key escape sequences instead of typing them in", async () => {
    const { input, prompter } = setup();
    const answer = prompter.ask("Label");

    input.type("ab\u001b[A");
    input.type("c\r");

    expect(await answer).toBe("abc");
  });
});

describe("createPrompter — piped input", () => {
  function piped(text: string) {
    const stream = Readable.from([text]) as unknown as PromptInput;
    const out: string[] = [];
    return { prompter: createPrompter(stream, { write: (s) => out.push(s) }), out };
  }

  it("answers successive prompts from successive lines of one stream", async () => {
    const { prompter } = piped("key\nsecret\n\nlast\n");

    expect(await prompter.ask("a")).toBe("key");
    expect(await prompter.askSecret("b")).toBe("secret");
    expect(await prompter.ask("c", "dflt")).toBe("dflt"); // blank line -> default
    expect(await prompter.ask("d")).toBe("last");
  });

  it("returns blank answers once the input runs out instead of hanging", async () => {
    const { prompter } = piped("only\n");

    expect(await prompter.ask("a")).toBe("only");
    expect(await prompter.ask("b", "fallback")).toBe("fallback");
  });
});
