/**
 * GuardrailsPolicy — enables the guardrails policy pack on the app's stacks.
 *
 * A local component wrapping a Policy Group that binds the published
 * `reinvent-demo-guardrails` pack to the reinvent-tasks dev/staging/prod stacks,
 * so the rules run on every preview and update — including the agent's cloud
 * `pulumi preview` on dev. The pack must be published first (`pulumi policy
 * publish`, a RUNBOOK step); this references it by name and version.
 */
import * as pulumi from "@pulumi/pulumi";
import * as ps from "@pulumi/pulumiservice";
import * as cfg from "../config";

export class GuardrailsPolicy extends pulumi.ComponentResource {
    /** The policy group's name. */
    public readonly policyGroupName: pulumi.Output<string>;

    constructor(name: string, opts?: pulumi.ComponentResourceOptions) {
        super("reinvent:setup:GuardrailsPolicy", name, {}, opts);

        const group = new ps.PolicyGroup(`${name}-group`, {
            organizationName: cfg.org,
            name: "reinvent-demo",
            // Preventative (not audit): mandatory violations block the operation,
            // so the rules are enforced and visible on `pulumi preview`/`up` —
            // the agent's dev preview stops on require-email-compliance-tag until
            // it adds the tag.
            mode: "preventative",
            policyPacks: [{ name: cfg.policyPackName, versionTag: cfg.policyPackVersion }],
            stacks: cfg.stages.map((stage) => ({
                name: stage,
                routingProject: cfg.appProject,
            })),
        }, { parent: this });

        this.policyGroupName = group.name;
        this.registerOutputs({ policyGroupName: this.policyGroupName });
    }
}
