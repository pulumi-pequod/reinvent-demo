import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface EmailSenderArgs {
    /**
     * The email address that reminders are sent "from". SES verifies this
     * identity; in the SES sandbox the address must be confirmed before it can
     * send, and recipients must also be verified.
     */
    senderEmail: pulumi.Input<string>;
    /**
     * Optional domain to additionally verify as a sending identity (enables
     * per-domain DKIM and sending from any address at that domain).
     */
    domain?: pulumi.Input<string>;
    /**
     * Optional name for a dedicated SES configuration set (open/click/bounce
     * event tracking). A set is only created when a name is supplied.
     */
    configurationSetName?: pulumi.Input<string>;
    /**
     * Tags applied to the IAM send policy.
     */
    tags?: pulumi.Input<{ [key: string]: pulumi.Input<string> }>;
}

/**
 * EmailSender wires up everything needed to send transactional email through
 * Amazon SES and hands back an IAM policy that a compute role (e.g. a Lambda)
 * can attach to gain least-privilege send access.
 *
 * It intentionally does NOT grant send access to anything itself — the consumer
 * attaches `sendPolicyArn` to whatever principal should be allowed to send.
 */
export class EmailSender extends pulumi.ComponentResource {
    /** ARN of the verified sender email identity. */
    public readonly senderIdentityArn: pulumi.Output<string>;
    /** The verified sender email address. */
    public readonly senderEmail: pulumi.Output<string>;
    /** ARN of an IAM managed policy granting scoped SES send permissions. */
    public readonly sendPolicyArn: pulumi.Output<string>;
    /** Name of the configuration set, if one was created. */
    public readonly configurationSetName: pulumi.Output<string | undefined>;

    constructor(name: string, args: EmailSenderArgs, opts?: pulumi.ComponentResourceOptions) {
        super("pequod-ses:index:EmailSender", name, args, opts);

        const defaultOpts = { parent: this };

        // Verify the sender email address as an SES identity.
        const senderIdentity = new aws.ses.EmailIdentity(`${name}-sender`, {
            email: args.senderEmail,
        }, defaultOpts);

        // Optionally verify a whole domain as a sending identity.
        if (args.domain) {
            new aws.ses.DomainIdentity(`${name}-domain`, {
                domain: args.domain,
            }, defaultOpts);
        }

        // Optionally create a configuration set for event tracking.
        let configurationSet: aws.ses.ConfigurationSet | undefined;
        if (args.configurationSetName) {
            configurationSet = new aws.ses.ConfigurationSet(`${name}-configset`, {
                name: args.configurationSetName,
            }, defaultOpts);
        }

        // A least-privilege IAM policy that allows sending email only "from" the
        // verified identity. The consumer attaches this to its own role.
        const sendPolicy = new aws.iam.Policy(`${name}-send-policy`, {
            description: "Allow sending email through SES from the verified sender identity",
            policy: senderIdentity.arn.apply((identityArn) => JSON.stringify({
                Version: "2012-10-17",
                Statement: [
                    {
                        Effect: "Allow",
                        Action: ["ses:SendEmail", "ses:SendRawEmail"],
                        Resource: identityArn,
                    },
                ],
            })),
            tags: args.tags,
        }, defaultOpts);

        this.senderIdentityArn = senderIdentity.arn;
        this.senderEmail = pulumi.output(args.senderEmail);
        this.sendPolicyArn = sendPolicy.arn;
        this.configurationSetName = pulumi.output(configurationSet?.name);

        this.registerOutputs({
            senderIdentityArn: this.senderIdentityArn,
            senderEmail: this.senderEmail,
            sendPolicyArn: this.sendPolicyArn,
            configurationSetName: this.configurationSetName,
        });
    }
}
