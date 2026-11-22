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

/** The three demo stages, in release order. */
export const stages = ["dev", "staging", "prod"] as const;
export type Stage = (typeof stages)[number];

/** The guardrails policy pack this setup enables (published separately). */
export const policyPackName = cfg.get("policyPackName") ?? "reinvent-demo-guardrails";
export const policyPackVersion = cfg.get("policyPackVersion") ?? "0.2.0";

/**
 * Pulumi Cloud usernames that may approve the pipeline's prod gate. The person
 * who starts a pipeline run can't approve it, so keep at least two. Defaults to
 * the shared booth demo logins; add more freely.
 */
export const approvers = cfg.getObject<string[]>("approvers") ?? ["ishmael-archie", "ishmael-betty"];

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
