# re:Invent Demo — Task Tracker

Scaffolding for the re:Invent live demo. A serverless **task-tracker** app where
each task has a **"Remind"** button. Email is deliberately **not** wired up yet —
implementing the reminder with the SES component is the live **Pulumi Neo** moment.

## Layout

| Path            | What it is | How it ships |
| --------------- | ---------- | ------------ |
| `app/`          | Task-tracker: API Gateway + Lambda + DynamoDB + static S3 web UI. `/remind` is a 501 stub. | `pulumi up` per stage |
| `components/ses/`| `EmailSender` component (verified SES sender + scoped send IAM policy). | **publish to the pequod registry** (`pulumi package publish`) |
| `policies/`     | Guardrails policy pack (DynamoDB PITR + on-demand billing + required tags). | `--policy-pack` on preview/up |

Reuses `@pulumi-pequod/stackmgmt` (`StackSettings`). Each app stack imports the
existing `cloud-access/aws-access` ESC environment for AWS creds — no static keys
in this repo.

## Run order

```bash
# 1. The app (dev stack imports cloud-access/aws-access for AWS creds)
cd app && npm install && pulumi stack init pequod/reinvent-tasks/dev && pulumi up

# 2. Try it
open "$(pulumi stack output siteUrl)"            # static task UI
curl "$(pulumi stack output apiUrl)/tasks"       # -> []
curl -X POST "$(pulumi stack output apiUrl)/remind" -d '{"taskId":"x"}'   # -> 501 (Neo demo)

# 3. (optional) run with guardrails
pulumi preview --policy-pack ../policies
```

## The Neo demo moment

`POST /remind` returns `501 not-implemented`. On stage, Neo:

1. Publishes / imports the SES `EmailSender` component.
2. Instantiates it in `app/index.ts` with the verified `senderEmail`.
3. Attaches `sender.sendPolicyArn` to the Lambda role (marked `NOTE(neo)` in the code).
4. Replaces the `/remind` stub with a real `SendEmail` call to `task.assigneeEmail`.

See the `TODO(neo)` / `NOTE(neo)` markers in `app/index.ts`.

## Publishing the SES component

```bash
cd components/ses && npm install
pulumi package publish .    # publishes to the pequod private registry
```
