/**
 * Tiny argv parser. No third-party dep.
 *
 * Supports:
 *   bc <subcmd> [<positional>...] [--flag] [--key=value] [--key value]
 *
 * `--` ends flag parsing; everything after is positional. Unknown flags
 * are accepted (the command handler decides what to reject).
 */

export type ParsedArgs = {
  subcommand: string | null;
  positional: string[];
  flags: Record<string, string | true>;
};

export function parseArgv(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { subcommand: null, positional: [], flags: {} };
  let i = 0;
  let endOfFlags = false;
  let consumedSubcommand = false;
  while (i < argv.length) {
    const tok = argv[i]!;
    if (!endOfFlags && tok === "--") {
      endOfFlags = true;
      i++;
      continue;
    }
    if (!endOfFlags && tok.startsWith("--")) {
      const eq = tok.indexOf("=");
      if (eq !== -1) {
        const key = tok.slice(2, eq);
        const value = tok.slice(eq + 1);
        out.flags[key] = value;
      } else {
        const key = tok.slice(2);
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          out.flags[key] = next;
          i++;
        } else {
          out.flags[key] = true;
        }
      }
      i++;
      continue;
    }
    if (!consumedSubcommand && !tok.startsWith("--")) {
      out.subcommand = tok;
      consumedSubcommand = true;
      i++;
      continue;
    }
    out.positional.push(tok);
    i++;
  }
  return out;
}

/** Coerces a flag to string, or returns the default. */
export function flagString(flags: ParsedArgs["flags"], key: string, fallback: string): string {
  const v = flags[key];
  return typeof v === "string" ? v : fallback;
}

/** Coerces a flag to boolean (presence = true). */
export function flagBool(flags: ParsedArgs["flags"], key: string): boolean {
  return Boolean(flags[key]);
}

/** Coerces to integer or returns the default. */
export function flagInt(flags: ParsedArgs["flags"], key: string, fallback: number): number {
  const v = flags[key];
  if (typeof v !== "string") return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}
