/**
 * re:Invent demo guardrails policy pack.
 *
 * These rules are a *visible* part of the live flow: they run in the agent's
 * `pulumi preview` against dev and their results show up in the preview. The
 * pack mixes mandatory and advisory rules and includes SES-specific guardrails.
 *
 * The rule the demo leans on is `require-email-compliance-tag` (mandatory): the
 * approved EmailSender component does not tag its send policy with
 * `data-classification`, so the agent's first wiring trips it. The violation
 * message states exactly what to add, so the agent fixes it on its own, then
 * re-previews clean. See `rules.ts` for the logic and `tests/` for the tests.
 */
import * as aws from "@pulumi/aws";
import { PolicyPack, validateResourceOfType } from "@pulumi/policy";
import * as rules from "./rules";

new PolicyPack("reinvent-demo-guardrails", {
    policies: [
        // --- SES guardrails --------------------------------------------------
        {
            name: "ses-no-wildcard-send",
            description: "IAM policies must not grant SES through a wildcard action (ses:* or *).",
            enforcementLevel: "mandatory",
            validateResource: validateResourceOfType(aws.iam.Policy, (p, _args, report) =>
                rules.checkNoSesWildcard(p, report),
            ),
        },
        {
            name: "ses-send-scoped-to-identity",
            description: "SES send permissions must be scoped to a verified SES identity ARN, not '*'.",
            enforcementLevel: "mandatory",
            validateResource: validateResourceOfType(aws.iam.Policy, (p, _args, report) =>
                rules.checkSesSendScoped(p, report),
            ),
        },
        {
            name: "require-email-compliance-tag",
            description: `IAM policies granting SES send must carry the '${rules.EMAIL_COMPLIANCE_TAG}' tag.`,
            enforcementLevel: "mandatory",
            validateResource: validateResourceOfType(aws.iam.Policy, (p, _args, report) =>
                rules.checkEmailComplianceTag(p, report),
            ),
        },

        // --- DynamoDB guardrails ---------------------------------------------
        {
            name: "dynamodb-pitr-enabled",
            description: "DynamoDB tables must have point-in-time recovery enabled.",
            enforcementLevel: "mandatory",
            validateResource: validateResourceOfType(aws.dynamodb.Table, (t, _args, report) =>
                rules.checkDynamoPitr(t, report),
            ),
        },
        {
            name: "dynamodb-pay-per-request",
            description: "DynamoDB tables should use on-demand (PAY_PER_REQUEST) billing.",
            enforcementLevel: "advisory",
            validateResource: validateResourceOfType(aws.dynamodb.Table, (t, _args, report) =>
                rules.checkDynamoBilling(t, report),
            ),
        },

        // --- Tagging ---------------------------------------------------------
        {
            name: "require-project-tags",
            description: `Taggable AWS resources should carry tags: ${rules.REQUIRED_TAGS.join(", ")}.`,
            enforcementLevel: "advisory",
            validateResource: (args, report) =>
                rules.checkProjectTags(args.props, report),
        },
    ],
});
