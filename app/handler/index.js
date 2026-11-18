// Task-tracker API handler (API Gateway v2, payload format 2.0).
//
// Routes on `event.routeKey` (e.g. "POST /tasks/{id}/done"); path variables are
// on `event.pathParameters`. The Node.js 18 Lambda runtime ships the AWS SDK v3 (incl. SESv2),
// so no bundled dependencies are required.
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocument } = require("@aws-sdk/lib-dynamodb");
const { SESv2Client, SendEmailCommand } = require("@aws-sdk/client-sesv2");

const doc = DynamoDBDocument.from(new DynamoDBClient({}));
const ses = new SESv2Client({});

// Pragmatic email shape check; SES performs the authoritative validation.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(statusCode, body) {
    return {
        statusCode,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    };
}

// Error response for /remind. The UI toasts `message`, so send it alongside `error`.
function remindError(statusCode, message) {
    return json(statusCode, { error: message, message });
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

        // POST /remind — email the task's assignee a reminder via SES.
        if (routeKey === "POST /remind") {
            const { taskId } = parseBody(ev);
            if (!taskId) {
                return remindError(400, "'taskId' is required");
            }

            const res = await doc.get({ TableName, Key: { id: taskId } });
            const task = res.Item;
            if (!task) {
                return remindError(404, `Task '${taskId}' not found`);
            }

            const to = (task.assigneeEmail || "").trim();
            if (!to) {
                return remindError(
                    422,
                    "This task has no assignee email; add one before sending a reminder.",
                );
            }
            if (!EMAIL_RE.test(to)) {
                return remindError(422, `Assignee email '${to}' is not a valid address.`);
            }

            const from = process.env.SENDER_EMAIL;
            if (!from) {
                console.error("SENDER_EMAIL is not configured");
                return remindError(500, "Reminder sender is not configured.");
            }

            const name = task.assigneeName || "there";
            const status = task.done ? "already marked done" : "still open";
            const text =
                `Hi ${name},\n\n` +
                `This is a reminder about your task: "${task.title}" (${status}).\n\n` +
                `- Task Tracker`;

            try {
                const sent = await ses.send(
                    new SendEmailCommand({
                        FromEmailAddress: from,
                        Destination: { ToAddresses: [to] },
                        Content: {
                            Simple: {
                                Subject: { Data: `Reminder: ${task.title}` },
                                Body: { Text: { Data: text } },
                            },
                        },
                    }),
                );
                return json(200, {
                    status: "sent",
                    message: `Reminder sent to ${to}`,
                    messageId: sent.MessageId,
                });
            } catch (e) {
                console.error("SES send failed", e);
                // In the SES sandbox, unverified recipients are rejected.
                if (e && e.name === "MessageRejected") {
                    return remindError(
                        502,
                        "Email was rejected by SES. If the account is in the SES sandbox, " +
                            "the recipient address must be verified.",
                    );
                }
                return remindError(502, "Failed to send reminder email.");
            }
        }

        return json(404, { error: `No route for ${routeKey}` });
    } catch (e) {
        return json(500, { error: (e && e.message) || "Internal error" });
    }
};
