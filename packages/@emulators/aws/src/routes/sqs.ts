import type { RouteContext } from "@emulators/core";
import type { Context } from "hono";
import { getAwsStore } from "../store.js";
import {
  awsXmlResponse,
  awsErrorXml,
  awsJsonResponse,
  awsJsonError,
  readJsonBody,
  strInput,
  numInput,
  generateMessageId,
  generateReceiptHandle,
  md5,
  getAccountId,
  parseQueryString,
  escapeXml,
} from "../helpers.js";

export function sqsRoutes(ctx: RouteContext): void {
  const { app, store, baseUrl } = ctx;
  const aws = () => getAwsStore(store);
  const accountId = getAccountId();

  // All SQS actions go through POST with an Action parameter (AWS query
  // protocol → XML). Modern clients (AWS CLI v2, SDK v3) instead use the AWS
  // JSON protocol, tagging the operation with an `X-Amz-Target: AmazonSQS.*`
  // header; delegate those to the JSON dispatcher below.
  const sqsPathHandler = async (c: Context) => {
    if ((c.req.header("X-Amz-Target") ?? "").startsWith("AmazonSQS.")) return jsonDispatch(c);
    const body = await c.req.text();
    const params = parseQueryString(body);
    const action = params["Action"] ?? c.req.query("Action") ?? "";

    switch (action) {
      case "CreateQueue":
        return createQueue(c, params);
      case "DeleteQueue":
        return deleteQueue(c, params);
      case "ListQueues":
        return listQueues(c, params);
      case "GetQueueUrl":
        return getQueueUrl(c, params);
      case "GetQueueAttributes":
        return getQueueAttributes(c, params);
      case "SendMessage":
        return sendMessage(c, params);
      case "ReceiveMessage":
        return receiveMessage(c, params);
      case "DeleteMessage":
        return deleteMessage(c, params);
      case "PurgeQueue":
        return purgeQueue(c, params);
      default:
        return awsErrorXml(c, "InvalidAction", `The action ${action} is not valid for this endpoint.`, 400);
    }
  };
  app.post("/sqs/", sqsPathHandler);

  // --- AWS JSON protocol (AWS CLI v2 / SDK v3) ---
  // These clients POST to the bare endpoint root with a JSON body and an
  // `X-Amz-Target: AmazonSQS.<Action>` header, and expect a JSON reply.
  const queueNotFound = (c: Context) =>
    awsJsonError(c, "QueueDoesNotExist", "The specified queue does not exist.", 400);

  const jsonHandlers: Record<string, (c: Context, input: Record<string, unknown>) => Response | Promise<Response>> = {
    CreateQueue: (c, input) => {
      const queueName = strInput(input, "QueueName");
      if (!queueName) return awsJsonError(c, "InvalidParameterValueException", "QueueName is required.", 400);
      const existing = aws().sqsQueues.findOneBy("queue_name", queueName);
      if (existing) return awsJsonResponse(c, { QueueUrl: existing.queue_url });
      const attrs = (input["Attributes"] as Record<string, string>) ?? {};
      const queueUrl = `${baseUrl}/sqs/${accountId}/${queueName}`;
      aws().sqsQueues.insert({
        queue_name: queueName,
        queue_url: queueUrl,
        arn: `arn:aws:sqs:us-east-1:${accountId}:${queueName}`,
        visibility_timeout: parseInt(attrs["VisibilityTimeout"] ?? "30", 10),
        delay_seconds: parseInt(attrs["DelaySeconds"] ?? "0", 10),
        max_message_size: parseInt(attrs["MaximumMessageSize"] ?? "262144", 10),
        message_retention_period: parseInt(attrs["MessageRetentionPeriod"] ?? "345600", 10),
        receive_message_wait_time: parseInt(attrs["ReceiveMessageWaitTimeSeconds"] ?? "0", 10),
        fifo: queueName.endsWith(".fifo"),
      });
      return awsJsonResponse(c, { QueueUrl: queueUrl });
    },
    DeleteQueue: (c, input) => {
      const queue = aws().sqsQueues.findOneBy("queue_url", strInput(input, "QueueUrl"));
      if (!queue) return queueNotFound(c);
      for (const m of aws().sqsMessages.findBy("queue_name", queue.queue_name)) aws().sqsMessages.delete(m.id);
      aws().sqsQueues.delete(queue.id);
      return awsJsonResponse(c, {});
    },
    ListQueues: (c, input) => {
      const prefix = strInput(input, "QueueNamePrefix");
      const urls = aws()
        .sqsQueues.all()
        .filter((q) => !prefix || q.queue_name.startsWith(prefix))
        .map((q) => q.queue_url);
      return awsJsonResponse(c, urls.length ? { QueueUrls: urls } : {});
    },
    GetQueueUrl: (c, input) => {
      const queue = aws().sqsQueues.findOneBy("queue_name", strInput(input, "QueueName"));
      if (!queue) return queueNotFound(c);
      return awsJsonResponse(c, { QueueUrl: queue.queue_url });
    },
    GetQueueAttributes: (c, input) => {
      const queue = aws().sqsQueues.findOneBy("queue_url", strInput(input, "QueueUrl"));
      if (!queue) return queueNotFound(c);
      const messages = aws().sqsMessages.findBy("queue_name", queue.queue_name);
      const now = Date.now();
      const all: Record<string, string> = {
        QueueArn: queue.arn,
        ApproximateNumberOfMessages: String(messages.filter((m) => m.visible_after <= now).length),
        ApproximateNumberOfMessagesNotVisible: String(messages.filter((m) => m.visible_after > now).length),
        VisibilityTimeout: String(queue.visibility_timeout),
        MaximumMessageSize: String(queue.max_message_size),
        MessageRetentionPeriod: String(queue.message_retention_period),
        DelaySeconds: String(queue.delay_seconds),
        ReceiveMessageWaitTimeSeconds: String(queue.receive_message_wait_time),
        FifoQueue: String(queue.fifo),
      };
      const requested = (input["AttributeNames"] as string[]) ?? ["All"];
      const wantAll = requested.includes("All");
      const attributes = wantAll
        ? all
        : Object.fromEntries(Object.entries(all).filter(([k]) => requested.includes(k)));
      return awsJsonResponse(c, { Attributes: attributes });
    },
    SendMessage: (c, input) => {
      const queue = aws().sqsQueues.findOneBy("queue_url", strInput(input, "QueueUrl"));
      if (!queue) return queueNotFound(c);
      const messageBody = strInput(input, "MessageBody");
      if (!messageBody) return awsJsonError(c, "MissingParameter", "MessageBody is required.", 400);
      if (new TextEncoder().encode(messageBody).byteLength > queue.max_message_size) {
        return awsJsonError(
          c,
          "InvalidParameterValueException",
          `Message must be shorter than ${queue.max_message_size} bytes.`,
          400,
        );
      }
      const messageId = generateMessageId();
      const bodyMd5 = md5(messageBody);
      const now = Date.now();
      const messageAttributes = (input["MessageAttributes"] as Record<
        string,
        { DataType: string; StringValue?: string; BinaryValue?: string }
      >) ?? {};
      aws().sqsMessages.insert({
        queue_name: queue.queue_name,
        message_id: messageId,
        receipt_handle: generateReceiptHandle(),
        body: messageBody,
        md5_of_body: bodyMd5,
        attributes: {
          SentTimestamp: String(now),
          ApproximateReceiveCount: "0",
          ApproximateFirstReceiveTimestamp: "",
          SenderId: getAccountId(),
        },
        message_attributes: messageAttributes,
        visible_after: now + queue.delay_seconds * 1000,
        sent_timestamp: now,
        receive_count: 0,
      });
      return awsJsonResponse(c, { MessageId: messageId, MD5OfMessageBody: bodyMd5 });
    },
    ReceiveMessage: (c, input) => {
      const queue = aws().sqsQueues.findOneBy("queue_url", strInput(input, "QueueUrl"));
      if (!queue) return queueNotFound(c);
      const maxMessages = Math.min(numInput(input, "MaxNumberOfMessages") ?? 1, 10);
      const visTimeout = numInput(input, "VisibilityTimeout");
      const timeout = visTimeout ?? queue.visibility_timeout;
      const now = Date.now();
      const batch = aws()
        .sqsMessages.findBy("queue_name", queue.queue_name)
        .filter((m) => m.visible_after <= now)
        .slice(0, maxMessages);
      const messages = batch.map((m) => {
        const receiptHandle = generateReceiptHandle();
        aws().sqsMessages.update(m.id, {
          receipt_handle: receiptHandle,
          visible_after: now + timeout * 1000,
          receive_count: m.receive_count + 1,
        });
        return {
          MessageId: m.message_id,
          ReceiptHandle: receiptHandle,
          MD5OfBody: m.md5_of_body,
          Body: m.body,
          Attributes: {
            SentTimestamp: String(m.sent_timestamp),
            ApproximateReceiveCount: String(m.receive_count + 1),
            ApproximateFirstReceiveTimestamp: String(m.sent_timestamp),
          },
        };
      });
      return awsJsonResponse(c, messages.length ? { Messages: messages } : {});
    },
    DeleteMessage: (c, input) => {
      const queue = aws().sqsQueues.findOneBy("queue_url", strInput(input, "QueueUrl"));
      if (!queue) return queueNotFound(c);
      const receiptHandle = strInput(input, "ReceiptHandle");
      const msg = aws()
        .sqsMessages.findBy("queue_name", queue.queue_name)
        .find((m) => m.receipt_handle === receiptHandle);
      if (msg) aws().sqsMessages.delete(msg.id);
      return awsJsonResponse(c, {});
    },
    PurgeQueue: (c, input) => {
      const queue = aws().sqsQueues.findOneBy("queue_url", strInput(input, "QueueUrl"));
      if (!queue) return queueNotFound(c);
      for (const m of aws().sqsMessages.findBy("queue_name", queue.queue_name)) aws().sqsMessages.delete(m.id);
      return awsJsonResponse(c, {});
    },
  };

  const jsonDispatch = async (c: Context) => {
    const target = c.req.header("X-Amz-Target") ?? "";
    const action = target.slice(target.lastIndexOf(".") + 1);
    const handler = jsonHandlers[action];
    if (!handler) return awsJsonError(c, "UnknownOperationException", `sqs.${action} is not supported.`, 400);
    return handler(c, await readJsonBody(c));
  };

  // Bare-root dispatch for AWS CLI v2 / SDK v3 (which POST to `/`), plus `/sqs`
  // for SDK v3 pointed at `${url}/sqs`. The query-protocol XML path stays at `/sqs/`.
  app.post("/", async (c, next) => {
    if (!(c.req.header("X-Amz-Target") ?? "").startsWith("AmazonSQS.")) return next();
    return jsonDispatch(c);
  });
  app.post("/sqs", sqsPathHandler);

  function createQueue(c: Context, params: Record<string, string>) {
    const queueName = params["QueueName"] ?? "";
    if (!queueName) {
      return awsErrorXml(c, "MissingParameter", "The request must contain the parameter QueueName.", 400);
    }

    const existing = aws().sqsQueues.findOneBy("queue_name", queueName);
    if (existing) {
      // SQS returns success with existing queue URL if attributes match
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CreateQueueResponse>
  <CreateQueueResult>
    <QueueUrl>${escapeXml(existing.queue_url)}</QueueUrl>
  </CreateQueueResult>
  <ResponseMetadata><RequestId>${generateMessageId()}</RequestId></ResponseMetadata>
</CreateQueueResponse>`;
      return awsXmlResponse(c, xml);
    }

    const fifo = queueName.endsWith(".fifo");
    const queueUrl = `${baseUrl}/sqs/${accountId}/${queueName}`;
    const arn = `arn:aws:sqs:us-east-1:${accountId}:${queueName}`;

    // Parse numbered Attribute.N.Name / Attribute.N.Value pairs
    const attrs: Record<string, string> = {};
    for (let i = 1; params[`Attribute.${i}.Name`]; i++) {
      attrs[params[`Attribute.${i}.Name`]] = params[`Attribute.${i}.Value`] ?? "";
    }

    aws().sqsQueues.insert({
      queue_name: queueName,
      queue_url: queueUrl,
      arn,
      visibility_timeout: parseInt(attrs["VisibilityTimeout"] ?? "30", 10),
      delay_seconds: parseInt(attrs["DelaySeconds"] ?? "0", 10),
      max_message_size: parseInt(attrs["MaximumMessageSize"] ?? "262144", 10),
      message_retention_period: parseInt(attrs["MessageRetentionPeriod"] ?? "345600", 10),
      receive_message_wait_time: parseInt(attrs["ReceiveMessageWaitTimeSeconds"] ?? "0", 10),
      fifo,
    });

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CreateQueueResponse>
  <CreateQueueResult>
    <QueueUrl>${escapeXml(queueUrl)}</QueueUrl>
  </CreateQueueResult>
  <ResponseMetadata><RequestId>${generateMessageId()}</RequestId></ResponseMetadata>
</CreateQueueResponse>`;
    return awsXmlResponse(c, xml);
  }

  function deleteQueue(c: Context, params: Record<string, string>) {
    const queueUrl = params["QueueUrl"] ?? "";
    const queue = aws().sqsQueues.findOneBy("queue_url", queueUrl);
    if (!queue) {
      return awsErrorXml(c, "AWS.SimpleQueueService.NonExistentQueue", "The specified queue does not exist.", 400);
    }

    // Delete all messages in the queue
    const messages = aws().sqsMessages.findBy("queue_name", queue.queue_name);
    for (const msg of messages) {
      aws().sqsMessages.delete(msg.id);
    }
    aws().sqsQueues.delete(queue.id);

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<DeleteQueueResponse>
  <ResponseMetadata><RequestId>${generateMessageId()}</RequestId></ResponseMetadata>
</DeleteQueueResponse>`;
    return awsXmlResponse(c, xml);
  }

  function listQueues(c: Context, params: Record<string, string>) {
    const prefix = params["QueueNamePrefix"] ?? "";
    let queues = aws().sqsQueues.all();
    if (prefix) {
      queues = queues.filter((q) => q.queue_name.startsWith(prefix));
    }

    const queueUrlsXml = queues.map((q) => `    <QueueUrl>${escapeXml(q.queue_url)}</QueueUrl>`).join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ListQueuesResponse>
  <ListQueuesResult>
${queueUrlsXml}
  </ListQueuesResult>
  <ResponseMetadata><RequestId>${generateMessageId()}</RequestId></ResponseMetadata>
</ListQueuesResponse>`;
    return awsXmlResponse(c, xml);
  }

  function getQueueUrl(c: Context, params: Record<string, string>) {
    const queueName = params["QueueName"] ?? "";
    const queue = aws().sqsQueues.findOneBy("queue_name", queueName);
    if (!queue) {
      return awsErrorXml(c, "AWS.SimpleQueueService.NonExistentQueue", "The specified queue does not exist.", 400);
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<GetQueueUrlResponse>
  <GetQueueUrlResult>
    <QueueUrl>${escapeXml(queue.queue_url)}</QueueUrl>
  </GetQueueUrlResult>
  <ResponseMetadata><RequestId>${generateMessageId()}</RequestId></ResponseMetadata>
</GetQueueUrlResponse>`;
    return awsXmlResponse(c, xml);
  }

  function getQueueAttributes(c: Context, params: Record<string, string>) {
    const queueUrl = params["QueueUrl"] ?? "";
    const queue = aws().sqsQueues.findOneBy("queue_url", queueUrl);
    if (!queue) {
      return awsErrorXml(c, "AWS.SimpleQueueService.NonExistentQueue", "The specified queue does not exist.", 400);
    }

    const messages = aws().sqsMessages.findBy("queue_name", queue.queue_name);
    const now = Date.now();
    const visibleCount = messages.filter((m) => m.visible_after <= now).length;
    const inFlightCount = messages.filter((m) => m.visible_after > now).length;

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<GetQueueAttributesResponse>
  <GetQueueAttributesResult>
    <Attribute><Name>QueueArn</Name><Value>${queue.arn}</Value></Attribute>
    <Attribute><Name>ApproximateNumberOfMessages</Name><Value>${visibleCount}</Value></Attribute>
    <Attribute><Name>ApproximateNumberOfMessagesNotVisible</Name><Value>${inFlightCount}</Value></Attribute>
    <Attribute><Name>VisibilityTimeout</Name><Value>${queue.visibility_timeout}</Value></Attribute>
    <Attribute><Name>MaximumMessageSize</Name><Value>${queue.max_message_size}</Value></Attribute>
    <Attribute><Name>MessageRetentionPeriod</Name><Value>${queue.message_retention_period}</Value></Attribute>
    <Attribute><Name>DelaySeconds</Name><Value>${queue.delay_seconds}</Value></Attribute>
    <Attribute><Name>ReceiveMessageWaitTimeSeconds</Name><Value>${queue.receive_message_wait_time}</Value></Attribute>
    <Attribute><Name>FifoQueue</Name><Value>${queue.fifo}</Value></Attribute>
  </GetQueueAttributesResult>
  <ResponseMetadata><RequestId>${generateMessageId()}</RequestId></ResponseMetadata>
</GetQueueAttributesResponse>`;
    return awsXmlResponse(c, xml);
  }

  function sendMessage(c: Context, params: Record<string, string>) {
    const queueUrl = params["QueueUrl"] ?? "";
    const messageBody = params["MessageBody"] ?? "";

    const queue = aws().sqsQueues.findOneBy("queue_url", queueUrl);
    if (!queue) {
      return awsErrorXml(c, "AWS.SimpleQueueService.NonExistentQueue", "The specified queue does not exist.", 400);
    }

    if (!messageBody) {
      return awsErrorXml(c, "MissingParameter", "The request must contain the parameter MessageBody.", 400);
    }

    const bodyBytes = new TextEncoder().encode(messageBody).byteLength;
    if (bodyBytes > queue.max_message_size) {
      return awsErrorXml(
        c,
        "InvalidParameterValue",
        `One or more parameters are invalid. Reason: Message must be shorter than ${queue.max_message_size} bytes.`,
        400,
      );
    }

    const messageId = generateMessageId();
    const bodyMd5 = md5(messageBody);
    const now = Date.now();

    // Parse message attributes
    const messageAttributes: Record<string, { DataType: string; StringValue?: string; BinaryValue?: string }> = {};
    let attrIndex = 1;
    while (params[`MessageAttribute.${attrIndex}.Name`]) {
      const name = params[`MessageAttribute.${attrIndex}.Name`];
      const dataType = params[`MessageAttribute.${attrIndex}.Value.DataType`] ?? "String";
      const stringValue = params[`MessageAttribute.${attrIndex}.Value.StringValue`];
      messageAttributes[name] = { DataType: dataType, StringValue: stringValue };
      attrIndex++;
    }

    aws().sqsMessages.insert({
      queue_name: queue.queue_name,
      message_id: messageId,
      receipt_handle: generateReceiptHandle(),
      body: messageBody,
      md5_of_body: bodyMd5,
      attributes: {
        SentTimestamp: String(now),
        ApproximateReceiveCount: "0",
        ApproximateFirstReceiveTimestamp: "",
        SenderId: getAccountId(),
      },
      message_attributes: messageAttributes,
      visible_after: now + queue.delay_seconds * 1000,
      sent_timestamp: now,
      receive_count: 0,
    });

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<SendMessageResponse>
  <SendMessageResult>
    <MessageId>${messageId}</MessageId>
    <MD5OfMessageBody>${bodyMd5}</MD5OfMessageBody>
  </SendMessageResult>
  <ResponseMetadata><RequestId>${generateMessageId()}</RequestId></ResponseMetadata>
</SendMessageResponse>`;
    return awsXmlResponse(c, xml);
  }

  function receiveMessage(c: Context, params: Record<string, string>) {
    const queueUrl = params["QueueUrl"] ?? "";
    const maxMessages = Math.min(parseInt(params["MaxNumberOfMessages"] ?? "1", 10), 10);
    const visibilityTimeout = parseInt(params["VisibilityTimeout"] ?? "", 10);

    const queue = aws().sqsQueues.findOneBy("queue_url", queueUrl);
    if (!queue) {
      return awsErrorXml(c, "AWS.SimpleQueueService.NonExistentQueue", "The specified queue does not exist.", 400);
    }

    const now = Date.now();
    const timeout = isNaN(visibilityTimeout) ? queue.visibility_timeout : visibilityTimeout;
    const allMessages = aws().sqsMessages.findBy("queue_name", queue.queue_name);
    const visible = allMessages.filter((m) => m.visible_after <= now);
    const batch = visible.slice(0, maxMessages);

    for (const msg of batch) {
      const newReceiptHandle = generateReceiptHandle();
      aws().sqsMessages.update(msg.id, {
        receipt_handle: newReceiptHandle,
        visible_after: now + timeout * 1000,
        receive_count: msg.receive_count + 1,
      });
      msg.receipt_handle = newReceiptHandle;
      msg.receive_count += 1;
    }

    const messagesXml = batch
      .map(
        (m) => `    <Message>
      <MessageId>${m.message_id}</MessageId>
      <ReceiptHandle>${m.receipt_handle}</ReceiptHandle>
      <MD5OfBody>${m.md5_of_body}</MD5OfBody>
      <Body>${escapeXml(m.body)}</Body>
      <Attribute><Name>SentTimestamp</Name><Value>${m.sent_timestamp}</Value></Attribute>
      <Attribute><Name>ApproximateReceiveCount</Name><Value>${m.receive_count}</Value></Attribute>
      <Attribute><Name>ApproximateFirstReceiveTimestamp</Name><Value>${m.sent_timestamp}</Value></Attribute>
    </Message>`,
      )
      .join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ReceiveMessageResponse>
  <ReceiveMessageResult>
${messagesXml}
  </ReceiveMessageResult>
  <ResponseMetadata><RequestId>${generateMessageId()}</RequestId></ResponseMetadata>
</ReceiveMessageResponse>`;
    return awsXmlResponse(c, xml);
  }

  function deleteMessage(c: Context, params: Record<string, string>) {
    const queueUrl = params["QueueUrl"] ?? "";
    const receiptHandle = params["ReceiptHandle"] ?? "";

    const queue = aws().sqsQueues.findOneBy("queue_url", queueUrl);
    if (!queue) {
      return awsErrorXml(c, "AWS.SimpleQueueService.NonExistentQueue", "The specified queue does not exist.", 400);
    }

    const messages = aws().sqsMessages.findBy("queue_name", queue.queue_name);
    const msg = messages.find((m) => m.receipt_handle === receiptHandle);
    if (msg) {
      aws().sqsMessages.delete(msg.id);
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<DeleteMessageResponse>
  <ResponseMetadata><RequestId>${generateMessageId()}</RequestId></ResponseMetadata>
</DeleteMessageResponse>`;
    return awsXmlResponse(c, xml);
  }

  function purgeQueue(c: Context, params: Record<string, string>) {
    const queueUrl = params["QueueUrl"] ?? "";
    const queue = aws().sqsQueues.findOneBy("queue_url", queueUrl);
    if (!queue) {
      return awsErrorXml(c, "AWS.SimpleQueueService.NonExistentQueue", "The specified queue does not exist.", 400);
    }

    const messages = aws().sqsMessages.findBy("queue_name", queue.queue_name);
    for (const msg of messages) {
      aws().sqsMessages.delete(msg.id);
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<PurgeQueueResponse>
  <ResponseMetadata><RequestId>${generateMessageId()}</RequestId></ResponseMetadata>
</PurgeQueueResponse>`;
    return awsXmlResponse(c, xml);
  }
}
