/**
 * re:Invent demo — one-time setup (a single program, one stack).
 * ---------------------------------------------------------------------------
 * Deploy this once and the demo environment exists. It composes four local
 * components so the whole thing is one `pulumi up` on one stack:
 *
 *   ApproverTeam        the people who can approve the pipeline's prod gate
 *   GuardrailsPolicy    enables the guardrails pack on the app's stacks
 *   DatadogAlerting     the monitor on the email error + the agent webhook
 *   TroubleshooterAgent the custom agent (identity + least-privilege role +
 *                       instructions), which opens cloud-access/aws-access to
 *                       preview
 *
 * AWS credentials for every stack (and the agent's previews) come from the
 * existing cloud-access/aws-access ESC environment — no per-stage environments.
 *
 * This is staged setup, kept separate from the code that changes during the
 * demo (app/, components/, policies/). It does not deploy the app or the
 * pipeline — those are their own deploys (see the RUNBOOK).
 *
 * A few pieces are SaaS-only and can't be expressed here yet; they are called
 * out in the RUNBOOK and referenced by config:
 *   - the Datadog MCP integration + the agent's Datadog credentials
 *   - the Pulumi-side Datadog webhook automation (mints the trigger URL/secret)
 */
import * as cfg from "./config";
import { ApproverTeam } from "./components/approverTeam";
import { GuardrailsPolicy } from "./components/guardrailsPolicy";
import { DatadogAlerting } from "./components/datadogAlerting";
import { TroubleshooterAgent } from "./components/troubleshooterAgent";

const approvers = new ApproverTeam("reinvent-approvers");
const guardrails = new GuardrailsPolicy("reinvent-guardrails");
const alerting = new DatadogAlerting("reinvent-datadog");
const agent = new TroubleshooterAgent("reinvent-agent");

export const org = cfg.org;
export const agentId = agent.agentId;
export const approverTeam = approvers.teamName;
export const policyGroupName = guardrails.policyGroupName;
export const datadogMonitorId = alerting.monitorId;
export const datadogWebhookName = alerting.webhookName;
