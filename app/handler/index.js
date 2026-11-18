// Task-tracker API handler (API Gateway v2, payload format 2.0).
//
// Routes on `event.routeKey` (e.g. "POST /tasks/{id}/done"); path variables are
// on `event.pathParameters`. The Node.js 18 Lambda runtime ships the AWS SDK v3,
// so no bundled dependencies are required.
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocument } = require("@aws-sdk/lib-dynamodb");

const doc = DynamoDBDocument.from(new DynamoDBClient({}));

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

        // POST /remind — email delivery is intentionally left unimplemented.
        if (routeKey === "POST /remind") {
            return json(501, {
                status: "not-implemented",
                message: "Email reminders are not available yet.",
            });
        }

        return json(404, { error: `No route for ${routeKey}` });
    } catch (e) {
        return json(500, { error: (e && e.message) || "Internal error" });
    }
};
