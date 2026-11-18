import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface StaticWebsiteArgs {
    /** Contents of the index document (e.g. rendered index.html). */
    content: pulumi.Input<string>;
    /** Index document key. Defaults to "index.html". */
    indexDocument?: string;
    /** Content type for the index document. Defaults to "text/html". */
    contentType?: pulumi.Input<string>;
    /** Tags applied to the bucket. */
    tags?: pulumi.Input<{ [key: string]: pulumi.Input<string> }>;
}

/**
 * StaticWebsite provisions a public S3 website bucket and uploads a single index
 * document. It bundles the bucket, website configuration, ownership controls,
 * public-access settings, the public-read bucket policy, and the index object so
 * callers don't repeat that boilerplate.
 */
export class StaticWebsite extends pulumi.ComponentResource {
    /** URL of the index document via the bucket's regional domain. */
    public readonly url: pulumi.Output<string>;
    /** The S3 static website hosting endpoint. */
    public readonly websiteEndpoint: pulumi.Output<string>;
    /** The bucket name. */
    public readonly bucketName: pulumi.Output<string>;

    constructor(name: string, args: StaticWebsiteArgs, opts?: pulumi.ComponentResourceOptions) {
        super("pequod-static-website:index:StaticWebsite", name, args, opts);

        const o = { parent: this };
        const indexDocument = args.indexDocument ?? "index.html";

        const bucket = new aws.s3.BucketV2(`${name}-bucket`, {
            tags: args.tags,
        }, o);

        new aws.s3.BucketWebsiteConfigurationV2(`${name}-web`, {
            bucket: bucket.id,
            indexDocument: { suffix: indexDocument },
        }, o);

        const ownership = new aws.s3.BucketOwnershipControls(`${name}-ownership`, {
            bucket: bucket.id,
            rule: { objectOwnership: "BucketOwnerPreferred" },
        }, o);

        const publicAccess = new aws.s3.BucketPublicAccessBlock(`${name}-access`, {
            bucket: bucket.id,
            blockPublicAcls: false,
            blockPublicPolicy: false,
            ignorePublicAcls: false,
            restrictPublicBuckets: false,
        }, o);

        // Allow public reads so the static site is browsable.
        new aws.s3.BucketPolicy(`${name}-policy`, {
            bucket: bucket.id,
            policy: bucket.arn.apply((arn) => JSON.stringify({
                Version: "2012-10-17",
                Statement: [{
                    Effect: "Allow",
                    Principal: "*",
                    Action: ["s3:GetObject"],
                    Resource: `${arn}/*`,
                }],
            })),
        }, { ...o, dependsOn: [publicAccess] });

        new aws.s3.BucketObject(`${name}-index`, {
            bucket: bucket.id,
            key: indexDocument,
            content: args.content,
            contentType: args.contentType ?? "text/html",
        }, { ...o, dependsOn: [ownership, publicAccess] });

        const region = aws.getRegionOutput({}, o).name;

        this.bucketName = bucket.bucket;
        this.url = pulumi.interpolate`http://${bucket.bucketRegionalDomainName}/${indexDocument}`;
        this.websiteEndpoint = pulumi.interpolate`http://${bucket.bucket}.s3-website-${region}.amazonaws.com`;

        this.registerOutputs({
            url: this.url,
            websiteEndpoint: this.websiteEndpoint,
            bucketName: this.bucketName,
        });
    }
}
