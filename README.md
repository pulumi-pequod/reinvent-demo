# re:Invent Demo — Task Tracker + Pulumi Agents + Pulumi Delivery

A serverless **task-tracker** app whose **"Remind"** button really tries to send
email through Amazon SES — and fails, because the app has no email
infrastructure. A Datadog monitor catches the error and triggers a **Pulumi
Agent**, which finds the org's approved **EmailSender** component in the private
registry, previews the fix against dev (where the guardrails **policy pack**
catches a missing tag and the agent fixes it), and opens a PR. After a human
merges, **Pulumi Delivery** ships it dev → staging → an approval gate → prod.

See **[RUNBOOK.md](./RUNBOOK.md)** for how to deploy, test, and record the demo.

## Layout

| Path | What it is | How it ships |
| --- | --- | --- |
| `setup/` | One-time Pulumi program that stages the demo environment: per-stage ESC environments (AWS OIDC + approvals), the Datadog monitor + agent webhook, the custom agent (identity + role + instructions), the guardrails policy group, and the approver team. | `pulumi up` once |
| `app/` | Task-tracker: a DynamoDB table assembled with the `LambdaApi` and `StaticWebsite` components. `/remind` really calls SES and fails until EmailSender is wired in. | `pulumi up` per stage |
| `components/serverless-api/` | `LambdaApi` component — IAM role + Lambda + API Gateway v2 HTTP API. | publish to the pequod registry |
| `components/static-website/` | `StaticWebsite` component — public S3 website bucket. | publish to the pequod registry |
| `components/ses/` | `EmailSender` component (verified SES sender + scoped send IAM policy). **Published but unused by the app** — the approved pattern the agent finds. | publish to the pequod registry |
| `policies/` | Guardrails policy pack: SES rules + the deterministic agent-trip tag rule + DynamoDB/tagging rules. Local tests in `policies/tests`. | `pulumi policy publish` |
| `delivery/` | The release pipeline (Pulumi Delivery): dev → staging → approval gate → prod. | `pulumi up` |

`setup/` is **staged setup** (deploy once); `app/`, `components/`, `policies/`,
and `delivery/` are the **demo code** that gets used and updated during the demo.

The app is built from custom components wherever possible — `LambdaApi` for the
API/compute and `StaticWebsite` for the UI. Only the DynamoDB table and the
handler code are app-specific. Each app stack imports its per-stage ESC
environment (`demo-access/aws-<stage>`) for short-lived AWS creds — no static
keys in this repo.

> **Why `/remind` fails.** The handler calls `ses:SendEmail` from an unverified
> address with no send permission on the Lambda role, so SES rejects it. The
> handler logs a structured `reminder_send_failed` error (which Datadog watches)
> and returns 502. Wiring in `EmailSender` — and tagging its send policy per the
> policy pack — is the fix.

> The Lambda handler is a plain `app/handler/index.js` (a code asset), not an
> inline callback — a published multi-language component can't receive a JS
> callback across the provider boundary. The Node.js 18 runtime ships the AWS
> SDK v3, so the handler needs no bundled dependencies.

## Requirements

- Pulumi CLI **v3.272.0+** (for Pulumi Delivery) on macOS or Linux.
- A pequod Pulumi Cloud org, a demo AWS account with per-stage OIDC roles, and a
  Datadog account. Pulumi Delivery and Pulumi Agents are in **public preview**.

## Quick local checks (no deploy)

```bash
cd policies && npm install && npm test   # policy unit tests
cd setup && npm install && npm run typecheck
```
