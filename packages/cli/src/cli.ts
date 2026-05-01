#!/usr/bin/env node
/**
 * bc — Blank Collar CLI entry.
 *
 * Each subcommand is a function; we dispatch via a flat switch. No
 * third-party CLI framework so the binary stays tiny and the boot time
 * stays imperceptible.
 */

import { ApiError, Client } from "./api.js";
import { parseArgv } from "./argv.js";
import { runAgentGet, runAgentsList } from "./commands/agents.js";
import { runApprovalResolve, runApprovalsList } from "./commands/approvals.js";
import { runAudit, runLevelUp } from "./commands/audit.js";
import { runBrain } from "./commands/brain.js";
import { runBriefing } from "./commands/briefing.js";
import { runCapture } from "./commands/capture.js";
import { runChannels } from "./commands/channels.js";
import { runDepartments } from "./commands/depts.js";
import { runGoalStatus } from "./commands/goal-status.js";
import { runGoalGet, runGoalResolve, runGoalsList } from "./commands/goals.js";
import { runHealth } from "./commands/health.js";
import { runHeartbeat } from "./commands/heartbeat.js";
import { runKrAdd, runKrList, runKrRm, runKrSet } from "./commands/kr.js";
import { runLogs } from "./commands/logs.js";
import { runHelp } from "./commands/help.js";
import { runInboxAck, runInboxList } from "./commands/inbox.js";
import { runKnowledgeGet, runKnowledgeList } from "./commands/knowledge.js";
import { runOnboard } from "./commands/onboard.js";
import { runRoutinesList, runTriggerFire, runTriggersList } from "./commands/routines.js";
import { runRunGet, runRunsList } from "./commands/runs.js";
import { runSearch } from "./commands/search.js";
import { runSkillInvoke, runSkills } from "./commands/skills.js";
import { runTail } from "./commands/tail.js";
import { runWhoami } from "./commands/whoami.js";
import { emitError } from "./format.js";

export async function main(argv: string[], clientOverride?: Client): Promise<number> {
  const args = parseArgv(argv);
  if (!args.subcommand || args.flags.help || args.subcommand === "help") {
    return runHelp();
  }

  const client = clientOverride ?? new Client();

  try {
    switch (args.subcommand) {
      case "health":
        return await runHealth(args, client);
      case "capture":
        return await runCapture(args, client);

      case "inbox": {
        if (args.positional[0] === "ack") {
          // Drop the leading "ack" so the goal_id is at positional[0].
          const sub = { ...args, positional: args.positional.slice(1) };
          return await runInboxAck(sub, client);
        }
        return await runInboxList(args, client);
      }

      case "goals":
        return await runGoalsList(args, client);
      case "goal":
        return await runGoalGet(args, client);
      case "close":
      case "pause":
      case "resume":
      case "archive":
        return await runGoalStatus(args, client);

      case "kr": {
        const verb = args.positional[0];
        const sub = { ...args, positional: args.positional.slice(1) };
        if (verb === "add")  return await runKrAdd(sub, client);
        if (verb === "set")  return await runKrSet(sub, client);
        if (verb === "rm" || verb === "remove") return await runKrRm(sub, client);
        if (verb === "list" || verb === undefined) return await runKrList(sub, client);
        process.stderr.write(`unknown kr verb: ${verb}\n`);
        process.stderr.write("usage: bc kr (list|add|set|rm) <args>\n");
        return 2;
      }
      case "approve":
      case "decline": {
        // For decision goals: bc approve <goal_id>; for approvals queue:
        // bc approval approve <id>. Disambiguate by length of id (uuids
        // are 36 chars). v0: assume goal_id when called as top-level.
        return await runGoalResolve(args, client);
      }

      case "briefing":
        return await runBriefing(args, client);

      case "agents":
        return await runAgentsList(args, client);
      case "agent":
        return await runAgentGet(args, client);

      case "skills":
        return await runSkills(args, client);
      case "skill": {
        if (args.positional[0] === "invoke") {
          const sub = { ...args, positional: args.positional.slice(1) };
          return await runSkillInvoke(sub, client);
        }
        process.stderr.write("usage: bc skill invoke <slug> [--input.x=y ...]\n");
        return 2;
      }

      case "audit":
        return await runAudit(args, client);
      case "level-up":
      case "levelup":
        return await runLevelUp(args, client);

      case "approvals":
        return await runApprovalsList(args, client);
      case "approval": {
        const verb = args.positional[0];
        if (verb === "approve" || verb === "decline") {
          const sub = {
            ...args,
            subcommand: verb,
            positional: args.positional.slice(1),
          };
          return await runApprovalResolve(sub, client);
        }
        process.stderr.write("usage: bc approval (approve|decline) <id> [note]\n");
        return 2;
      }

      case "knowledge": {
        if (args.positional[0] === "get") {
          const sub = { ...args, positional: args.positional.slice(1) };
          return await runKnowledgeGet(sub, client);
        }
        return await runKnowledgeList(args, client);
      }

      case "brain":
        return await runBrain(args, client);

      case "channels":
        return await runChannels(args, client);
      case "depts":
      case "departments":
        return await runDepartments(args, client);

      case "runs":
        return await runRunsList(args, client);
      case "run":
        return await runRunGet(args, client);

      case "routines":
        return await runRoutinesList(args, client);
      case "triggers":
        return await runTriggersList(args, client);
      case "fire":
        return await runTriggerFire(args, client);

      case "search":
        return await runSearch(args, client);
      case "tail":
        return await runTail(args, client);
      case "heartbeat":
        return await runHeartbeat(args, client);
      case "logs":
        return await runLogs(args, client);
      case "whoami":
        return await runWhoami(args, client);

      case "onboard":
        return await runOnboard(args, client);

      default:
        process.stderr.write(`unknown command: ${args.subcommand}\n`);
        runHelp();
        return 2;
    }
  } catch (err) {
    if (err instanceof ApiError) {
      emitError(err);
      if (process.env.BC_DEBUG) process.stderr.write(`\n${JSON.stringify(err.body, null, 2)}\n`);
      return Math.max(1, Math.min(err.status, 99));
    }
    emitError(err);
    return 1;
  }
}

// Run when invoked directly (not when imported by tests).
const isDirect = process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href;
if (isDirect) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
