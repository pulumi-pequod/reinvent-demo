/**
 * Task-tracker demo app
 * ---------------------------------------------------------------------------
 * Serverless backend + static frontend for the re:Invent live demo, assembled
 * from custom components:
 *
 *   - DynamoDB      : stores tasks ({ id (PK), title, assignee, email, done }).
 *   - LambdaApi     : role + Lambda (handler/) + API Gateway v2 HTTP API.
 *   - EmailSender   : verified SES sender + scoped send policy for /remind.
 *   - StaticWebsite : public S3 bucket serving the task UI.
 *
 * The "Remind" button hits POST /remind, which sends through Amazon SES. The
 * approved EmailSender component (components/ses) provides the verified sender
 * identity and a scoped send policy, which is attached to the Lambda's role.
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
// Email: verified SES sender + scoped send policy, via the approved
// EmailSender component from the private registry
// ---------------------------------------------------------------------------
// Send from the already-verified SES domain identity (pulumi-ce.team, DKIM
// verified in this account). A brand-new per-address identity would stay
// "Pending" because nobody can receive its verification email, so
// verifySenderAddress is false and the send policy is scoped to the domain.
const reminderFrom = config.get("reminderFrom") ?? "reminders@pulumi-ce.team";
const emailSender = new ses.EmailSender(`${appName}-email`, {
  senderEmail: reminderFrom,
  verifySenderAddress: false,
  tags: {
    ...baseTags,
    // Required by the guardrails policy pack (require-email-compliance-tag) on
    // any IAM policy that grants SES send access.
    "data-classification": "restricted",
  },
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
    // The "from" address for reminders; verified by the EmailSender component.
    REMINDER_FROM: reminderFrom,
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

// Grant the Lambda's execution role the scoped SES send policy.
new aws.iam.RolePolicyAttachment(`${appName}-api-ses-send`, {
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
