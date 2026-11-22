/**
 * TroubleshooterAgent — the custom Pulumi Agent that investigates the email
 * failure, declared as a local component (its own identity, a least-privilege
 * role, and its instructions, grouped under one parent).
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
    "You are started when the reinvent-tasks app fails to send a reminder email. A Datadog monitor caught a `reminder_send_failed` error and triggered you.",
    "",
    "Investigate and propose a fix as a pull request. Do NOT deploy: never run `pulumi up`, `refresh` or `destroy`, and never approve anything. A person merges your PR and the reinvent delivery pipeline ships it.",
    "",
    "1. Read the Datadog alert and the failing stack's recent updates. Read the app program in `app/` of pulumi-pequod/reinvent-demo and the handler in `app/handler/`.",
    "2. Decide whether this is an architectural gap, not a code typo. Here it is: the app calls SES to send mail but has no email infrastructure — no verified SES identity and no `ses:SendEmail` permission on the Lambda role.",
    "3. Do NOT write SES from scratch. Search the organization's private registry for an approved component that already does this. Use the `EmailSender` component (publisher `pequod`) — a verified SES sender plus a scoped send IAM policy.",
    "4. Wire `EmailSender` into `app/index.ts`: create it, and attach its `sendPolicyArn` to the API's Lambda role so the function can send. Pass the app's base tags.",
    "5. Get short-lived AWS credentials by opening the cloud-access/aws-access ESC environment and run `pulumi preview` on the `reinvent-tasks/dev` stack. The guardrails policy pack runs in the preview.",
    "6. Read the policy results. Fix any violation exactly as its message says. Expect `require-email-compliance-tag`: the send policy needs a `data-classification` tag — add `tags: { \"data-classification\": \"restricted\" }` to the EmailSender inputs. Re-preview until the policy pack passes.",
    "7. Open ONE pull request against `main`. In the description give: a plain-language root cause (the app had no email infrastructure), the component you reused, the policy violation you fixed and how, and the clean `pulumi preview` summary.",
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
            name: "reinvent-email-troubleshooter",
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
            name: "reinvent-email-troubleshooter",
            displayName: "Email Troubleshooter",
            purpose: "When reinvent-tasks can't send reminder emails, find the root cause and open a pull request with the fix.",
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
