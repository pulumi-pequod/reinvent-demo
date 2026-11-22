/**
 * TroubleshooterAgent — the custom Pulumi Agent that investigates app errors,
 * declared as a local component (its own identity, a least-privilege role, and
 * its instructions, grouped under one parent). Its instructions are general:
 * work from the logs to the root cause, and when the cause is architectural,
 * reuse an approved registry component and open a PR. The demo's broken app,
 * published components, and policy pack steer it to the specific fix — the
 * instructions don't hard-code the scenario.
 *
 * The role lets it read stacks and their history, search resources, and open the
 * AWS-access environment the app stacks use (cloud-access/aws-access) so it can
 * run a `pulumi preview` — but it cannot deploy and it cannot approve. Opening an
 * environment is not deploying: without stack:write the role still cannot run
 * `pulumi up`.
 *
 * What is NOT code (SaaS-only, see the RUNBOOK):
 *   - the Datadog MCP integration and the agent's Datadog/cloud credentials
 *     (the webhook only delivers the event; the agent needs its own read access
 *     to Datadog to investigate). Once created, set `datadogIntegrationId` in
 *     config and it is enabled on the agent below.
 *   - the Datadog webhook trigger / automation that starts the agent. The
 *     Datadog webhook trigger is SaaS-only, so it is created in the console.
 */
import * as pulumi from "@pulumi/pulumi";
import * as ps from "@pulumi/pulumiservice";
import * as cfg from "../config";

const INSTRUCTIONS = [
    "You are an app troubleshooter. A Datadog monitor caught an error in an application and triggered you via webhook. Your job is to find the real source of the problem and, when it is something infrastructure can fix, propose that fix as a pull request.",
    "",
    "Do NOT deploy: never run `pulumi up`, `refresh`, or `destroy`, and never approve anything. A person merges your PR and the delivery pipeline ships it.",
    "",
    "1. Read the alert, then work through the application's logs to get to the source of the problem. Read the failing stack's recent updates and the app's Pulumi program and handler code (in `app/` of pulumi-pequod/reinvent-demo) to confirm the root cause.",
    "2. Decide whether the cause is architectural — missing infrastructure, a missing permission, or misconfiguration that the application code alone can't resolve — rather than a transient or purely code-level issue. Only make an infrastructure change when the cause is architectural.",
    "3. Don't reinvent infrastructure. Search the organization's private registry for an approved component that already solves this and reuse it instead of writing new resources from scratch.",
    "4. Make the smallest change that fixes the root cause in the app's Pulumi program.",
    "5. Get short-lived AWS credentials by opening the cloud-access/aws-access ESC environment, then run `pulumi preview` on the `reinvent-tasks/dev` stack to validate the fix. The guardrails policy pack runs in the preview.",
    "6. Read the policy results and fix any violation exactly as its message describes. Re-preview until the policy pack passes.",
    "7. Open ONE pull request against `main`. In the description give a plain-language root cause, the approach you took (including any approved component you reused), any policy issues you resolved, and the clean `pulumi preview` summary.",
].join("\n");

export class TroubleshooterAgent extends pulumi.ComponentResource {
    /** The agent definition's id. */
    public readonly agentId: pulumi.Output<string>;

    constructor(name: string, opts?: pulumi.ComponentResourceOptions) {
        super("reinvent:setup:TroubleshooterAgent", name, {}, opts);

        // The ESC environment the app's stacks import for AWS credentials. Opening
        // it lets the agent run `pulumi preview` to check a fix.
        const awsAccess = ps.getEnvironmentOutput({
            organizationName: cfg.org,
            projectName: "cloud-access",
            name: "aws-access",
        }, { parent: this });

        // Least privilege: read stacks, their update logs and state, search
        // resources, and open only cloud-access/aws-access for a preview. No
        // stack:write, so it cannot deploy. No approval scopes, so it cannot
        // approve its own fix. Widening this takes a pull request.
        const role = new ps.OrganizationRole(`${name}-role`, {
            organizationName: cfg.org,
            name: "reinvent-app-troubleshooter",
            description:
                "Read stacks, their history and state, search resources, open " +
                "cloud-access/aws-access for previews. No deploy, no approve.",
            permissions: ps.buildRolePermissionsOutput({
                organizationScopes: ["resources:search"],
                stackRules: [{ all: true, scopes: ["stack:read", "stack:export"] }],
                environmentRules: [{
                    id: awsAccess.environmentId,
                    scopes: ["environment:read", "environment:open"],
                }],
            }).permissions,
        }, { parent: this });

        const agent = new ps.api.agents.Definition(`${name}-agent`, {
            orgName: cfg.org,
            name: "reinvent-app-troubleshooter",
            displayName: "App Troubleshooter",
            purpose: "When a Datadog alert fires on the reinvent-tasks app, find the root cause and open a pull request with the fix.",
            customInstructions: INSTRUCTIONS,
            roleId: role.roleId,
            // Enable the Datadog MCP integration (created in the console) so the
            // agent can read the alert it was triggered by. Undefined -> inherit.
            enabledIntegrations: cfg.datadogIntegrationId ? [cfg.datadogIntegrationId] : undefined,
        }, { parent: this });

        this.agentId = agent.definitionID;
        this.registerOutputs({ agentId: this.agentId });
    }
}
