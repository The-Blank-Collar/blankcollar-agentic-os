/**
 * Unit tests for the MCP stdio client (`apps/paperclip/src/tools/client.ts`).
 *
 * No real subprocess is spawned — we inject a fake `spawn` that returns
 * a controllable child-process-like object. The fake captures messages
 * written to stdin and lets us pump synthetic stdout/stderr/exit events.
 */

import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

import { invokeStdioTool } from "../src/tools/client.js";

class FakeStream extends EventEmitter {
  written: string[] = [];
  write(chunk: string): boolean {
    this.written.push(chunk);
    return true;
  }
  end(): void {
    /* no-op */
  }
}

class FakeChildProcess extends EventEmitter {
  stdin = new FakeStream();
  stdout = new FakeStream();
  stderr = new FakeStream();
  exitCode: number | null = null;
  killCalls: NodeJS.Signals[] = [];

  kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
    this.killCalls.push(signal);
    if (this.exitCode === null) {
      this.exitCode = 0;
      this.emit("exit", 0, signal);
    }
    return true;
  }

  /** Push one JSON-RPC line to stdout. */
  emitMessage(obj: unknown): void {
    this.stdout.emit("data", Buffer.from(JSON.stringify(obj) + "\n", "utf8"));
  }
}

/** Returns the JSON-RPC requests written to stdin so far. */
function parseSentRequests(child: FakeChildProcess): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const chunk of child.stdin.written) {
    for (const line of chunk.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as Record<string, unknown>);
      } catch {
        // ignore garbage
      }
    }
  }
  return out;
}

/**
 * Drives the JSON-RPC handshake the client expects: respond to
 * `initialize` then to `tools/call`. Returns an awaitable that resolves
 * once both responses are emitted.
 */
function autoRespond(
  child: FakeChildProcess,
  toolResult: unknown,
  options: { isError?: boolean; failInitialize?: boolean } = {},
): void {
  // Track which method ids we've already responded to so re-polling doesn't
  // double-send. We do this on a per-call closure since each test gets a
  // fresh child.
  const responded = new Set<string>();
  const tick = setInterval(() => {
    const reqs = parseSentRequests(child);
    for (const r of reqs) {
      const key = `${String(r.method)}:${String(r.id)}`;
      if (responded.has(key)) continue;
      if (r.method === "initialize") {
        responded.add(key);
        if (options.failInitialize) {
          child.emitMessage({
            jsonrpc: "2.0",
            id: r.id,
            error: { code: -32603, message: "init failed" },
          });
        } else {
          child.emitMessage({
            jsonrpc: "2.0",
            id: r.id,
            result: { protocolVersion: "2024-11-05", capabilities: {} },
          });
        }
      }
      if (r.method === "tools/call") {
        responded.add(key);
        child.emitMessage({
          jsonrpc: "2.0",
          id: r.id,
          result: { content: toolResult, isError: Boolean(options.isError) },
        });
        clearInterval(tick);
      }
    }
  }, 1);
  // Cap the polling so a stuck test doesn't hang the suite.
  const cap = setTimeout(() => clearInterval(tick), 5_000);
  if (typeof cap.unref === "function") cap.unref();
}

type FakeSpawn = (cmd: string, args: readonly string[]) => FakeChildProcess;

function withFakeSpawn(
  setup: (child: FakeChildProcess) => void,
): { spawnImpl: FakeSpawn; child: FakeChildProcess; commandSeen: { cmd?: string; args?: string[] } } {
  const child = new FakeChildProcess();
  const commandSeen: { cmd?: string; args?: string[] } = {};
  const spawnImpl: FakeSpawn = (cmd, args) => {
    commandSeen.cmd = cmd;
    commandSeen.args = [...args];
    queueMicrotask(() => setup(child));
    return child;
  };
  return { spawnImpl, child, commandSeen };
}

describe("invokeStdioTool", () => {
  it("does the initialize → tools/call handshake and returns the content", async () => {
    const { spawnImpl, child, commandSeen } = withFakeSpawn((c) => autoRespond(c, [{ type: "text", text: "hello" }]));

    const out = await invokeStdioTool(
      { command: "fake-server arg1", toolName: "fetch", arguments: { url: "x" } },
      { spawnImpl },
    );

    expect(commandSeen.cmd).toBe("fake-server");
    expect(commandSeen.args).toEqual(["arg1"]);
    expect(out.is_error).toBe(false);
    expect(out.error).toBeNull();
    expect(out.output).toEqual([{ type: "text", text: "hello" }]);
    expect(out.latency_ms).toBeGreaterThanOrEqual(0);

    const reqs = parseSentRequests(child);
    expect(reqs.find((r) => r.method === "initialize")).toBeDefined();
    expect(reqs.find((r) => r.method === "notifications/initialized")).toBeDefined();
    const callReq = reqs.find((r) => r.method === "tools/call");
    expect(callReq).toBeDefined();
    expect((callReq?.params as { name: string }).name).toBe("fetch");
    expect((callReq?.params as { arguments: Record<string, unknown> }).arguments).toEqual({ url: "x" });
  });

  it("kills the subprocess after a successful call", async () => {
    const { spawnImpl, child } = withFakeSpawn((c) => autoRespond(c, "ok"));
    await invokeStdioTool(
      { command: "fake", toolName: "t", arguments: {} },
      { spawnImpl },
    );
    expect(child.killCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("returns is_error=true when the tool's result has isError", async () => {
    const { spawnImpl } = withFakeSpawn((c) =>
      autoRespond(c, [{ type: "text", text: "bad input" }], { isError: true }),
    );
    const out = await invokeStdioTool(
      { command: "fake", toolName: "t", arguments: {} },
      { spawnImpl },
    );
    expect(out.is_error).toBe(true);
    expect(out.output).toEqual([{ type: "text", text: "bad input" }]);
  });

  it("surfaces an initialize error as is_error with the upstream message", async () => {
    const { spawnImpl } = withFakeSpawn((c) =>
      autoRespond(c, "n/a", { failInitialize: true }),
    );
    const out = await invokeStdioTool(
      { command: "fake", toolName: "t", arguments: {} },
      { spawnImpl },
    );
    expect(out.is_error).toBe(true);
    expect(out.error).toContain("init failed");
  });

  it("times out when the subprocess never responds", async () => {
    const { spawnImpl, child } = withFakeSpawn(() => {
      // never respond
    });
    const out = await invokeStdioTool(
      {
        command: "fake",
        toolName: "t",
        arguments: {},
        timeoutMs: 50,
      },
      { spawnImpl },
    );
    expect(out.is_error).toBe(true);
    expect(out.error).toContain("timeout");
    expect(child.killCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("surfaces an early subprocess exit", async () => {
    const { spawnImpl } = withFakeSpawn((c) => {
      // Simulate a server that exits before responding to initialize.
      setTimeout(() => {
        c.exitCode = 1;
        c.emit("exit", 1, null);
      }, 5);
    });
    const out = await invokeStdioTool(
      { command: "broken", toolName: "t", arguments: {}, timeoutMs: 1_000 },
      { spawnImpl },
    );
    expect(out.is_error).toBe(true);
    expect(out.error).toContain("exited");
  });

  it("captures stderr and returns the tail", async () => {
    const { spawnImpl, child } = withFakeSpawn((c) => {
      c.stderr.emit("data", Buffer.from("warning: noisy startup\n", "utf8"));
      autoRespond(c, "ok");
    });
    const out = await invokeStdioTool(
      { command: "fake", toolName: "t", arguments: {} },
      { spawnImpl },
    );
    expect(child.stdin.written.length).toBeGreaterThan(0);
    expect(out.stderr_tail).toContain("warning: noisy startup");
  });

  it("ignores non-JSON noise on stdout", async () => {
    const { spawnImpl } = withFakeSpawn((c) => {
      c.stdout.emit("data", Buffer.from("server starting...\n", "utf8"));
      autoRespond(c, "ok");
    });
    const out = await invokeStdioTool(
      { command: "fake", toolName: "t", arguments: {} },
      { spawnImpl },
    );
    expect(out.is_error).toBe(false);
    expect(out.output).toBe("ok");
  });

  it("returns an immediate error on empty command", async () => {
    const out = await invokeStdioTool(
      { command: "   ", toolName: "t", arguments: {} },
      // No spawnImpl needed — empty command short-circuits before spawn.
    );
    expect(out.is_error).toBe(true);
    expect(out.error).toContain("empty command");
  });
});
