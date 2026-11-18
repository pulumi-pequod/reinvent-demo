import * as aws from "@pulumi/aws";
import { PolicyPack, validateResourceOfType } from "@pulumi/policy";

const REQUIRED_TAGS = ["project", "PulumiStack"];

new PolicyPack("reinvent-demo-guardrails", {
    policies: [
        {
            name: "dynamodb-pitr-enabled",
            description: "DynamoDB tables must have point-in-time recovery enabled.",
            enforcementLevel: "mandatory",
            validateResource: validateResourceOfType(aws.dynamodb.Table, (table, _args, reportViolation) => {
                if (!table.pointInTimeRecovery?.enabled) {
                    reportViolation(
                        "DynamoDB table must enable point-in-time recovery " +
                        "(pointInTimeRecovery: { enabled: true }).",
                    );
                }
            }),
        },
        {
            name: "dynamodb-pay-per-request",
            description: "DynamoDB tables must use on-demand (PAY_PER_REQUEST) billing.",
            enforcementLevel: "advisory",
            validateResource: validateResourceOfType(aws.dynamodb.Table, (table, _args, reportViolation) => {
                if (table.billingMode !== "PAY_PER_REQUEST") {
                    reportViolation(
                        "DynamoDB table should use billingMode 'PAY_PER_REQUEST' " +
                        "to avoid provisioned-capacity cost in the demo.",
                    );
                }
            }),
        },
        {
            name: "require-project-tags",
            description: `Taggable AWS resources must carry tags: ${REQUIRED_TAGS.join(", ")}.`,
            enforcementLevel: "advisory",
            validateResource: (args, reportViolation) => {
                const tags = (args.props as any)?.tags;
                // Only check resources that support a `tags` map.
                if (tags === undefined) {
                    return;
                }
                for (const key of REQUIRED_TAGS) {
                    if (!(key in tags)) {
                        reportViolation(`Resource is missing required tag '${key}'.`);
                    }
                }
            },
        },
    ],
});
