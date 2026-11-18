# re:Invent Demo — Task Tracker

Scaffolding for the re:Invent live demo. A serverless **task-tracker** app where
each task has a **"Remind"** button that emails the task's assignee through
Amazon SES using the `EmailSender` component.

## Layout

| Path            | What it is | How it ships |
| --------------- | ---------- | ------------ |
| `app/`          | Task-tracker: a DynamoDB table assembled with the `LambdaApi` and `StaticWebsite` components. The Lambda handler lives in `app/handler/`. `/remind` sends a reminder email via SES. | `pulumi up` per stage |
| `components/serverless-api/`| `LambdaApi` component — IAM role + Lambda + API Gateway v2 HTTP API. | **publish to the pequod registry** (`pulumi package publish`) |
| `components/static-website/`| `StaticWebsite` component — public S3 website bucket serving an index document. | **publish to the pequod registry** (`pulumi package publish`) |
| `components/ses/`| `EmailSender` component (verified SES sender + scoped send IAM policy). | **publish to the pequod registry** (`pulumi package publish`) |
| `policies/`     | Guardrails policy pack (DynamoDB PITR + on-demand billing + required tags). | `--policy-pack` on preview/up |

The app is built from custom components wherever possible — `LambdaApi` for the
API/compute, `StaticWebsite` for the UI, and `@pulumi-pequod/stackmgmt`
(`StackSettings`) for stack settings. Only the DynamoDB table (the data model)
and the handler code remain app-specific. Each app stack imports the existing
`cloud-access/aws-access` ESC environment for AWS creds — no static keys in this
repo.

> **Component references.** The app consumes the components by local path in its
> `packages:` block (`../components/serverless-api`, `../components/static-website`),
> matching how pequod consumes components (source-based, via path or GitHub URL —
> not a registry string). `pulumi install` generates the local SDKs, imported as
> `@pulumi/serverless-api` and `@pulumi/static-website`. The `pulumi package
> publish` commands below still publish them to the registry for the catalog.

> The Lambda handler is a plain `app/handler/index.js` (a code asset), not an
> inline `CallbackFunction` — a published multi-language component can't receive
> a JS callback across the provider boundary. The Node.js 18 runtime ships the
> AWS SDK v3, so the handler needs no bundled dependencies.

## Run order

```bash
# 1. The app (dev stack imports cloud-access/aws-access for AWS creds)
cd app && pulumi install && pulumi stack init pequod/reinvent-tasks/dev && pulumi up

# 2. Try it
open "$(pulumi stack output siteUrl)"            # static task UI
curl "$(pulumi stack output apiUrl)/tasks"       # -> []
curl -X POST "$(pulumi stack output apiUrl)/remind" -d '{"taskId":"<task id>"}'   # -> 200 (email sent)

# 3. (optional) run with guardrails
pulumi preview --policy-pack ../policies
```

## Email reminders

`POST /remind` with `{ "taskId": "..." }` looks up the task and emails its
`assigneeEmail` through SES (`200` on success). A task with no (or an invalid)
assignee email returns `422` with a clear message; an unknown task returns `404`.

Stack config (set per stack, or via ESC `pulumiConfig`):

| Key | Required | Description |
| --- | -------- | ----------- |
| `reinvent-tasks:senderEmail` | yes | "From" address for reminders. |
| `reinvent-tasks:verifySenderAddress` | no (default `true`) | `true` creates an SES email identity for `senderEmail` (SES emails it a confirmation link). Set `false` when the sender's domain is already a verified SES identity. |

The Lambda role gets `ses:SendEmail`/`ses:SendRawEmail` scoped to the sender's
SES identity only. **SES sandbox:** if the account is still in the sandbox, SES
rejects mail to unverified recipients (the API returns `502` with an explanatory
message); verify the recipient addresses or request SES production access.

## Publishing the components

```bash
# SES EmailSender
cd components/ses && npm install
pulumi package publish . --publisher pequod

# Serverless API (LambdaApi)
cd ../serverless-api && npm install
pulumi package publish . --publisher pequod

# Static Website
cd ../static-website && npm install
pulumi package publish . --publisher pequod
```
