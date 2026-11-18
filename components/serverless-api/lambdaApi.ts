import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface LambdaApiRoute {
    /** HTTP method, e.g. "GET" or "POST". */
    method: string;
    /** Route path, e.g. "/tasks" or "/tasks/{id}/done". */
    path: string;
}

export interface LambdaApiArgs {
    /** The Lambda function all routes are proxied to (payload format 2.0). */
    handler: aws.lambda.Function;
    /** The routes exposed by the API. */
    routes: LambdaApiRoute[];
    /** API Gateway stage name. Defaults to "api". */
    stageName?: pulumi.Input<string>;
    /** CORS allowed origins. Defaults to ["*"]. */
    allowOrigins?: pulumi.Input<string[]>;
    /** Tags applied to the API and stage. */
    tags?: pulumi.Input<{ [key: string]: pulumi.Input<string> }>;
}

/**
 * LambdaApi fronts a Lambda with an API Gateway v2 HTTP API: one AWS_PROXY
 * integration, one route per {method, path}, a deployed stage, CORS, and the
 * invoke permission. Built on the base `@pulumi/aws` provider — no crosswalk
 * packages.
 *
 * The handler receives API Gateway v2 (payload format 2.0) events and should
 * route on `event.routeKey` (e.g. "POST /tasks/{id}/done"); path variables are
 * available on `event.pathParameters`.
 */
export class LambdaApi extends pulumi.ComponentResource {
    /** Invoke URL including the stage (no trailing slash). */
    public readonly url: pulumi.Output<string>;
    /** The HTTP API's id. */
    public readonly apiId: pulumi.Output<string>;

    constructor(name: string, args: LambdaApiArgs, opts?: pulumi.ComponentResourceOptions) {
        super("pequod-serverless-api:index:LambdaApi", name, args, opts);

        const o = { parent: this };
        const stageName = args.stageName ?? "api";

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
            integrationUri: args.handler.invokeArn,
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
            function: args.handler.name,
            principal: "apigateway.amazonaws.com",
            sourceArn: pulumi.interpolate`${api.executionArn}/*/*`,
        }, o);

        this.apiId = api.id;
        this.url = pulumi.interpolate`${api.apiEndpoint}/${stage.name}`;

        this.registerOutputs({
            url: this.url,
            apiId: this.apiId,
        });
    }
}
