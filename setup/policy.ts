/**
 * Enable the guardrails policy pack on the demo app's stacks.
 *
 * A Policy Group binds the published `reinvent-demo-guardrails` pack to the
 * reinvent-tasks dev/staging/prod stacks, so the rules run on every preview and
 * update of those stacks — including the agent's cloud `pulumi preview` on dev.
 * That is what makes the policy results show up in the preview during the demo.
 *
 * The pack must be published first (`pulumi policy publish`, a RUNBOOK step);
 * this references it by name and version.
 */
import * as pulumi from "@pulumi/pulumi";
import * as ps from "@pulumi/pulumiservice";
import * as cfg from "./config";

const POLICY_PACK_NAME = "reinvent-demo-guardrails";

export function enablePolicyPack(): ps.PolicyGroup {
    const version = new pulumi.Config().get("policyPackVersion") ?? "0.2.0";

    return new ps.PolicyGroup("reinvent-guardrails", {
        organizationName: cfg.org,
        name: "reinvent-demo",
        policyPacks: [{ name: POLICY_PACK_NAME, versionTag: version }],
        stacks: cfg.stages.map((stage) => ({
            name: stage,
            routingProject: cfg.appProject,
        })),
    });
}
