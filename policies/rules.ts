/**
 * Pure policy logic for the re:Invent guardrails pack.
 *
 * Each exported function takes a resource's input `props` and a `report`
 * callback, and calls `report(message)` once per violation. Keeping the logic
 * here — separate from the `PolicyPack` registration in `index.ts` — lets the
 * local tests in `tests/` exercise every rule directly without a Pulumi engine.
 */

export type Report = (message: string) => void;

/** Tags that every taggable AWS resource in the demo must carry. */
export const REQUIRED_TAGS = ["project", "PulumiStack"];

/**
 * Tag that any IAM policy granting SES send access must carry. The approved
 * `EmailSender` component does NOT set this by default, so the agent's first
 * wiring of the component trips `require-email-compliance-tag` until it passes
 * the tag through. This is the deterministic catch the demo relies on.
 */
export const EMAIL_COMPLIANCE_TAG = "data-classification";
export const EMAIL_COMPLIANCE_VALUE = "restricted";

const SES_SEND_ACTIONS = ["ses:SendEmail", "ses:SendRawEmail", "ses:SendBulkEmail"];

interface IamStatement {
    Effect?: string;
    Action?: string | string[];
    Resource?: string | string[];
}

/** Parse an IAM policy document that may arrive as a JSON string or an object. */
function parsePolicyDocument(policy: unknown): IamStatement[] {
    if (policy === undefined || policy === null) {
        return [];
    }
    let doc: any = policy;
    if (typeof policy === "string") {
        try {
            doc = JSON.parse(policy);
        } catch {
            return [];
        }
    }
    const stmts = doc?.Statement;
    if (!stmts) {
        return [];
    }
    return Array.isArray(stmts) ? stmts : [stmts];
}

function asArray(v: string | string[] | undefined): string[] {
    if (v === undefined) {
        return [];
    }
    return Array.isArray(v) ? v : [v];
}

function statementHasSesSend(stmt: IamStatement): boolean {
    return asArray(stmt.Action).some(
        (a) => SES_SEND_ACTIONS.includes(a) || a === "ses:*" || a === "*",
    );
}

/** True if this IAM policy document grants any SES send permission. */
export function grantsSesSend(policyDocument: unknown): boolean {
    return parsePolicyDocument(policyDocument).some(
        (s) => (s.Effect ?? "Allow") === "Allow" && statementHasSesSend(s),
    );
}

/**
 * ses-no-wildcard-send (mandatory): an IAM policy must never grant SES via a
 * wildcard action (`ses:*` or `*`). Forces explicit, auditable send actions.
 */
export function checkNoSesWildcard(props: any, report: Report): void {
    for (const stmt of parsePolicyDocument(props?.policy)) {
        if ((stmt.Effect ?? "Allow") !== "Allow") {
            continue;
        }
        for (const action of asArray(stmt.Action)) {
            if (action === "ses:*" || action === "*") {
                report(
                    `IAM policy grants SES through a wildcard action '${action}'. ` +
                    `List explicit actions instead (e.g. ses:SendEmail, ses:SendRawEmail); ` +
                    `remove the wildcard.`,
                );
            }
        }
    }
}

/**
 * ses-send-scoped-to-identity (mandatory): any statement that allows SES send
 * must be scoped to a specific verified-identity ARN — never Resource '*'.
 * This is how "send only from verified domains" is enforced in policy.
 */
export function checkSesSendScoped(props: any, report: Report): void {
    for (const stmt of parsePolicyDocument(props?.policy)) {
        if ((stmt.Effect ?? "Allow") !== "Allow" || !statementHasSesSend(stmt)) {
            continue;
        }
        const resources = asArray(stmt.Resource);
        if (resources.length === 0 || resources.some((r) => r === "*" || r.endsWith(":identity/*"))) {
            report(
                `IAM policy allows SES send against Resource '*'. Scope the send ` +
                `permission to a specific verified SES identity ARN ` +
                `(arn:aws:ses:<region>:<account>:identity/<verified-domain>) so mail ` +
                `can only be sent from a verified domain.`,
            );
        }
    }
}

/**
 * require-email-compliance-tag (mandatory): an IAM policy that grants SES send
 * must be tagged `data-classification`. The approved EmailSender component only
 * tags its send policy with whatever `tags` the caller passes, and does not add
 * this tag itself — so the first wiring deterministically trips this rule. The
 * message tells the fixer exactly what to add.
 */
export function checkEmailComplianceTag(props: any, report: Report): void {
    if (!grantsSesSend(props?.policy)) {
        return;
    }
    const tags = props?.tags ?? {};
    if (!(EMAIL_COMPLIANCE_TAG in tags)) {
        report(
            `SES send policy is missing the required '${EMAIL_COMPLIANCE_TAG}' tag. ` +
            `Email-sending infrastructure must be classified. Pass ` +
            `tags: { "${EMAIL_COMPLIANCE_TAG}": "${EMAIL_COMPLIANCE_VALUE}" } ` +
            `to the EmailSender component so the tag lands on its send policy.`,
        );
    }
}

/**
 * dynamodb-pitr-enabled (mandatory): DynamoDB tables must have point-in-time
 * recovery enabled.
 */
export function checkDynamoPitr(props: any, report: Report): void {
    if (!props?.pointInTimeRecovery?.enabled) {
        report(
            "DynamoDB table must enable point-in-time recovery " +
            "(pointInTimeRecovery: { enabled: true }).",
        );
    }
}

/**
 * dynamodb-pay-per-request (advisory): tables should use on-demand billing so
 * the demo never provisions paid capacity.
 */
export function checkDynamoBilling(props: any, report: Report): void {
    if (props?.billingMode !== "PAY_PER_REQUEST") {
        report(
            "DynamoDB table should use billingMode 'PAY_PER_REQUEST' to avoid " +
            "provisioned-capacity cost in the demo.",
        );
    }
}

/**
 * require-project-tags (advisory): taggable resources should carry the demo's
 * project tags. Only runs on resources that expose a `tags` map.
 */
export function checkProjectTags(props: any, report: Report): void {
    const tags = props?.tags;
    if (tags === undefined) {
        return;
    }
    for (const key of REQUIRED_TAGS) {
        if (!(key in tags)) {
            report(`Resource is missing required tag '${key}'.`);
        }
    }
}
