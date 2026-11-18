# SES EmailSender

A Pulumi component that sets up Amazon SES for sending transactional email and
hands back a least-privilege IAM policy a compute role (e.g. a Lambda) can attach
to gain send access.

It creates:

- A verified **SES email identity** for the sender address (and, optionally, a
  verified **domain identity**).
- An optional **configuration set** for open/click/bounce event tracking.
- An **IAM managed policy** granting `ses:SendEmail` / `ses:SendRawEmail` scoped
  to the verified identity.

The component does **not** grant send access to anything itself — the consumer
attaches `sendPolicyArn` to whichever principal should be allowed to send.

## Usage

```ts
import { EmailSender } from "@pulumi-pequod/ses";

const sender = new EmailSender("reminders", {
    senderEmail: "reminders@example.com",
    // domain: "example.com",                 // optional domain identity
    // configurationSetName: "reminders-set",  // optional event tracking
});

// Attach send permissions to a Lambda role:
new aws.iam.RolePolicyAttachment("lambda-ses", {
    role: lambdaRole.name,
    policyArn: sender.sendPolicyArn,
});
```

## Inputs

| Name                   | Type      | Required | Description |
| ---------------------- | --------- | -------- | ----------- |
| `senderEmail`          | `string`  | yes      | The "from" address. In the SES sandbox this (and recipients) must be confirmed before sending. |
| `verifySenderAddress`  | `boolean` | no       | Default `true`: verify `senderEmail` as a new identity (emails a link to it). Set `false` when the sender's domain is already a verified SES identity — no per-address identity is created, nothing goes "Pending", and the send policy is scoped to the domain. Use for send-only domains you can't receive mail at. |
| `domain`               | `string`  | no       | Domain to additionally verify as a sending identity (enables per-domain DKIM). |
| `configurationSetName` | `string` | no       | Creates a dedicated SES configuration set for event tracking. |
| `tags`                 | `map`    | no       | Tags applied to the IAM send policy. |

## Outputs

| Name                   | Type     | Description |
| ---------------------- | -------- | ----------- |
| `senderIdentityArn`    | `string` | ARN of the verified sender email identity. |
| `senderEmail`          | `string` | The verified sender email address. |
| `sendPolicyArn`        | `string` | ARN of the IAM managed policy granting scoped SES send permissions. |
| `configurationSetName` | `string` | Name of the configuration set, if one was created. |
