// "What would happen" for an edited policy (issue K): core decide() with an injected clock on a sample invoice's
// real context, with only the policy swapped. Pure; decide() stays the authority at send time.
import { decide, type Action, type Ctx, type Policy } from "@dueloop/core";

export interface PreviewLine {
  invoiceNumber: string;
  outcome: string;
}

export function describeActions(actions: readonly Action[], timezone: string): string {
  if (actions.length === 0) return "nothing (no contact in this status, or every step is done)";
  return actions
    .map((a) => {
      switch (a.kind) {
        case "send_reminder":
          return `send step ${a.step.id} by ${a.step.channel} (template ${a.step.templateKey})`;
        case "wait_until":
          return `wait until ${a.at.toLocaleString("en-GB", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" })}`;
        case "mark_overdue":
          return "mark overdue";
        case "mark_promise_broken":
          return "mark the promise broken";
        case "escalate":
          return `escalate (${a.reason})`;
      }
    })
    .join("; ");
}

export function previewPolicy(base: Ctx, policy: Policy, now: Date): string {
  return describeActions(decide({ ...base, now, policy }), base.settings.timezone);
}
