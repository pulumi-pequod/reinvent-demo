// Task-tracker API handler (API Gateway v2, payload format 2.0).
//
// Routes on `event.routeKey` (e.g. "POST /tasks/{id}/done"); path variables are
// on `event.pathParameters`. The Node.js Lambda runtime ships the AWS SDK v3,
// so no bundled dependencies are required.
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocument } = require("@aws-sdk/lib-dynamodb");
const { SESClient, SendEmailCommand } = require("@aws-sdk/client-ses");

const doc = DynamoDBDocument.from(new DynamoDBClient({}));
const ses = new SESClient({});

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(value) {
    return String(value).replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
}

// Sends a reminder email about `task` to its assignee. Returns the SES message id.
async function sendReminder(task, sender) {
    const to = task.assigneeEmail.trim();
    const name = (task.assigneeName || "").trim() || "there";
    const subject = `Reminder: ${task.title}`;
    const text =
        `Hi ${name},\n\n` +
        `This is a reminder that the following task is still open:\n\n` +
        `  ${task.title}\n\n` +
        `Thanks!`;
    const html =
        `<p>Hi ${escapeHtml(name)},</p>` +
        `<p>This is a reminder that the following task is still open:</p>` +
        `<p><strong>${escapeHtml(task.title)}</strong></p>` +
        `<p>Thanks!</p>`;

    const res = await ses.send(
        new SendEmailCommand({
            Source: sender,
            Destination: { ToAddresses: [to] },
            Message: {
                Subject: { Data: subject, Charset: "UTF-8" },
                Body: {
                    Text: { Data: text, Charset: "UTF-8" },
                    Html: { Data: html, Charset: "UTF-8" },
                },
            },
        }),
    );
    return res.MessageId;
}

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

        // POST /remind — email the task's assignee a reminder about the task.
        if (routeKey === "POST /remind") {
            const { taskId } = parseBody(ev);
            if (!taskId) {
                return json(400, { error: "'taskId' is required" });
            }

            const sender = process.env.SENDER_EMAIL;
            if (!sender) {
                console.error("SENDER_EMAIL is not configured");
                return json(500, { error: "Email sender is not configured" });
            }

            const { Item: task } = await doc.get({ TableName, Key: { id: taskId } });
            if (!task) {
                return json(404, { error: `Task '${taskId}' not found` });
            }

            const assigneeEmail = (task.assigneeEmail || "").trim();
            if (!assigneeEmail) {
                return json(422, {
                    status: "no-assignee-email",
                    error: "This task has no assignee email, so a reminder cannot be sent.",
                });
            }
            if (!EMAIL_PATTERN.test(assigneeEmail)) {
                return json(422, {
                    status: "invalid-assignee-email",
                    error: `Assignee email '${assigneeEmail}' is not a valid address.`,
                });
            }

            try {
                const messageId = await sendReminder({ ...task, assigneeEmail }, sender);
                return json(200, { status: "sent", to: assigneeEmail, messageId });
            } catch (e) {
                // In the SES sandbox, MessageRejected is returned for any
                // recipient (or sender) that has not been verified.
                if (e && e.name === "MessageRejected") {
                    console.error("SES rejected the message:", e.message);
                    return json(403, {
                        status: "rejected",
                        error:
                            "SES rejected the message. While the account is in the SES sandbox, " +
                            "both the sender and the recipient must be verified identities. " +
                            e.message,
                    });
                }
                throw e;
            }
        }

        return json(404, { error: `No route for ${routeKey}` });
    } catch (e) {
        return json(500, { error: (e && e.message) || "Internal error" });
    }
};
