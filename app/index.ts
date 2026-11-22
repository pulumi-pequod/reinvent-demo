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
 *   - EmailSender   : approved SES component (private registry) — sender
 *                     identity + scoped send policy for the Lambda role.
 *
 * The "Remind" button hits POST /remind, which sends through Amazon SES. The
 * EmailSender component provides the sender identity and a least-privilege
 * ses:SendEmail policy that is attached to the Lambda's execution role.
 *
 * AWS credentials and config come from the ESC environment imported by each
 * stack's Pulumi.<stack>.yaml — no static secrets or providers configured here.
 */

import * as fs from "fs";
import * as path from "path";
import * as pulumi from "@pulumi/pulumi";
import * as serverlessApi from "@pulumi-pequod/serverless-api";
import * as ses from "@pulumi-pequod/ses";
import * as staticWebsite from "@pulumi-pequod/static-website";
import * as aws from "@pulumi/aws";
import * as service from "@pulumi/pulumiservice";

const config = new pulumi.Config();
const appName = config.get("appName") ?? "reinvent-tasks";
const stage = config.get("stage") ?? pulumi.getStack();

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
// Email: SES sender identity + scoped send policy, via the approved
// EmailSender component from the private registry
// ---------------------------------------------------------------------------
// The sender address lives on a domain that is already a verified SES identity
// in this account/region, so no per-address identity is created (nothing goes
// "Pending") and the send policy is scoped to that domain identity.
const emailSender = new ses.EmailSender(`${appName}-email`, {
  senderEmail: config.get("reminderFrom") ?? "reminders@pulumi-ce.team",
  verifySenderAddress: false,
  // Required by the guardrails policy pack (require-email-compliance-tag).
  tags: { "data-classification": "restricted" },
});

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
    // The "from" address for reminders (verified via EmailSender above).
    REMINDER_FROM: emailSender.senderEmail,
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

// Grant the Lambda's execution role permission to send through SES.
new aws.iam.RolePolicyAttachment(`${appName}-email-send`, {
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
