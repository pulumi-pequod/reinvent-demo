/**
 * Local tests for the guardrails policy pack.
 *
 * These exercise the pure rule functions in ../rules.ts directly, so they run
 * with no Pulumi engine or cloud credentials:
 *
 *     cd policies && npm install && npm test
 *
 * The most important case is `require-email-compliance-tag`: it proves the
 * demo's deterministic catch (EmailSender's default send policy trips it) and
 * the fix (adding the data-classification tag clears it).
 */
import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as rules from "../rules";

function collect(fn: (report: rules.Report) => void): string[] {
    const violations: string[] = [];
    fn((m) => violations.push(m));
    return violations;
}

// The send policy the approved EmailSender produces by default: scoped to a
// verified identity ARN, explicit actions, and tagged only with whatever the
// caller passed (here, the app's base tags — no data-classification).
const IDENTITY_ARN = "arn:aws:ses:us-west-2:123456789012:identity/demo.pequod.dev";
function emailSenderSendPolicy(extraTags: Record<string, string> = {}) {
    return {
        policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [
                {
                    Effect: "Allow",
                    Action: ["ses:SendEmail", "ses:SendRawEmail"],
                    Resource: IDENTITY_ARN,
                },
            ],
        }),
        tags: { project: "reinvent-tasks", PulumiStack: "dev", ...extraTags },
    };
}

test("require-email-compliance-tag: trips on EmailSender's default send policy", () => {
    const v = collect((r) => rules.checkEmailComplianceTag(emailSenderSendPolicy(), r));
    assert.equal(v.length, 1, "first wiring should trip exactly one violation");
    assert.match(v[0], /data-classification/);
    assert.match(v[0], /EmailSender/);
});

test("require-email-compliance-tag: clears once the data-classification tag is added", () => {
    const fixed = emailSenderSendPolicy({ [rules.EMAIL_COMPLIANCE_TAG]: rules.EMAIL_COMPLIANCE_VALUE });
    const v = collect((r) => rules.checkEmailComplianceTag(fixed, r));
    assert.equal(v.length, 0, "tagged send policy should pass");
});

test("require-email-compliance-tag: ignores non-SES policies", () => {
    const dynamoPolicy = {
        policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{ Effect: "Allow", Action: ["dynamodb:PutItem"], Resource: "*" }],
        }),
        tags: {},
    };
    const v = collect((r) => rules.checkEmailComplianceTag(dynamoPolicy, r));
    assert.equal(v.length, 0);
});

test("ses-no-wildcard-send: passes on explicit actions, trips on ses:*", () => {
    assert.equal(collect((r) => rules.checkNoSesWildcard(emailSenderSendPolicy(), r)).length, 0);

    const wildcard = {
        policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{ Effect: "Allow", Action: "ses:*", Resource: IDENTITY_ARN }],
        }),
    };
    const v = collect((r) => rules.checkNoSesWildcard(wildcard, r));
    assert.equal(v.length, 1);
    assert.match(v[0], /ses:\*/);
});

test("ses-send-scoped-to-identity: passes when scoped, trips on Resource '*'", () => {
    assert.equal(collect((r) => rules.checkSesSendScoped(emailSenderSendPolicy(), r)).length, 0);

    const unscoped = {
        policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{ Effect: "Allow", Action: ["ses:SendEmail"], Resource: "*" }],
        }),
    };
    const v = collect((r) => rules.checkSesSendScoped(unscoped, r));
    assert.equal(v.length, 1);
    assert.match(v[0], /verified SES identity/);
});

test("ses-send-scoped-to-identity: trips on identity/* wildcard resource", () => {
    const wildcardIdentity = {
        policy: JSON.stringify({
            Version: "2012-10-17",
            Statement: [{
                Effect: "Allow",
                Action: ["ses:SendEmail"],
                Resource: "arn:aws:ses:us-west-2:123456789012:identity/*",
            }],
        }),
    };
    assert.equal(collect((r) => rules.checkSesSendScoped(wildcardIdentity, r)).length, 1);
});

test("dynamodb-pitr-enabled: trips when PITR is off", () => {
    assert.equal(collect((r) => rules.checkDynamoPitr({ pointInTimeRecovery: { enabled: true } }, r)).length, 0);
    assert.equal(collect((r) => rules.checkDynamoPitr({}, r)).length, 1);
    assert.equal(collect((r) => rules.checkDynamoPitr({ pointInTimeRecovery: { enabled: false } }, r)).length, 1);
});

test("dynamodb-pay-per-request: advisory on provisioned billing", () => {
    assert.equal(collect((r) => rules.checkDynamoBilling({ billingMode: "PAY_PER_REQUEST" }, r)).length, 0);
    assert.equal(collect((r) => rules.checkDynamoBilling({ billingMode: "PROVISIONED" }, r)).length, 1);
});

test("require-project-tags: skips untagged resource types, flags missing keys", () => {
    assert.equal(collect((r) => rules.checkProjectTags({}, r)).length, 0, "no tags map -> not applicable");
    const v = collect((r) => rules.checkProjectTags({ tags: { project: "x" } }, r));
    assert.equal(v.length, 1);
    assert.match(v[0], /PulumiStack/);
});

test("grantsSesSend: recognizes send actions, including wildcards", () => {
    assert.equal(rules.grantsSesSend(emailSenderSendPolicy().policy), true);
    assert.equal(rules.grantsSesSend(JSON.stringify({
        Statement: [{ Effect: "Allow", Action: "ses:*", Resource: "*" }],
    })), true);
    assert.equal(rules.grantsSesSend(JSON.stringify({
        Statement: [{ Effect: "Allow", Action: "s3:GetObject", Resource: "*" }],
    })), false);
});
