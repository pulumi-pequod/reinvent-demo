/**
 * re:Invent demo — one-time setup.
 * ---------------------------------------------------------------------------
 * Deploy this once and the demo environment exists: per-stage ESC environments
 * with AWS OIDC and approvals, the guardrails policy group, the Datadog monitor
 * and agent webhook, the custom agent (identity + role + instructions), and the
 * approver group.
 *
 * This is staged setup, kept separate from the code that changes during the
 * demo (app/, components/, policies/). It does not deploy the app or the
 * pipeline — those are their own `pulumi up`s (see the RUNBOOK).
 *
 * A few pieces are SaaS-only and can't be expressed here yet; they are called
 * out in the RUNBOOK and referenced by config:
 *   - the Datadog MCP integration + the agent's Datadog credentials
 *   - the Pulumi-side Datadog webhook automation (mints the trigger URL/secret)
 *   - gating credential *opens* (vs. updates) on staging/prod
 */
import * as cfg from "./config";
import { createEnvironments } from "./esc";
import { createAgent } from "./agent";
import { createDatadog } from "./datadog";
import { enablePolicyPack } from "./policy";
import { createApproverTeam } from "./approvers";

// Per-stage ESC environments (+ approval rules on staging/prod).
const envs = createEnvironments();

// The approver group referenced by the pipeline and the ESC approval rules.
const approvers = createApproverTeam();

// The guardrails policy pack, enabled on the app's dev/staging/prod stacks.
const policyGroup = enablePolicyPack();

// Datadog monitor on the email error + the webhook that triggers the agent.
const { monitor, webhook } = createDatadog();

// The custom agent. It opens the dev ESC environment to run previews.
const agent = createAgent(envs.dev);

export const devEnvironmentId = envs.dev.environmentId;
export const stagingEnvironmentId = envs.staging.environmentId;
export const prodEnvironmentId = envs.prod.environmentId;
export const agentId = agent.definitionID;
export const approverTeam = approvers.name;
export const policyGroupName = policyGroup.name;
export const datadogMonitorId = monitor.id;
export const datadogWebhookName = webhook.name;
export const org = cfg.org;
