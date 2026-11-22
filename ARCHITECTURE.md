# Architecture — visual walkthrough

A picture-first tour of what's in this repo and how the demo flows. Pair it with
[RUNBOOK.md](./RUNBOOK.md) (how to deploy/test/record) and
[README.md](./README.md) (layout).

---

## 1. Two kinds of code: staged setup vs. demo code

Everything splits into **staged setup** (deployed once, then left alone) and
**demo code** (what gets used and changed live on stage).

```
reinvent-demo/
│
├─ STAGED SETUP  ── one program, one stack, one `pulumi up` ────────┐
│   setup/index.ts    composes four LOCAL COMPONENTS:               │
│     components/                                                    │
│     ├─ datadogAlerting.ts    • Datadog monitor + webhook          │
│     ├─ troubleshooterAgent.ts• the custom Pulumi Agent (id +      │
│     │                           role + instructions)              │
│     ├─ guardrailsPolicy.ts   • policy group (turns the pack on)   │
│     └─ approverTeam.ts       • the approver team                  │
│                                                                   │
├─ DEMO CODE  ── what the audience sees and the agent changes ──────┤
│   app/              The broken task-tracker app (/remind fails)   │
│   components/ses/   EmailSender — the approved fix, sitting       │
│                       UNUSED in the registry for the agent to find│
│   components/        LambdaApi + StaticWebsite (app is built from  │
│     serverless-api/    these)                                     │
│     static-website/                                               │
│   policies/         Guardrails pack (+ local tests)               │
│   delivery/         The release pipeline, as a Pulumi program     │
└───────────────────────────────────────────────────────────────────┘
```

**Why the split matters for the demo:** the broken app and the unused
EmailSender component are deliberate. The agent's whole job is to *discover* that
EmailSender already exists and wire it in — so it must be published but not used.

---

## 2. The live demo — end to end

The story in six beats. Red = broken, green = fixed, blue = a human.

```
         ┌──────────────┐
  (1)    │  Task-tracker│   click "Remind"
  USER ─►│     app      │─────────────┐
         │  /remind     │             ▼
         └──────────────┘      ┌───────────────┐
                               │  Lambda calls │  ✗ no SES identity
                               │  ses:SendEmail│  ✗ no send permission
                               └───────┬───────┘
                                       │ logs {event:"reminder_send_failed"}
                                       ▼
  (2)                          ┌───────────────┐
  DATADOG catches the error ──►│ log monitor   │
                               │ fires webhook │──► @webhook-reinvent-agent
                               └───────┬───────┘
                                       ▼
  (3)                          ┌─────────────────────────────┐
  PULUMI AGENT investigates    │ • reads the alert + stack   │
                               │ • root cause: no email infra│
                               │ • searches registry ───────►│ finds EmailSender
                               │ • opens cloud-access/aws-   │   (doesn't write
                               │   access, runs `preview` on │    SES from scratch)
                               │   reinvent-tasks/dev        │
                               └──────────────┬──────────────┘
                                              ▼
  (4)                          ┌─────────────────────────────┐
  POLICY PACK runs in preview  │ ✗ require-email-compliance- │
                               │   tag  (mandatory)          │
                               │ agent reads the message,    │
                               │ adds data-classification tag│──► preview is clean
                               └──────────────┬──────────────┘
                                              ▼
  (5)                          ┌─────────────────────────────┐
  AGENT opens ONE PR  ────────►│ root cause (plain language) │
                               │ reused component            │
                               │ policy fix                  │
                               │ clean preview summary       │
                               └──────────────┬──────────────┘
                                              ▼
  (6)      👤 a human MERGES the PR
                                              ▼
  DELIVERY  dev ─► staging ─► ╔═══════════╗ ─► prod
            ✓      ✓          ║ PROD GATE ║     ✓   ──► Datadog clears
                              ║ 👤 approve║
                              ╚═══════════╝
                   (the person who started the run can't approve it)
```

---

## 3. What's actually deployed in AWS (the app)

The app is assembled from registry components, not raw resources. Only the
DynamoDB table and the handler are app-specific.

```
                 ┌────────────────────── app/ (reinvent-tasks) ──────────────────────┐
                 │                                                                     │
  Browser ─────► │  StaticWebsite        LambdaApi                    DynamoDB         │
  (task UI)      │  ┌───────────┐        ┌──────────────────────┐     ┌────────────┐  │
                 │  │ S3 bucket │        │ API Gateway v2       │     │ tasks      │  │
                 │  │ index.html│        │   /tasks  /remind    │     │ table      │  │
                 │  └───────────┘        │ Lambda (handler/)    │────►│ (PITR on,  │  │
                 │                       │ IAM role:            │     │  on-demand)│  │
                 │                       │  ✓ dynamodb:*Item    │     └────────────┘  │
                 │                       │  ✗ ses:SendEmail  ◄──┼──── THE GAP          │
                 │                       └──────────────────────┘                      │
                 └─────────────────────────────────────────────────────────────────────┘
                                                 │
  creds: cloud-access/aws-access (ESC, OIDC) ────┘   short-lived, no static keys
```

**The fix the agent proposes** adds the missing piece:

```
      components/ses/  EmailSender  (already published, the agent wires it in)
      ┌─────────────────────────────────────────────┐
      │ aws.ses.EmailIdentity   (verified sender)    │
      │ aws.iam.Policy  sendPolicy                    │
      │   Action:  ses:SendEmail, ses:SendRawEmail    │  ◄── scoped, explicit
      │   Resource: arn:...:identity/<verified domain>│  ◄── not "*"
      │   tags:    { data-classification: restricted }│  ◄── the policy fix
      └───────────────────────────────────────────────┘
                 │ sendPolicyArn attached to the Lambda role
                 ▼
            /remind now succeeds
```

---

## 4. The policy pack — a visible, deterministic catch

The pack mixes **mandatory** (blocks) and **advisory** (warns) rules. One rule is
engineered so the agent's *first* wiring always trips it — same catch every demo.

```
  policies/  reinvent-demo-guardrails
  ┌───────────────────────────────────────────────────────────────────────┐
  │ RULE                             LEVEL      ON                          │
  │ ───────────────────────────────  ─────────  ─────────────────────────  │
  │ ses-no-wildcard-send             mandatory  IAM policy (no ses:* )      │
  │ ses-send-scoped-to-identity      mandatory  IAM policy (no Resource *)  │
  │ require-email-compliance-tag ◄── mandatory  IAM policy (SES send) ──────┼─ THE CATCH
  │ dynamodb-pitr-enabled            mandatory  DynamoDB table              │
  │ dynamodb-pay-per-request         advisory   DynamoDB table              │
  │ require-project-tags             advisory   any tagged resource         │
  └───────────────────────────────────────────────────────────────────────┘

  Why the catch is reliable:
     EmailSender tags its send policy with ONLY what the caller passes.
     The agent's first draft passes the app's base tags → no data-classification
     → rule trips → message says exactly what to add → agent adds one tag → clean.

  Proven both ways by policies/tests  (npm test → 10/10 pass)
```

---

## 5. The delivery pipeline (delivery/)

A Pulumi program *is* the pipeline. One release moves through all stages from the
same commit.

```
   merge to main (touching app/** or delivery/**)
        │
        ▼
   ┌─────────┐      ┌──────────┐      ╔════════════════╗      ┌─────────┐
   │  dev    │ ───► │ staging  │ ───► ║  approval gate ║ ───► │  prod   │
   │ up+smoke│      │ up+smoke │      ║  named approver║      │up+smoke │
   └─────────┘      └──────────┘      ║  ≠ run starter ║      └─────────┘
                                      ╚════════════════╝
   delivery.Stage   delivery.Stage    delivery.approval()    delivery.Stage
   + delivery.Stacks + delivery.Job                          (from: staging)
```

---

## 6. Who the agent is (and what it deliberately can't do)

Least privilege, as code. The guardrails aren't a prompt — they're the role.

```
   setup/components/troubleshooterAgent.ts   reinvent-app-troubleshooter
   ┌───────────────────────────────────────────────────────────────┐
   │ IDENTITY   its own agent identity (not a human's)              │
   │ ROLE       OrganizationRole, built from explicit scopes:       │
   │   ✓ resources:search            (find things)                  │
   │   ✓ stack:read, stack:export    (read state + history)         │
   │   ✓ environment:read/open  on   cloud-access/aws-access only   │
   │   ✗ stack:write        ──────── CANNOT deploy (no pulumi up)   │
   │   ✗ approve            ──────── CANNOT approve its own fix      │
   │ INSTRUCTIONS  investigate → find approved pattern → test on    │
   │               dev → open ONE PR.  Never deploy.                 │
   └───────────────────────────────────────────────────────────────┘

   SaaS-only (set up in the console, see RUNBOOK):
     • the agent's Datadog integration + credentials (to read the alert)
     • the Datadog webhook automation that triggers it
```
