/**
 * Task-tracker demo app
 * ---------------------------------------------------------------------------
 * Serverless backend + static frontend for the re:Invent live demo:
 *
 *   - DynamoDB   : stores tasks ({ id (PK), title, assignee, email, done, ... })
 *   - IAM        : least-privilege Lambda role (CloudWatch logs + table CRUD)
 *   - Lambda     : CRUD API handler + a /remind STUB
 *   - LambdaApi  : custom component (API Gateway v2 HTTP API) fronting the Lambda
 *   - S3         : static website bucket serving the task UI
 *
 * The "Remind" button hits POST /remind, which today returns 501. Wiring that
 * endpoint to send a real email via the SES EmailSender component is the live
 * Pulumi Neo demo moment — see README.md.
 *
 * AWS credentials and config (stage, appName, region, senderEmail) come from the
 * ESC environment imported by each stack's Pulumi.<stack>.yaml — no static
 * secrets or providers configured here.
 */

import * as fs from "fs";
import * as path from "path";
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { LambdaApi } from "@pulumi-pequod/serverless-api";
import { StackSettings } from "@pulumi-pequod/stackmgmt";

// NOTE: the AWS SDK is intentionally NOT imported at module scope. It is
// `require`d inside the Lambda callback so Pulumi's function serialization does
// not try to capture/serialize it.

const config = new pulumi.Config();
const appName = config.get("appName") ?? "reinvent-tasks";
const stage = config.get("stage") ?? pulumi.getStack();
const runtime = "nodejs18.x";

const baseTags = {
  // Do NOT set a lowercase `owner` tag — the provider applies a stack-level
  // `Owner` default tag and IAM rejects case-insensitive key collisions.
  project: pulumi.getProject(),
  PulumiStack: pulumi.getStack(),
  stage,
  managedBy: "pulumi",
};

// ---------------------------------------------------------------------------
// DynamoDB: tasks keyed by id
// ---------------------------------------------------------------------------
const tasksTable = new aws.dynamodb.Table(`${appName}-tasks`, {
  attributes: [{ name: "id", type: "S" }],
  hashKey: "id",
  billingMode: "PAY_PER_REQUEST",
  pointInTimeRecovery: { enabled: true },
  tags: { ...baseTags },
});

// ---------------------------------------------------------------------------
// IAM: least-privilege role for the Lambda
// ---------------------------------------------------------------------------
const lambdaRole = new aws.iam.Role(`${appName}-lambda-role`, {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Action: "sts:AssumeRole",
        Effect: "Allow",
        Principal: { Service: "lambda.amazonaws.com" },
      },
    ],
  }),
  tags: { ...baseTags },
});

new aws.iam.RolePolicyAttachment(`${appName}-lambda-logs`, {
  role: lambdaRole.name,
  policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
});

// Least-privilege CRUD on the tasks table only.
new aws.iam.RolePolicy(`${appName}-lambda-ddb-policy`, {
  role: lambdaRole.id,
  policy: tasksTable.arn.apply((tableArn) =>
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
  ),
});

// NOTE(neo): when wiring up email reminders, attach the SES EmailSender
// component's `sendPolicyArn` to this role, e.g.:
//
//   import { EmailSender } from "@pequod/ses";
//   const sender = new EmailSender("reminders", { senderEmail });
//   new aws.iam.RolePolicyAttachment(`${appName}-lambda-ses`, {
//       role: lambdaRole.name,
//       policyArn: sender.sendPolicyArn,
//   });

// ---------------------------------------------------------------------------
// Lambda: CRUD handler + /remind stub
// ---------------------------------------------------------------------------
const apiHandler = new aws.lambda.CallbackFunction(`${appName}-handler`, {
  role: lambdaRole,
  runtime,
  timeout: 10,
  environment: {
    variables: {
      TABLE_NAME: tasksTable.name,
    },
  },
  callback: async (ev: any) => {
    // API Gateway v2 (payload format 2.0): route on `routeKey`, e.g.
    // "POST /tasks/{id}/done". Path variables are on `pathParameters`.
    const routeKey: string = ev.routeKey || "";

    const json = (statusCode: number, body: any) => ({
      statusCode,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
    const { DynamoDBDocument } = require("@aws-sdk/lib-dynamodb");
    const doc = DynamoDBDocument.from(new DynamoDBClient({}));
    const TableName = process.env.TABLE_NAME as string;

    try {
      // GET /tasks — list all tasks.
      if (routeKey === "GET /tasks") {
        const res = await doc.scan({ TableName });
        const items = (res.Items ?? []).sort((a: any, b: any) =>
          a.createdAt < b.createdAt ? 1 : -1,
        );
        return json(200, items);
      }

      // POST /tasks — create a task.
      if (routeKey === "POST /tasks") {
        const parsed = parseBody(ev);
        const title = parsed.title;
        if (!title) {
          return json(400, { error: "'title' is required" });
        }
        const item = {
          id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          title,
          assigneeName: parsed.assigneeName ?? "",
          assigneeEmail: parsed.assigneeEmail ?? "",
          done: false,
          createdAt: new Date().toISOString(),
        };
        await doc.put({ TableName, Item: item });
        return json(201, item);
      }

      // POST /tasks/{id}/done — mark a task complete.
      if (routeKey === "POST /tasks/{id}/done") {
        const id = ev.pathParameters?.id;
        if (!id) {
          return json(400, { error: "task id is required" });
        }
        const res = await doc.update({
          TableName,
          Key: { id },
          UpdateExpression: "SET done = :done",
          ExpressionAttributeValues: { ":done": true },
          ReturnValues: "ALL_NEW",
        });
        return json(200, res.Attributes);
      }

      // POST /remind — STUB. The live Neo demo implements this by sending
      // an email through the SES EmailSender component.
      if (routeKey === "POST /remind") {
        // TODO(neo): look up the task, then send a reminder email to
        // task.assigneeEmail via the SES EmailSender component and
        // return 200 on success.
        return json(501, {
          status: "not-implemented",
          message:
            "Email reminders are not wired up yet — this is the Pulumi Neo demo moment.",
        });
      }

      return json(404, { error: `No route for ${routeKey}` });
    } catch (e: any) {
      return json(500, { error: e?.message ?? "Internal error" });
    }
  },
  tags: { ...baseTags },
});

// Parse a JSON body or query string into an object.
function parseBody(ev: any): any {
  try {
    if (ev.body) {
      const raw = ev.isBase64Encoded
        ? Buffer.from(ev.body, "base64").toString("utf8")
        : ev.body;
      return JSON.parse(raw || "{}");
    }
    return ev.queryStringParameters || {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// LambdaApi: custom component (API Gateway v2 HTTP API) fronting the Lambda.
// CORS preflight is handled by the API, so no OPTIONS routes are needed here.
// ---------------------------------------------------------------------------
const api = new LambdaApi(`${appName}-api`, {
  handler: apiHandler,
  stageName: stage,
  routes: [
    { method: "GET", path: "/tasks" },
    { method: "POST", path: "/tasks" },
    { method: "POST", path: "/tasks/{id}/done" },
    { method: "POST", path: "/remind" },
  ],
  tags: baseTags,
});

// Invoke URL already includes the stage and has no trailing slash.
const apiBaseUrl = api.url;

// ---------------------------------------------------------------------------
// S3 static website: serves the task UI with the live API URL injected
// ---------------------------------------------------------------------------
const siteBucket = new aws.s3.BucketV2(`${appName}-site`, {
  tags: { ...baseTags },
});

new aws.s3.BucketWebsiteConfigurationV2(`${appName}-site-web`, {
  bucket: siteBucket.id,
  indexDocument: { suffix: "index.html" },
});

const ownership = new aws.s3.BucketOwnershipControls(
  `${appName}-site-ownership`,
  {
    bucket: siteBucket.id,
    rule: { objectOwnership: "BucketOwnerPreferred" },
  },
);

const publicAccess = new aws.s3.BucketPublicAccessBlock(
  `${appName}-site-access`,
  {
    bucket: siteBucket.id,
    blockPublicAcls: false,
    blockPublicPolicy: false,
    ignorePublicAcls: false,
    restrictPublicBuckets: false,
  },
);

// Allow public reads so the static site is browsable.
new aws.s3.BucketPolicy(
  `${appName}-site-policy`,
  {
    bucket: siteBucket.id,
    policy: siteBucket.arn.apply((arn) =>
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Principal: "*",
            Action: ["s3:GetObject"],
            Resource: `${arn}/*`,
          },
        ],
      }),
    ),
  },
  { dependsOn: [publicAccess] },
);

// Inject the live API endpoint into the HTML (replaces __API_ENDPOINT__).
const indexHtml = fs.readFileSync(
  path.join(__dirname, "frontend", "index.html"),
  "utf8",
);
const renderedHtml = apiBaseUrl.apply((url) =>
  indexHtml.replace(/__API_ENDPOINT__/g, url),
);

new aws.s3.BucketObject(
  `${appName}-index`,
  {
    bucket: siteBucket.id,
    key: "index.html",
    content: renderedHtml,
    contentType: "text/html",
  },
  { dependsOn: [ownership, publicAccess] },
);

// Manage stack settings in Pulumi Cloud (TTL, drift, deployment settings).
new StackSettings("stackmgmt");

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------
export const apiUrl = apiBaseUrl;
export const siteUrl = pulumi.interpolate`http://${siteBucket.bucketRegionalDomainName}/index.html`;
export const websiteEndpoint = pulumi.interpolate`http://${siteBucket.bucket}.s3-website-${aws.config.region}.amazonaws.com`;
export const tasksTableName = tasksTable.name;
