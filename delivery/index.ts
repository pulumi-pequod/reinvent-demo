/**
 * The release pipeline for reinvent-tasks, as a Pulumi program (Pulumi Delivery).
 *
 * Flow: dev -> staging -> (approval gate) -> prod. Each stage runs `pulumi up`
 * on that stage's stack from this repo, then smoke-tests the deployed API.
 * Nothing reaches prod until a named person approves; the approval shows the
 * prod preview. The person who starts a run can't approve it — Pulumi Delivery
 * enforces that.
 *
 * Requires Pulumi CLI v3.272.0+ on macOS or Linux. Register the pipeline with
 * `pulumi delivery register` (not `pulumi up`); after that, a merge to main that
 * touches app/** or delivery/** cuts a release, and you can also start one from
 * the pipeline view. A run holds at the prod gate until an approver continues it.
 *
 * This mirrors the pattern in pulumi-pequod/loop-demo (the full-loop reference).
 */
import * as delivery from "@pulumi/delivery";

const ORG_REPO = "pulumi-pequod/reinvent-demo";

// Keep this in sync with setup/ (reinvent-setup:approvers) and the approver
// team. The booth demo approves from a second account (the run-starter can't
// approve their own run) — ishmael-archie / ishmael-betty are the shared demo
// logins. Add more people freely; the gate just needs someone who isn't the
// person who started the run.
const APPROVERS = ["ishmael-archie", "ishmael-betty"];

const repo = new delivery.GitHubSource("repo", {
    repository: ORG_REPO,
    branch: "main",
    // A merge to main that touches the app or the pipeline cuts a release.
    trigger: { paths: ["app/**", "delivery/**"] },
});

const pipeline = new delivery.Pipeline("reinvent", {
    program: { source: repo, directory: "delivery" },
});

// Deploy the reinvent-tasks stack for a stage, then smoke-test its API.
function deploy(stage: delivery.Stage, env: string) {
    const app = new delivery.Stacks(`app-${env}`, {
        stage,
        stacks: {
            [env]: { stack: `reinvent-tasks/${env}`, source: repo, directory: "app" },
        },
    });
    new delivery.Job(`smoke-${env}`, {
        stage,
        source: repo,
        directory: "delivery",
        command: "sh smoke.sh",
        environment: {
            API_URL: app.outputs.apply((o) => String(o[env]["apiUrl"])),
        },
    });
}

const dev = new delivery.Stage("dev", { pipeline });
deploy(dev, "dev");

const staging = new delivery.Stage("staging", { pipeline, from: [dev] });
deploy(staging, "staging");

// Production holds at a gate until a named person approves. The approval shows
// the prod preview; the run-starter is never eligible to approve it.
const prod = new delivery.Stage("prod", {
    pipeline,
    from: [staging],
    when: delivery.approval({ approvers: APPROVERS }),
});
deploy(prod, "prod");

export const release = pipeline.releaseNumber;
