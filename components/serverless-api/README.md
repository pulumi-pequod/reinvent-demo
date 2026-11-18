# Serverless API (LambdaApi)

A Pulumi component that fronts a Lambda with an **API Gateway v2 HTTP API**:
one `AWS_PROXY` integration, one route per `{method, path}`, a deployed stage,
CORS, and the invoke permission. Built on the base `@pulumi/aws` provider — no
crosswalk packages.

## Usage

```ts
import { LambdaApi } from "@pulumi-pequod/serverless-api";

const api = new LambdaApi("tasks-api", {
    handler: myLambda,             // aws.lambda.Function / CallbackFunction
    stageName: "dev",
    routes: [
        { method: "GET",  path: "/tasks" },
        { method: "POST", path: "/tasks" },
        { method: "POST", path: "/tasks/{id}/done" },
    ],
});

export const url = api.url;        // e.g. https://abc123.execute-api.us-west-2.amazonaws.com/dev
```

The handler receives API Gateway **v2 (payload format 2.0)** events. Route on
`event.routeKey` (e.g. `"POST /tasks/{id}/done"`); path variables are on
`event.pathParameters`. CORS preflight is handled by the API — handlers don't
need to emit CORS headers or an OPTIONS route.

## Inputs

| Name           | Type                    | Required | Description |
| -------------- | ----------------------- | -------- | ----------- |
| `handler`      | `aws.lambda.Function`   | yes      | The Lambda all routes proxy to. |
| `routes`       | `{ method, path }[]`    | yes      | Routes to expose. |
| `stageName`    | `string`                | no       | Stage name (default `"api"`). |
| `allowOrigins` | `string[]`              | no       | CORS allowed origins (default `["*"]`). |
| `tags`         | `map`                   | no       | Tags for the API and stage. |

## Outputs

| Name    | Type     | Description |
| ------- | -------- | ----------- |
| `url`   | `string` | Invoke URL including the stage (no trailing slash). |
| `apiId` | `string` | The HTTP API's id. |
