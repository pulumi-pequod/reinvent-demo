/**
 * Per-stage ESC environments and their approval rules.
 *
 * Each stage gets its own ESC environment that logs in to AWS via OIDC and hands
 * back short-lived credentials — no static keys anywhere. The demo app's stacks
 * import these (dev imports aws-dev, etc.), and the agent opens aws-dev to run
 * `pulumi preview`.
 *
 * staging and prod additionally carry an ApprovalRule: changes to those
 * environments require a second person to approve. (The provider's approval
 * rules gate environment *updates*; gating credential *opens* on staging/prod is
 * a console setting — see the RUNBOOK. Either way, the agent only ever opens
 * aws-dev, so approvals never block the live demo.)
 */
import * as pulumi from "@pulumi/pulumi";
import * as ps from "@pulumi/pulumiservice";
import * as cfg from "./config";

export interface StageEnvironment {
    stage: cfg.Stage;
    environment: ps.Environment;
}

function environmentYaml(stage: cfg.Stage): string {
    const roleArn = cfg.oidcRoleArn(stage);
    // ESC logs in to AWS via OIDC and exports short-lived credentials plus the
    // region, so stacks that import this environment need no static keys.
    return `values:
  aws:
    login:
      fn::open::aws-login:
        oidc:
          duration: 1h
          roleArn: ${roleArn}
          sessionName: pulumi-esc-${stage}
  environmentVariables:
    AWS_ACCESS_KEY_ID: \${aws.login.accessKeyId}
    AWS_SECRET_ACCESS_KEY: \${aws.login.secretAccessKey}
    AWS_SESSION_TOKEN: \${aws.login.sessionToken}
  pulumiConfig:
    aws:region: ${cfg.awsRegion}
    reinvent:stage: ${stage}
`;
}

export function createEnvironments(): Record<cfg.Stage, ps.Environment> {
    const envs = {} as Record<cfg.Stage, ps.Environment>;

    for (const stage of cfg.stages) {
        const env = new ps.Environment(`aws-access-${stage}`, {
            organization: cfg.org,
            project: cfg.accessProject,
            name: `aws-${stage}`,
            yaml: new pulumi.asset.StringAsset(environmentYaml(stage)),
        });
        envs[stage] = env;

        // staging and prod require approval on environment changes.
        if (stage !== "dev") {
            new ps.ApprovalRule(`aws-access-${stage}-approval`, {
                name: `aws-${stage}-change-approval`,
                enabled: true,
                environmentIdentifier: {
                    organization: cfg.org,
                    project: cfg.accessProject,
                    name: `aws-${stage}`,
                },
                targetActionTypes: ["update"],
                approvalRuleConfig: {
                    numApprovalsRequired: 1,
                    allowSelfApproval: false,
                    requireReapprovalOnChange: true,
                    eligibleApprovers: cfg.approvers.map((user) => ({ user })),
                },
            }, { dependsOn: [env] });
        }
    }

    return envs;
}
