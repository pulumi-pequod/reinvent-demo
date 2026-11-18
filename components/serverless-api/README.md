# Serverless API (LambdaApi)

A Pulumi component that provisions a complete serverless HTTP endpoint on AWS:
an **IAM execution role**, a **Lambda function**, and an **API Gateway v2 HTTP
API** that routes to it (one `AWS_PROXY` integration, one route per
`{method, path}`, a deployed stage, CORS, and the invoke permission). Built on
the base `@pulumi/aws` provider — no crosswalk packages.

## Usage

```ts
import { LambdaApi } from "@pulumi-pequod/serverless-api";

const api = new LambdaApi("tasks-api", {
    code: new pulumi.asset.FileArchive("./handler"),  // dir with index.js
    handler: "index.handler",
    stageName: "dev",
    environment: { TABLE_NAME: table.name },
    inlinePolicy: table.arn.apply((arn) => JSON.stringify({ /* DynamoDB CRUD */ })),
    routes: [
        { method: "GET",  path: "/tasks" },
        { method: "POST", path: "/tasks" },
        { method: "POST", path: "/tasks/{id}/done" },
    ],
});

export const url = api.url;   // https://abc123.execute-api.us-west-2.amazonaws.com/dev
```

The handler receives API Gateway **v2 (payload format 2.0)** events. Route on
`event.routeKey` (e.g. `"POST /tasks/{id}/done"`); path variables are on
`event.pathParameters`. CORS preflight is handled by the API — handlers don't
need to emit CORS headers or an OPTIONS route. On the Node.js 18 runtime the AWS
SDK v3 is preinstalled, so a plain `index.js` needs no bundled dependencies.

To grant additional permissions (e.g. SES send), pass `inlinePolicy` or attach a
policy to the exposed `executionRoleName`.

## Inputs

| Name           | Type                       | Required | Description |
| -------------- | -------------------------- | -------- | ----------- |
| `code`         | `pulumi.asset.Archive`     | yes      | Lambda deployment package. |
| `handler`      | `string`                   | no       | Entrypoint (default `"index.handler"`). |
| `runtime`      | `string`                   | no       | Lambda runtime (default `"nodejs18.x"`). |
| `timeout`      | `number`                   | no       | Timeout in seconds (default `10`). |
| `memorySize`   | `number`                   | no       | Memory in MB. |
| `environment`  | `map<string>`              | no       | Environment variables. |
| `inlinePolicy` | `string`                   | no       | IAM policy JSON attached to the execution role. |
| `routes`       | `{ method, path }[]`       | yes      | Routes to expose. |
| `stageName`    | `string`                   | no       | Stage name (default `"api"`). |
| `allowOrigins` | `string[]`                 | no       | CORS allowed origins (default `["*"]`). |
| `tags`         | `map<string>`              | no       | Tags for created resources. |

## Outputs

| Name                | Type     | Description |
| ------------------- | -------- | ----------- |
| `url`               | `string` | Invoke URL including the stage (no trailing slash). |
| `apiId`             | `string` | The HTTP API's id. |
| `functionArn`       | `string` | ARN of the Lambda function. |
| `executionRoleName` | `string` | Name of the execution role (attach extra policies to it). |
