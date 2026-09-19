// Minimal interactive prompts for `vhyxvoid init`.
//
// Why not `readline`: the wizard previously opened a second readline interface
// on process.stdin to mask the secret and then closed it. Closing an interface
// pauses its input stream, and the first interface's next question() does not
// resume a paused stdin, so the event loop emptied and the process exited with
// status 0 in the middle of the wizard, having written nothing (Node 24).
// One reader that owns stdin for the whole wizard has no such hand-off.
//
// - TTY: raw mode, one keystroke at a time. Echoes characters (or `*` for a
//   secret), handles backspace, Enter and Ctrl-C.
// - Not a TTY (piped or redirected input): stdin is read to the end once and
//   handed out a line per prompt, so `printf 'a\nb\n' | vhyxvoid init` works.
//
// The streams are injectable so the TTY path can be tested without a terminal.

export interface PromptInput extends NodeJS.EventEmitter {
  isTTY?: boolean;
  setRawMode?(mode: boolean): unknown;
  resume(): unknown;
  pause(): unknown;
  setEncoding?(encoding: BufferEncoding): unknown;
  [Symbol.asyncIterator](): AsyncIterator<string | Buffer>;
}

export interface PromptOutput {
  write(chunk: string): unknown;
}

export interface Prompter {
  /** Ask one question. A blank answer falls back to `def`. */
  ask(question: string, def?: string): Promise<string>;
  /** Like ask, but echoes `*` and never shows a default. */
  askSecret(question: string): Promise<string>;
  /** Release stdin so the process can exit. */
  close(): void;
}

export function createPrompter(
  input: PromptInput = process.stdin as unknown as PromptInput,
  output: PromptOutput = process.stdout,
  onInterrupt: () => void = () => process.exit(130),
): Prompter {
  const tty = input.isTTY === true && typeof input.setRawMode === "function";
  let pipedLines: string[] | null = null;

  async function nextPipedLine(): Promise<string> {
    if (pipedLines === null) {
      let text = "";
      for await (const chunk of input) text += chunk.toString();
      pipedLines = text.split(/\r?\n/);
    }
    return pipedLines.shift() ?? "";
  }

  function readTty(secret: boolean): Promise<string> {
    return new Promise((resolve) => {
      let buffer = "";

      const finish = (value: string) => {
        input.removeListener("data", onData);
        input.setRawMode?.(false);
        input.pause();
        output.write("\n");
        resolve(value);
      };

      const onData = (data: string | Buffer) => {
        for (const ch of data.toString()) {
          if (ch === "\r" || ch === "\n") return finish(buffer);

          if (ch === "\u0003") {
            input.removeListener("data", onData);
            input.setRawMode?.(false);
            output.write("\n");
            return onInterrupt();
          }

          if (ch === "\u001b") return; // arrow keys and other escape sequences: ignore the rest of the chunk

          if (ch === "\u007f" || ch === "\b") {
            if (buffer.length > 0) {
              buffer = buffer.slice(0, -1);
              output.write("\b \b");
            }
          } else if (ch >= " ") {
            buffer += ch;
            output.write(secret ? "*" : ch);
          }
        }
      };

      input.setRawMode?.(true);
      input.resume();
      input.setEncoding?.("utf8");
      input.on("data", onData);
    });
  }

  async function read(prompt: string, secret: boolean): Promise<string> {
    output.write(prompt);

    if (tty) return readTty(secret);

    const line = await nextPipedLine();

    output.write("\n");

    return line;
  }

  return {
    async ask(question, def) {
      const answer = await read(def ? `${question} (${def}): ` : `${question}: `, false);

      return answer.trim() || def || "";
    },
    async askSecret(question) {
      return (await read(`${question}: `, true)).trim();
    },
    close() {
      input.pause();
    }
  };
}
