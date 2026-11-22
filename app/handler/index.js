// Task-tracker API handler (API Gateway v2, payload format 2.0).
//
// Routes on `event.routeKey` (e.g. "POST /tasks/{id}/done"); path variables are
// on `event.pathParameters`. The Node.js 18 Lambda runtime ships the AWS SDK v3,
// so no bundled dependencies are required.
//
// POST /remind genuinely tries to send a reminder email through Amazon SES. The
// app has no email infrastructure yet — no verified SES identity and the Lambda
// role has no ses:SendEmail permission — so the send fails. The handler logs a
// structured `reminder_send_failed` error (which Datadog's log monitor watches)
// and returns 502. Wiring in the approved EmailSender component is what fixes it.
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocument } = require("@aws-sdk/lib-dynamodb");
const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");

const doc = DynamoDBDocument.from(new DynamoDBClient({}));
const ses = new SESClient({});

// The address reminders are sent "from". There is no verified SES identity for
// it yet, which is part of why the send fails until EmailSender is wired in.
const REMINDER_FROM = process.env.REMINDER_FROM || "reminders@demo.pequod.dev";
const STAGE = process.env.STAGE || "dev";

function json(statusCode, body) {
    return {
        statusCode,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    };
}

function parseBody(ev) {
    try {
        if (ev.body) {
            const raw = ev.isBase64Encoded
                ? Buffer.from(ev.body, "base64").toString("utf8")
                : ev.body;
            return JSON.parse(raw || "{}");
        }
        return ev.queryStringParameters || {};
    } catch {
        return {};
    }
}

exports.handler = async (ev) => {
    const routeKey = ev.routeKey || "";
    const TableName = process.env.TABLE_NAME;

    try {
        // GET /tasks — list all tasks.
        if (routeKey === "GET /tasks") {
            const res = await doc.scan({ TableName });
            const items = (res.Items || []).sort((a, b) =>
                a.createdAt < b.createdAt ? 1 : -1,
            );
            return json(200, items);
        }

        // POST /tasks — create a task.
        if (routeKey === "POST /tasks") {
            const parsed = parseBody(ev);
            const title = parsed.title;
            if (!title) {
                return json(400, { error: "'title' is required" });
            }
            const item = {
                id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                title,
                assigneeName: parsed.assigneeName || "",
                assigneeEmail: parsed.assigneeEmail || "",
                done: false,
                createdAt: new Date().toISOString(),
            };
            await doc.put({ TableName, Item: item });
            return json(201, item);
        }

        // POST /tasks/{id}/done — mark a task complete.
        if (routeKey === "POST /tasks/{id}/done") {
            const id = ev.pathParameters && ev.pathParameters.id;
            if (!id) {
                return json(400, { error: "task id is required" });
            }
            const res = await doc.update({
                TableName,
                Key: { id },
                UpdateExpression: "SET done = :done",
                ExpressionAttributeValues: { ":done": true },
                ReturnValues: "ALL_NEW",
            });
            return json(200, res.Attributes);
        }

        // POST /remind — really try to send the reminder through SES.
        if (routeKey === "POST /remind") {
            const parsed = parseBody(ev);
            const taskId = parsed.taskId;

            // Look up the task so the email has a real recipient and title.
            let task;
            if (taskId) {
                try {
                    const res = await doc.get({ TableName, Key: { id: taskId } });
                    task = res.Item;
                } catch {
                    // Fall through: we still attempt the send and let SES fail.
                }
            }
            const to = (task && task.assigneeEmail) || parsed.assigneeEmail || "assignee@example.com";
            const name = (task && task.assigneeName) || "there";
            const title = (task && task.title) || "your task";

            try {
                await ses.send(new SendEmailCommand({
                    Source: REMINDER_FROM,
                    Destination: { ToAddresses: [to] },
                    Message: {
                        Subject: { Data: `Reminder: ${title}` },
                        Body: { Text: { Data: `Hi ${name}, this is a reminder to finish "${title}".` } },
                    },
                }));
                return json(200, { status: "sent", to });
            } catch (e) {
                // Structured error for Datadog's log monitor. The monitor watches
                // for event=reminder_send_failed and fires the agent webhook.
                console.error(JSON.stringify({
                    level: "error",
                    event: "reminder_send_failed",
                    service: "reinvent-tasks",
                    stage: STAGE,
                    taskId: taskId || null,
                    recipient: to,
                    from: REMINDER_FROM,
                    errorName: e && e.name,
                    errorCode: (e && (e.Code || e.name)) || "UnknownError",
                    message: (e && e.message) || "SES send failed",
                }));
                return json(502, {
                    status: "send-failed",
                    message: "Could not send the reminder email — email delivery is not configured.",
                });
            }
        }

        return json(404, { error: `No route for ${routeKey}` });
    } catch (e) {
        return json(500, { error: (e && e.message) || "Internal error" });
    }
};
