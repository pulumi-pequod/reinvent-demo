/**
 * The approver group for the demo.
 *
 * A Pulumi team that gathers the people allowed to approve the prod gate in the
 * delivery pipeline and changes to the staging/prod ESC environments. Having a
 * named group makes "a second person approves" concrete and keeps the approver
 * list in one place. The pipeline (delivery/) and the ESC approval rules
 * reference these same usernames.
 *
 * Members are existing org users (adding them to a team doesn't change their org
 * membership). The run-starter-can't-approve rule is enforced by the pipeline.
 */
import * as ps from "@pulumi/pulumiservice";
import * as cfg from "./config";

export function createApproverTeam(): ps.Team {
    return new ps.Team("reinvent-approvers", {
        organizationName: cfg.org,
        teamType: "pulumi",
        name: "reinvent-approvers",
        displayName: "re:Invent Demo Approvers",
        description: "People who can approve the prod gate and staging/prod ESC changes for the re:Invent demo.",
        members: cfg.approvers,
    });
}
