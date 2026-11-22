/**
 * ApproverTeam — the group of people who can approve the pipeline's prod gate.
 *
 * A local component so the one setup program composes cleanly. Members are
 * existing org users (adding them to a team doesn't change their org
 * membership). The run-starter-can't-approve rule is enforced by the pipeline.
 */
import * as pulumi from "@pulumi/pulumi";
import * as ps from "@pulumi/pulumiservice";
import * as cfg from "../config";

export class ApproverTeam extends pulumi.ComponentResource {
    /** The team's name. */
    public readonly teamName: pulumi.Output<string>;

    constructor(name: string, opts?: pulumi.ComponentResourceOptions) {
        super("reinvent:setup:ApproverTeam", name, {}, opts);

        const team = new ps.Team(`${name}-team`, {
            organizationName: cfg.org,
            teamType: "pulumi",
            name: "reinvent-approvers",
            displayName: "re:Invent Demo Approvers",
            description: "People who can approve the prod gate for the re:Invent demo pipeline.",
            members: cfg.approvers,
        }, { parent: this });

        this.teamName = pulumi.output(team.name).apply((n) => n ?? "reinvent-approvers");
        this.registerOutputs({ teamName: this.teamName });
    }
}
