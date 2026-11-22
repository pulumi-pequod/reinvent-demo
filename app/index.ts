/**
 * Task-tracker demo app
 * ---------------------------------------------------------------------------
 * Serverless backend + static frontend for the re:Invent live demo, assembled
 * from custom components:
 *
 *   - DynamoDB      : stores tasks ({ id (PK), title, assignee, email, done }).
 *   - LambdaApi     : role + Lambda (handler/) + API Gateway v2 HTTP API.
 *   - StaticWebsite : public S3 bucket serving the task UI.
 *
 * The "Remind" button hits POST /remind, which really tries to send through
 * Amazon SES. Email infrastructure comes from the approved EmailSender
 * component (components/ses): it resolves the verified sender identity and
 * provides a least-privilege send policy that is attached to the Lambda role.
 *
 * AWS credentials and config come from the ESC environment imported by each
 * stack's Pulumi.<stack>.yaml — no static secrets or providers configured here.
 */

import * as fs from "fs";
import * as path from "path";
import * as pulumi from "@pulumi/pulumi";
import * as serverlessApi from "@pulumi-pequod/serverless-api";
import * as staticWebsite from "@pulumi-pequod/static-website";
import * as ses from "@pulumi-pequod/ses";
import * as aws from "@pulumi/aws";
import * as service from "@pulumi/pulumiservice";

const config = new pulumi.Config();
const appName = config.get("appName") ?? "reinvent-tasks";
const stage = config.get("stage") ?? pulumi.getStack();

// The "from" address for reminder emails. It must live on a domain that is
// already a verified SES identity in the account (pulumi-ce.team).
const senderEmail = config.get("senderEmail") ?? "reminders@pulumi-ce.team";
// The sender's domain is already verified, so don't create (and wait on) a
// per-address identity for it.
const verifySenderAddress = config.getBoolean("verifySenderAddress") ?? false;

const baseTags = {
  // Do NOT set a lowercase `owner` tag — the provider applies a stack-level
  // `Owner` default tag and IAM rejects case-insensitive key collisions.
  project: pulumi.getProject(),
  PulumiStack: pulumi.getStack(),
  stage,
  managedBy: "pulumi",
};

// ---------------------------------------------------------------------------
// Data layer: tasks keyed by id
// ---------------------------------------------------------------------------
const tasksTable = new aws.dynamodb.Table(`${appName}-tasks`, {
  attributes: [{ name: "id", type: "S" }],
  hashKey: "id",
  billingMode: "PAY_PER_REQUEST",
  pointInTimeRecovery: { enabled: true },
  tags: baseTags,
});

// Least-privilege CRUD on the tasks table, attached to the Lambda's role.
const tasksAccessPolicy = tasksTable.arn.apply((tableArn) =>
  JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:UpdateItem",
          "dynamodb:Scan",
        ],
        Resource: tableArn,
      },
    ],
  }),
);

// ---------------------------------------------------------------------------
// API: role + Lambda + API Gateway, via the serverless-api component
// ---------------------------------------------------------------------------
const api = new serverlessApi.LambdaApi(`${appName}-api`, {
  code: new pulumi.asset.FileArchive("./handler"),
  handler: "index.handler",
  stageName: stage,
  environment: {
    TABLE_NAME: tasksTable.name,
    STAGE: stage,
    // The verified "from" address for reminders (see EmailSender below).
    REMINDER_FROM: senderEmail,
  },
  inlinePolicy: tasksAccessPolicy,
  routes: [
    { method: "GET", path: "/tasks" },
    { method: "POST", path: "/tasks" },
    { method: "POST", path: "/tasks/{id}/done" },
    { method: "POST", path: "/remind" },
  ],
  tags: baseTags,
});

// ---------------------------------------------------------------------------
// Email: approved EmailSender component (registry) + send permission for the
// Lambda role. EmailSender resolves the verified sender identity and returns a
// least-privilege policy scoped to it; we attach that policy to the role.
// ---------------------------------------------------------------------------
const emailSender = new ses.EmailSender(`${appName}-email`, {
  senderEmail,
  verifySenderAddress,
  // Guardrails policy `require-email-compliance-tag`: any IAM policy granting
  // SES send must be classified.
  tags: { ...baseTags, "data-classification": "restricted" },
});

new aws.iam.RolePolicyAttachment(`${appName}-ses-send`, {
  role: api.executionRoleName,
  policyArn: emailSender.sendPolicyArn,
});

// ---------------------------------------------------------------------------
// Frontend: static site serving the task UI, via the static-website component
// ---------------------------------------------------------------------------
const indexHtml = fs.readFileSync(
  path.join(__dirname, "frontend", "index.html"),
  "utf8",
);
// Inject the live API endpoint into the HTML (replaces __API_ENDPOINT__).
const renderedHtml = api.url.apply((url) =>
  indexHtml.replace(/__API_ENDPOINT__/g, url),
);

const site = new staticWebsite.StaticWebsite(`${appName}-site`, {
  content: renderedHtml,
  tags: baseTags,
});

// ---------------------------------------------------------------------------
// Stack metadata: tag every stack in this project for the demo (via PSP)
// ---------------------------------------------------------------------------
new service.StackTag("demo-tag", {
    organization: pulumi.getOrganization(),
    project: pulumi.getProject(),
    stack: pulumi.getStack(),
    name: "demo",
    value: "reinvent",
});

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------
export const apiUrl = api.url;
export const siteUrl = site.url;
export const websiteEndpoint = site.websiteEndpoint;
export const tasksTableName = tasksTable.name;
export const reminderSenderIdentityArn = emailSender.senderIdentityArn;
