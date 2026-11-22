/**
 * re:Invent demo — one-time setup.
 * ---------------------------------------------------------------------------
 * Deploy this once and the demo environment exists: the guardrails policy group,
 * the Datadog monitor and agent webhook, the custom agent (identity + role +
 * instructions), and the approver group. AWS credentials for every stack come
 * from the existing cloud-access/aws-access ESC environment.
 *
 * This is staged setup, kept separate from the code that changes during the
 * demo (app/, components/, policies/). It does not deploy the app or the
 * pipeline — those are their own `pulumi up`s (see the RUNBOOK).
 *
 * A few pieces are SaaS-only and can't be expressed here yet; they are called
 * out in the RUNBOOK and referenced by config:
 *   - the Datadog MCP integration + the agent's Datadog credentials
 *   - the Pulumi-side Datadog webhook automation (mints the trigger URL/secret)
 */
import * as cfg from "./config";
import { createAgent } from "./agent";
import { createDatadog } from "./datadog";
import { enablePolicyPack } from "./policy";
import { createApproverTeam } from "./approvers";

// The approver group referenced by the pipeline's prod gate.
const approvers = createApproverTeam();

// The guardrails policy pack, enabled on the app's dev/staging/prod stacks.
const policyGroup = enablePolicyPack();

// Datadog monitor on the email error + the webhook that triggers the agent.
const { monitor, webhook } = createDatadog();

// The custom agent. It opens cloud-access/aws-access to run previews.
const agent = createAgent();

export const agentId = agent.definitionID;
export const approverTeam = approvers.name;
export const policyGroupName = policyGroup.name;
export const datadogMonitorId = monitor.id;
export const datadogWebhookName = webhook.name;
export const org = cfg.org;
