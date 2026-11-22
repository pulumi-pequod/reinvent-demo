/**
 * Datadog: the monitor on the app's email error and the webhook that triggers
 * the agent.
 *
 * The monitor is a log alert on the structured `reminder_send_failed` error the
 * handler emits. Its notification message addresses `@webhook-reinvent-agent`,
 * which is the Datadog webhook defined below — it POSTs the alert to the Pulumi
 * Cloud agent trigger URL with the required `X-Pulumi-Trigger-Secret` header.
 *
 * Keys come from the imported ESC environment (config secrets), never hard-coded.
 * Note: creating the Pulumi-side webhook *automation* (which mints the trigger
 * URL and secret) is a SaaS-only console step — see the RUNBOOK. Once you have
 * the URL and secret, put them in the ESC environment and this wires Datadog to
 * them as code.
 */
import * as pulumi from "@pulumi/pulumi";
import * as datadog from "@pulumi/datadog";
import * as cfg from "./config";

export const WEBHOOK_NAME = "reinvent-agent";

export function createDatadog(): { monitor: datadog.Monitor; webhook: datadog.Webhook } {
    // Datadog provider, keyed from ESC-supplied secrets.
    const provider = new datadog.Provider("datadog", {
        apiKey: cfg.datadogApiKey,
        appKey: cfg.datadogAppKey,
        apiUrl: `https://api.${cfg.datadogSite}/`,
    });
    const opts = { provider };

    // The webhook Datadog calls when the monitor alerts. The payload is the
    // Pulumi-provided template (monitor fields that identify the alert); the
    // custom header carries the Pulumi trigger secret.
    const payloadTemplate = {
        body: "$EVENT_MSG",
        last_updated: "$LAST_UPDATED",
        event_type: "$EVENT_TYPE",
        title: "$EVENT_TITLE",
        date: "$DATE",
        org: { id: "$ORG_ID", name: "$ORG_NAME" },
        id: "$ID",
        alert_id: "$ALERT_ID",
        alert_transition: "$ALERT_TRANSITION",
        alert_priority: "$ALERT_PRIORITY",
        alert_query: "$ALERT_QUERY",
        alert_scope: "$ALERT_SCOPE",
        hostname: "$HOSTNAME",
        tags: "$TAGS",
        link: "$LINK",
    };

    const webhook = new datadog.Webhook("reinvent-agent", {
        name: WEBHOOK_NAME,
        url: cfg.pulumiTriggerUrl,
        encodeAs: "json",
        customHeaders: pulumi
            .output(cfg.pulumiTriggerSecret)
            .apply((secret) => JSON.stringify({ "X-Pulumi-Trigger-Secret": secret ?? "REPLACE_ME" })),
        // Datadog's $-variables must survive JSON.stringify unescaped.
        payload: JSON.stringify(payloadTemplate),
    }, opts);

    // Log alert: any `reminder_send_failed` error from the app in the last 5
    // minutes. Notifying @webhook-reinvent-agent starts the agent.
    const monitor = new datadog.Monitor("reminder-send-failed", {
        name: "reinvent-tasks: reminder email failed to send",
        type: "log alert",
        query:
            'logs("service:reinvent-tasks @event:reminder_send_failed").index("*").rollup("count").last("5m") > 0',
        message: [
            "The reinvent-tasks app failed to send a reminder email.",
            "",
            "{{#is_alert}}",
            "The /remind endpoint tried to send through SES and was rejected. This usually means the app has no email infrastructure (no verified SES identity / no send permission).",
            "",
            "@webhook-" + WEBHOOK_NAME,
            "{{/is_alert}}",
            "",
            "{{#is_recovery}}Reminder sending has recovered.{{/is_recovery}}",
        ].join("\n"),
        monitorThresholds: { critical: "0" },
        tags: ["service:reinvent-tasks", "demo:reinvent", "team:pequod"],
        includeTags: true,
        notifyNoData: false,
        renotifyInterval: 0,
    }, opts);

    return { monitor, webhook };
}
