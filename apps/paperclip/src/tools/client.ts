/**
 * Minimal MCP stdio client.
 *
 * The Model Context Protocol speaks JSON-RPC 2.0. For stdio transport,
 * each message is a single line of JSON terminated by `\n`. The
 * protocol's standard handshake is:
 *
 *   1. client → server   `initialize`        (request)
 *   2. server → client   <capabilities>      (response)
 *   3. client → server   `notifications/initialized`  (notification, no id)
 *   4. client → server   `tools/call`        (request)
 *   5. server → client   <call result>       (response)
 *
 * We spawn the tool's subprocess fresh for each invocation, run the
 * handshake + call, then kill the process. Stateless = simple. Future
 * optimization: pool long-running subprocesses for high-frequency tools.
 *
 * `spawn` is injectable for testing — pass a fake that returns a
 * controllable child-process-like object.
 */

import { spawn as nodeSpawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

type SpawnLike = (
  command: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; stdio: ["pipe", "pipe", "pipe"] },
) => ChildProcess;

export type InvokeStdioToolInput = {
  /** Full command line, e.g. "npx @modelcontextprotocol/server-fetch". */
  command: string;
  /** Tool name on the MCP server (server-side; may differ from our slug). */
  toolName: string;
  /** Arguments object passed to the tool. */
  arguments: Record<string, unknown>;
  /** Hard ceiling on the whole invocation; defaults to 30s. */
  timeoutMs?: number;
};

export type InvokeStdioToolResult = {
  output: unknown;
  is_error: boolean;
  latency_ms: number;
  error: string | null;
  /** Last 1KB of subprocess stderr; useful for debugging tool startup. */
  stderr_tail: string | null;
};

export type InvokeStdioToolDeps = {
  /** Override `spawn` for tests. */
  spawnImpl?: SpawnLike;
};

const STDERR_TAIL_BYTES = 1024;
const PROTOCOL_VERSION = "2024-11-05";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
};

export async function invokeStdioTool(
  input: InvokeStdioToolInput,
  deps: InvokeStdioToolDeps = {},
): Promise<InvokeStdioToolResult> {
  const start = Date.now();
  const timeoutMs = input.timeoutMs ?? 30_000;
  const spawnFn = deps.spawnImpl ?? (nodeSpawn as unknown as SpawnLike);

  const tokens = input.command.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return errorResult(start, "empty command");
  }
  const cmd = tokens[0]!;
  const args = tokens.slice(1);

  let proc: ChildProcess;
  try {
    proc = spawnFn(cmd, args, {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    return errorResult(start, `spawn failed: ${(err as Error).message}`);
  }

  // Line-buffered JSON parser + pending-request map.
  const stdout = proc.stdout!;
  const stdin = proc.stdin!;
  const stderr = proc.stderr!;

  let stdoutBuffer = "";
  let stderrBuffer = "";
  let nextId = 1;
  const pending = new Map<number, (msg: JsonRpcResponse) => void>();
  // The exit handler mutates this; TypeScript's flow analysis can't track
  // closure mutations through event emitters, so we annotate explicitly.
  let earlyExit: null | { code: number | null; signal: NodeJS.Signals | null } = null;
  const fatalRejecters = new Set<(err: Error) => void>();

  stdout.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString("utf8");
    let nlIdx: number;
    while ((nlIdx = stdoutBuffer.indexOf("\n")) !== -1) {
      const line = stdoutBuffer.slice(0, nlIdx).trim();
      stdoutBuffer = stdoutBuffer.slice(nlIdx + 1);
      if (!line) continue;
      let msg: JsonRpcResponse | null = null;
      try {
        msg = JSON.parse(line) as JsonRpcResponse;
      } catch {
        // Ignore non-JSON lines — some servers print banners on stdout
        // before the JSON-RPC stream starts. Spec violations, but common.
        continue;
      }
      if (msg && typeof msg.id === "number") {
        const resolver = pending.get(msg.id);
        if (resolver) {
          pending.delete(msg.id);
          resolver(msg);
        }
      }
    }
  });

  stderr.on("data", (chunk: Buffer) => {
    stderrBuffer += chunk.toString("utf8");
    if (stderrBuffer.length > STDERR_TAIL_BYTES * 4) {
      stderrBuffer = stderrBuffer.slice(-STDERR_TAIL_BYTES * 4);
    }
  });

  proc.on("exit", (code, signal) => {
    earlyExit = { code, signal };
    const err = new Error(
      `MCP subprocess exited (code=${code ?? "null"}, signal=${signal ?? "null"})`,
    );
    for (const reject of fatalRejecters) reject(err);
    fatalRejecters.clear();
  });
  proc.on("error", (err) => {
    for (const reject of fatalRejecters) reject(err);
    fatalRejecters.clear();
  });

  function sendRequest(method: string, params?: unknown): Promise<JsonRpcResponse> {
    const id = nextId++;
    const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      pending.set(id, resolve);
      fatalRejecters.add(reject);
      try {
        stdin.write(JSON.stringify(req) + "\n");
      } catch (err) {
        pending.delete(id);
        fatalRejecters.delete(reject);
        reject(err as Error);
      }
    });
  }

  function sendNotification(method: string, params?: unknown): void {
    try {
      stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
    } catch {
      // Notification write failure is non-fatal — the subsequent request's
      // pending promise will surface the broken pipe.
    }
  }

  const operation = (async (): Promise<JsonRpcResponse> => {
    // 1. initialize
    const initRes = await sendRequest("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "paperclip", version: "0.1.0" },
    });
    if (initRes.error) {
      throw new Error(`initialize failed: ${initRes.error.message}`);
    }
    // 2. initialized notification
    sendNotification("notifications/initialized");
    // 3. tools/call
    const callRes = await sendRequest("tools/call", {
      name: input.toolName,
      arguments: input.arguments,
    });
    return callRes;
  })();

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`tool call timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    const callRes = await Promise.race([operation, timeout]);
    if (callRes.error) {
      return finalize(start, {
        output: null,
        is_error: true,
        error: callRes.error.message,
        stderr_tail: tail(stderrBuffer),
      });
    }
    // MCP tool result shape: `{ content: [...], isError?: boolean }`
    const result = (callRes.result ?? {}) as { content?: unknown; isError?: boolean };
    return finalize(start, {
      output: result.content ?? callRes.result,
      is_error: Boolean(result.isError),
      error: null,
      stderr_tail: tail(stderrBuffer),
    });
  } catch (err) {
    const exit = earlyExit as null | { code: number | null; signal: NodeJS.Signals | null };
    return finalize(start, {
      output: null,
      is_error: true,
      error:
        exit && !(err instanceof Error && err.message.includes("subprocess exited"))
          ? `${(err as Error).message} (subprocess exited code=${exit.code})`
          : (err as Error).message,
      stderr_tail: tail(stderrBuffer),
    });
  } finally {
    if (timer) clearTimeout(timer);
    if (proc.exitCode === null) {
      try {
        proc.kill("SIGTERM");
      } catch {
        // ignore
      }
      // Force-kill after a grace period if SIGTERM didn't take.
      setTimeout(() => {
        if (proc.exitCode === null) {
          try {
            proc.kill("SIGKILL");
          } catch {
            // ignore
          }
        }
      }, 1_000).unref();
    }
  }
}

function tail(s: string): string | null {
  if (!s) return null;
  return s.length <= STDERR_TAIL_BYTES ? s : `…${s.slice(-STDERR_TAIL_BYTES)}`;
}

function errorResult(start: number, message: string): InvokeStdioToolResult {
  return {
    output: null,
    is_error: true,
    latency_ms: Date.now() - start,
    error: message,
    stderr_tail: null,
  };
}

function finalize(
  start: number,
  partial: Omit<InvokeStdioToolResult, "latency_ms">,
): InvokeStdioToolResult {
  return { ...partial, latency_ms: Date.now() - start };
}
