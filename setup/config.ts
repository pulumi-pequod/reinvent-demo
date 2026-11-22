/**
 * Shared configuration for the re:Invent demo setup program.
 *
 * Everything the staging program needs that varies by environment is read here
 * from Pulumi config. Secrets (Datadog keys, the Pulumi trigger secret) should
 * come from the ESC environment this stack imports — see Pulumi.setup.yaml and
 * the RUNBOOK. Nothing secret is hard-coded.
 */
import * as pulumi from "@pulumi/pulumi";

const cfg = new pulumi.Config();

export const org = pulumi.getOrganization();

/** The Pulumi project the demo app ships as (its stacks are dev/staging/prod). */
export const appProject = cfg.get("appProject") ?? "reinvent-tasks";

/** The ESC project that holds the per-stage AWS-access environments. */
export const accessProject = cfg.get("accessProject") ?? "demo-access";

/** The three demo stages, in release order. */
export const stages = ["dev", "staging", "prod"] as const;
export type Stage = (typeof stages)[number];

/** AWS region the demo runs in. */
export const awsRegion = cfg.get("awsRegion") ?? "us-west-2";

/**
 * AWS account id per stage. Defaults to a single demo account for all three; set
 * `awsAccount<Stage>` to split stages across accounts. Replace the default with
 * the real demo account id (or set it in config) before deploying.
 */
export function awsAccountId(stage: Stage): string {
    const perStage = cfg.get(`awsAccount${cap(stage)}`);
    return perStage ?? cfg.get("awsAccount") ?? "000000000000";
}

/** Name of the IAM role ESC assumes via OIDC for a given stage. */
export function oidcRoleName(stage: Stage): string {
    return cfg.get(`oidcRole${cap(stage)}`) ?? `pulumi-esc-${stage}`;
}

/** The full role ARN ESC assumes via OIDC for a stage. */
export function oidcRoleArn(stage: Stage): string {
    return `arn:aws:iam::${awsAccountId(stage)}:role/${oidcRoleName(stage)}`;
}

/**
 * Pulumi Cloud usernames that may approve. Used both for the ESC approval rules
 * on staging/prod and as the pipeline's prod approvers. The person who starts a
 * pipeline run can't approve it, so keep at least two real people here.
 */
export const approvers = cfg.getObject<string[]>("approvers") ?? ["v-adam-pulumi-corp"];

/** Datadog site (datadoghq.com, datadoghq.eu, ...). */
export const datadogSite = cfg.get("datadogSite") ?? "datadoghq.com";

/** Datadog API/APP keys — supply from the imported ESC environment. */
export const datadogApiKey = cfg.getSecret("datadogApiKey");
export const datadogAppKey = cfg.getSecret("datadogAppKey");

/**
 * The Pulumi Cloud agent trigger webhook URL and its shared secret. These are
 * generated when the Datadog webhook automation is created in Pulumi Cloud (a
 * SaaS-only step — see the RUNBOOK). Supply them via the ESC environment so the
 * Datadog webhook resource can point at the agent.
 */
export const pulumiTriggerUrl = cfg.get("pulumiTriggerUrl") ?? "https://api.pulumi.com/REPLACE_ME_IN_CONSOLE";
export const pulumiTriggerSecret = cfg.getSecret("pulumiTriggerSecret");

/**
 * Id of the Datadog MCP integration to enable for the agent's tasks. The
 * integration and its credentials are created in Pulumi Cloud (SaaS-only). Once
 * created, set `datadogIntegrationId` in config so it is enabled on the agent.
 */
export const datadogIntegrationId = cfg.get("datadogIntegrationId");

function cap(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
