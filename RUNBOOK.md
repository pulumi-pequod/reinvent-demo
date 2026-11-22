# re:Invent Demo Runbook

A ~4-minute live demo: the task-tracker app can't send reminder emails, Datadog
catches the error and triggers a **Pulumi Agent**, the agent finds the approved
**EmailSender** component in the private registry, previews the fix against dev
(where the **policy pack** catches a missing tag and the agent fixes it), and
opens a PR. After a human merges, **Pulumi Delivery** ships it dev → staging →
**approval gate** → prod, and the Datadog error clears.

This runbook covers **Deploy**, **Test**, and **Record**. There is no
reset-between-runs flow — the demo is pre-baked and shown from a known-good
state (see [Between runs](#between-runs)).

> Conventions: org is **pequod**. Everything runs in Pulumi Cloud (pequod) and
> the demo AWS account(s). Pulumi Delivery and Pulumi Agents are in **public
> preview**. Requires **Pulumi CLI v3.272.0+** on macOS or Linux.

---

## Repository layout

| Path | What it is | Staged vs. demo |
| --- | --- | --- |
| `setup/` | One-time Pulumi program that stages the whole environment (ESC, Datadog, agent, policy group, approvers). | **Staged setup** — deploy once. |
| `app/` | The task-tracker app. `/remind` really calls SES and fails until EmailSender is wired in. | **Demo code** — changes during the demo. |
| `components/ses/` | The approved `EmailSender` component (verified SES sender + scoped send policy). Published, unused by the app. | **Demo code** — what the agent finds. |
| `components/serverless-api/`, `components/static-website/` | `LambdaApi` and `StaticWebsite` components the app is built from. | **Demo code** — published to the registry. |
| `policies/` | Guardrails policy pack with SES rules and the deterministic agent-trip tag rule. | **Demo code** — runs in the preview. |
| `delivery/` | The release pipeline as a Pulumi program (dev → staging → gate → prod). | **Demo code.** |

---

## Prerequisites

- **Pulumi CLI v3.272.0+** (`pulumi version`), logged in to the **pequod** org.
- **Node 18+** and **npm**.
- **AWS**: a demo account (or accounts) with an IAM role per stage that trusts
  Pulumi Cloud's OIDC issuer. ESC assumes `arn:aws:iam::<account>:role/pulumi-esc-<stage>`
  (override names/accounts via `setup/` config). The role needs permissions to
  create the app's resources (Lambda, API Gateway, DynamoDB, S3, IAM, SES).
- **Datadog**: an account with log ingestion from the app's Lambda (CloudWatch →
  Datadog log forwarder), plus an API key and application key.
- **GitHub**: write access to `pulumi-pequod/reinvent-demo` (the agent opens PRs
  against `main`; the pipeline releases from `main`).
- Two real Pulumi Cloud users to act as **approvers** (the person who starts a
  pipeline run can't approve it).

---

## Deploy

Deploy order: **publish components → publish policy pack → setup → console
SaaS-only steps → app stacks → pipeline**.

### 1. Publish the registry components

```bash
cd components/ses && npm install && pulumi package publish . --publisher pequod
cd ../serverless-api && npm install && pulumi package publish . --publisher pequod
cd ../static-website && npm install && pulumi package publish . --publisher pequod
```

The app consumes `serverless-api` and `static-website`. `EmailSender` is
published so it shows up in the registry catalog for the agent to find — **do
not** wire it into the app.

### 2. Publish the policy pack

```bash
cd policies && npm install && npm test        # 10 local tests, all pass
pulumi policy publish pequod                  # publishes reinvent-demo-guardrails
```

Note the published **version** (e.g. `0.2.0`); `setup/` references it via
`reinvent-setup:policyPackVersion` (default `0.2.0`).

### 3. Deploy `setup/`

This stages ESC, the Datadog monitor + webhook, the policy group, the agent, and
the approver team.

```bash
cd setup && npm install
pulumi stack init pequod/reinvent-setup/setup

# Required config — replace with the real demo account id and approvers:
pulumi config set awsAccount <DEMO_AWS_ACCOUNT_ID>
pulumi config set --path approvers[0] <approver-1-login>
pulumi config set --path approvers[1] <approver-2-login>
```

Secrets (Datadog keys, the Pulumi trigger secret) come from an **ESC
environment**, not the CLI. Create `demo-secrets/reinvent` with:

```yaml
values:
  pulumiConfig:
    reinvent-setup:datadogApiKey:
      fn::secret: <DD_API_KEY>
    reinvent-setup:datadogAppKey:
      fn::secret: <DD_APP_KEY>
    # Filled in after step 4 (the Pulumi webhook automation mints these):
    reinvent-setup:pulumiTriggerSecret:
      fn::secret: <PULUMI_TRIGGER_SECRET>
```

`setup/Pulumi.setup.yaml` already imports `demo-secrets/reinvent`. Then:

```bash
pulumi up
```

This creates:
- ESC environments `demo-access/aws-dev`, `aws-staging`, `aws-prod` (AWS OIDC,
  short-lived creds). `aws-staging` and `aws-prod` get an **ApprovalRule** on
  updates.
- The **Datadog log monitor** on `reminder_send_failed` and the **Datadog
  webhook** `reinvent-agent`.
- The **policy group** `reinvent-demo` binding the guardrails pack to the
  `reinvent-tasks` dev/staging/prod stacks.
- The **agent** `reinvent-email-troubleshooter` (its own identity + a
  least-privilege role that can preview dev but not deploy or approve).
- The **approver team** `reinvent-approvers`.

### 4. Console steps (SaaS-only — can't be code yet)

These are not in the Pulumi Cloud provider. Do them once in the console and put
the resulting values back into config/ESC:

1. **Agent Datadog integration + credentials.** In Pulumi Cloud → Agents →
   Integrations, add the **Datadog** MCP integration and its credentials (the
   webhook only delivers the event; the agent needs its own read access to
   Datadog to investigate). Copy the integration id into
   `reinvent-setup:datadogIntegrationId` and re-run `pulumi up` in `setup/` so
   it's enabled on the agent.
2. **Datadog webhook automation (the trigger).** In Pulumi Cloud → Agents, create
   a **webhook automation with the Datadog preset** targeting the
   `reinvent-email-troubleshooter` agent. This mints the **trigger URL** and
   **trigger secret**. Put the URL in `reinvent-setup:pulumiTriggerUrl` and the
   secret in the `demo-secrets/reinvent` ESC environment, then re-run `pulumi up`
   in `setup/` so the Datadog webhook points at the trigger with the right
   header.
3. **(Optional) ESC credential-open approval.** The provider's `ApprovalRule`
   gates environment *updates*. If you also want staging/prod credential *opens*
   to require approval, enable it on those environments in the ESC console. The
   agent only ever opens `aws-dev`, so this never blocks the demo.

### 5. Deploy the app stacks

```bash
cd app && pulumi install
for s in dev staging prod; do
  pulumi stack init pequod/reinvent-tasks/$s
  pulumi stack select pequod/reinvent-tasks/$s
  pulumi up --yes
done
```

Each stack imports its matching ESC environment (`demo-access/aws-<stage>`). At
this point `/remind` is genuinely broken on every stage.

### 6. Deploy the pipeline

```bash
cd delivery && pulumi install     # runs `pulumi package add delivery`
pulumi stack init pequod/reinvent-delivery/main
pulumi up --yes                   # registers the pipeline; waits if a gate holds
```

---

## Test

Confirm each stage of the flow works. Good result in **bold**; what to check if
it doesn't in _italics_.

### Pre-flight (before going live)

```bash
# AWS creds resolve through ESC (no static keys):
cd app && pulumi stack select pequod/reinvent-tasks/dev
pulumi env open demo-access/aws-dev           # prints short-lived AWS creds + region

# A dev preview runs and the policy pack is attached:
pulumi preview --policy-pack ../policies      # or rely on the policy group
```
**Preview succeeds and the guardrails pack reports on the stack.** _If creds
fail, check the OIDC role trust and `awsAccount` config. If the pack doesn't
appear, confirm the policy group (`setup/`) and that the pack is published._

### 1. Trigger the error

Open the dev site and click **Remind** on a task (or curl it):

```bash
curl -i -X POST "$(pulumi stack output apiUrl)/remind" -d '{"taskId":"<id>"}'
```
**HTTP 502**, body `"status":"send-failed"`, and a structured
`reminder_send_failed` line in the Lambda logs. _If you get 200, the fix is
still deployed — redeploy the broken `app/` (see [Between runs](#between-runs))._

### 2. Datadog fires and triggers the agent

**Within ~1–5 min the monitor "reinvent-tasks: reminder email failed to send"
goes ALERT and calls `@webhook-reinvent-agent`; a new task appears under the
`reinvent-email-troubleshooter` agent in Pulumi Cloud.** _If the monitor doesn't
fire, confirm logs are reaching Datadog (`service:reinvent-tasks
@event:reminder_send_failed`). If it fires but no agent task starts, re-check the
webhook URL/secret and that the monitor message contains `@webhook-reinvent-agent`._

### 3. The agent investigates and previews

**The agent reads the alert and the failing stack, identifies the architectural
gap (no email infrastructure), finds `EmailSender` in the registry, wires it in,
opens the dev ESC env, and runs `pulumi preview` on `reinvent-tasks/dev`.** _If
it can't preview, confirm the agent role has `environment:open` on `aws-dev` and
`stack:read`._

### 4. The policy catch and fix

**The dev preview reports the mandatory `require-email-compliance-tag`
violation; the agent adds `tags: { "data-classification": "restricted" }` to the
EmailSender inputs and re-previews clean.** This is the deterministic catch — the
message names exactly what to add. _If it doesn't trip, confirm the policy group
is enabled on the dev stack and the pack version matches._

### 5. The PR opens

**One PR against `main` with: a plain-language root cause (the app had no email
infrastructure), the reused component, the policy violation fixed and how, and
the clean preview summary.** _If no PR, check the agent's GitHub access._

### 6. Pipeline reaches the prod gate

Merge the PR (a human). **Pulumi Delivery cuts a release: dev succeeds, staging
succeeds, then the run holds at the prod approval gate showing the prod preview.
A second person (not the run-starter) approves; prod deploys and the Datadog
monitor recovers to OK.** _If the gate lets the starter approve, confirm
`delivery.approval({ approvers })` lists people other than whoever started the
run._

---

## Between runs

The demo is **pre-baked** — shown from a known-good staged state, not reset live.
To re-arm it for another take, restore the broken baseline and redeploy:

```bash
# app/ broken again (the merged fix wires in EmailSender; revert it):
git checkout <broken-baseline-commit> -- app/
cd app && for s in dev staging prod; do
  pulumi stack select pequod/reinvent-tasks/$s && pulumi up --yes
done
```

Then click **Remind** once to let the monitor transition OK → ALERT fresh. (If a
prior alert is still open in Datadog, unmute the monitor so the next failure is a
clean transition.) Keep the pre-fix commit hash handy as the baseline.

---

## Record (fallback video)

Capture the full flow as a backup for the booth laptop.

**Set up on screen (one 1080p display, hidden bookmarks bar):**
- Browser tabs in order: (1) the dev task-tracker site, (2) Datadog → the
  monitor, (3) Pulumi Cloud → the agent, (4) GitHub → the repo PRs, (5) Pulumi
  Cloud → the delivery pipeline run.
- A terminal in `app/` for the curl, large font.
- Pre-stage everything deployed and broken; have the broken baseline checked out.

**Beats (what each should show):**
1. **The failure (0:00–0:30).** Click Remind on the app → toast "Could not send
   the reminder email." Show the 502 + the structured log line.
2. **Datadog catches it (0:30–1:00).** Cut to the monitor going ALERT; point out
   `@webhook-reinvent-agent`.
3. **The agent investigates (1:00–2:00).** Cut to the new agent task; show it
   finding `EmailSender` in the registry (not writing SES from scratch) and
   opening the dev ESC env for a preview.
4. **Policy catch + fix (2:00–2:45).** Show the `require-email-compliance-tag`
   violation in the preview and the agent adding the `data-classification` tag,
   then a clean re-preview.
5. **The PR (2:45–3:15).** Show the opened PR: root cause, reused component,
   policy fix, preview summary. A human merges.
6. **Delivery ships it (3:15–4:00).** Show the pipeline: dev ✓, staging ✓, hold
   at the prod gate with the preview, a second person approves, prod ✓.
7. **Resolution.** Cut back to Datadog recovering to OK.

**Tips for a clean take:**
- Do a dry run first; agent/preview timing varies — record the agent portion
  live, or capture a known-good run and narrate over it.
- Pre-warm the Lambda and Datadog ingestion so the alert fires promptly.
- Hide secrets: don't show the trigger secret, Datadog keys, or raw ESC opens on
  camera.
- Record each tab's section separately and stitch if a single take drifts past 4
  minutes — the beats above are the cut points.
