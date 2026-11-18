import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface LambdaApiRoute {
    /** HTTP method, e.g. "GET" or "POST". */
    method: string;
    /** Route path, e.g. "/tasks" or "/tasks/{id}/done". */
    path: string;
}

export interface LambdaApiArgs {
    /** The Lambda deployment package (e.g. a FileArchive of the handler dir). */
    code: pulumi.Input<pulumi.asset.Archive>;
    /** Handler entrypoint. Defaults to "index.handler". */
    handler?: pulumi.Input<string>;
    /** Lambda runtime. Defaults to "nodejs18.x". */
    runtime?: pulumi.Input<string>;
    /** Function timeout in seconds. Defaults to 10. */
    timeout?: pulumi.Input<number>;
    /** Function memory in MB. */
    memorySize?: pulumi.Input<number>;
    /** Environment variables passed to the function. */
    environment?: pulumi.Input<{ [key: string]: pulumi.Input<string> }>;
    /**
     * An IAM policy JSON document attached inline to the execution role, for
     * app-specific grants (e.g. DynamoDB access). CloudWatch Logs access is
     * always granted.
     */
    inlinePolicy?: pulumi.Input<string>;
    /** The routes exposed by the API. */
    routes: LambdaApiRoute[];
    /** API Gateway stage name. Defaults to "api". */
    stageName?: pulumi.Input<string>;
    /** CORS allowed origins. Defaults to ["*"]. */
    allowOrigins?: pulumi.Input<string[]>;
    /** Tags applied to the created resources. */
    tags?: pulumi.Input<{ [key: string]: pulumi.Input<string> }>;
}

/**
 * LambdaApi provisions a complete serverless HTTP endpoint: an IAM execution
 * role (with CloudWatch Logs and optional app grants), a Lambda function, and an
 * API Gateway v2 HTTP API that routes to it (one AWS_PROXY integration, one
 * route per {method, path}, a deployed stage, CORS, and the invoke permission).
 * Built on the base `@pulumi/aws` provider — no crosswalk packages.
 *
 * The handler receives API Gateway v2 (payload format 2.0) events and should
 * route on `event.routeKey` (e.g. "POST /tasks/{id}/done"); path variables are
 * available on `event.pathParameters`. CORS preflight is handled by the API, so
 * handlers don't need to emit CORS headers or an OPTIONS route.
 */
export class LambdaApi extends pulumi.ComponentResource {
    /** Invoke URL including the stage (no trailing slash). */
    public readonly url: pulumi.Output<string>;
    /** The HTTP API's id. */
    public readonly apiId: pulumi.Output<string>;
    /** ARN of the created Lambda function. */
    public readonly functionArn: pulumi.Output<string>;
    /** Name of the Lambda execution role (attach extra policies to it). */
    public readonly executionRoleName: pulumi.Output<string>;

    constructor(name: string, args: LambdaApiArgs, opts?: pulumi.ComponentResourceOptions) {
        super("pequod-serverless-api:index:LambdaApi", name, args, opts);

        const o = { parent: this };
        const stageName = args.stageName ?? "api";

        // Execution role + baseline CloudWatch Logs access.
        const role = new aws.iam.Role(`${name}-role`, {
            assumeRolePolicy: JSON.stringify({
                Version: "2012-10-17",
                Statement: [{
                    Action: "sts:AssumeRole",
                    Effect: "Allow",
                    Principal: { Service: "lambda.amazonaws.com" },
                }],
            }),
            tags: args.tags,
        }, o);

        new aws.iam.RolePolicyAttachment(`${name}-logs`, {
            role: role.name,
            policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
        }, o);

        // Optional app-specific inline policy (e.g. DynamoDB CRUD).
        if (args.inlinePolicy) {
            new aws.iam.RolePolicy(`${name}-inline`, {
                role: role.id,
                policy: args.inlinePolicy,
            }, o);
        }

        const fn = new aws.lambda.Function(`${name}-fn`, {
            role: role.arn,
            runtime: args.runtime ?? "nodejs18.x",
            handler: args.handler ?? "index.handler",
            code: args.code,
            timeout: args.timeout ?? 10,
            memorySize: args.memorySize,
            environment: args.environment
                ? { variables: args.environment }
                : undefined,
            tags: args.tags,
        }, o);

        const api = new aws.apigatewayv2.Api(`${name}-api`, {
            protocolType: "HTTP",
            corsConfiguration: {
                allowOrigins: args.allowOrigins ?? ["*"],
                allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
                allowHeaders: ["content-type"],
            },
            tags: args.tags,
        }, o);

        const integration = new aws.apigatewayv2.Integration(`${name}-integration`, {
            apiId: api.id,
            integrationType: "AWS_PROXY",
            integrationUri: fn.invokeArn,
            integrationMethod: "POST",
            payloadFormatVersion: "2.0",
        }, o);

        // One route per {method, path}, all targeting the single integration.
        args.routes.forEach((r, i) => {
            new aws.apigatewayv2.Route(`${name}-route-${i}`, {
                apiId: api.id,
                routeKey: `${r.method} ${r.path}`,
                target: pulumi.interpolate`integrations/${integration.id}`,
            }, o);
        });

        const stage = new aws.apigatewayv2.Stage(`${name}-stage`, {
            apiId: api.id,
            name: stageName,
            autoDeploy: true,
            tags: args.tags,
        }, o);

        // Allow API Gateway to invoke the Lambda.
        new aws.lambda.Permission(`${name}-permission`, {
            action: "lambda:InvokeFunction",
            function: fn.name,
            principal: "apigateway.amazonaws.com",
            sourceArn: pulumi.interpolate`${api.executionArn}/*/*`,
        }, o);

        this.apiId = api.id;
        this.url = pulumi.interpolate`${api.apiEndpoint}/${stage.name}`;
        this.functionArn = fn.arn;
        this.executionRoleName = role.name;

        this.registerOutputs({
            url: this.url,
            apiId: this.apiId,
            functionArn: this.functionArn,
            executionRoleName: this.executionRoleName,
        });
    }
}
