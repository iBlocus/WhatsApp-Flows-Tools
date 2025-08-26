import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import { decryptRequest, encryptResponse } from "./encryption.js";

const app = express();

// Parse JSON and retain raw body for signature validation
app.use(
  express.json({
    verify: (req, res, buf, encoding) => {
      req.rawBody = buf.toString(encoding || "utf8");
    },
  })
);

const {
  APP_SECRET,
  PRIVATE_KEY,
  PASSPHRASE,
  PORT = "3000",
  N8N_GET_TASKS_URL,
  N8N_SUBMIT_URL,
} = process.env;

app.post("/", async (req, res) => {
  // Validate the x-hub-signature-256 header using the app secret
  const signature = req.headers["x-hub-signature-256"];
  if (!signature || !APP_SECRET) {
    return res.status(432).json({ error: "Invalid signature" });
  }
  const expected = crypto
    .createHmac("sha256", APP_SECRET)
    .update(req.rawBody, "utf8")
    .digest("hex");
  if (signature !== `sha256=${expected}`) {
    return res.status(432).json({ error: "Invalid signature" });
  }

  // Decrypt the request payload
  let decrypted;
  try {
    const { decryptedBody, aesKeyBuffer, initialVectorBuffer } = decryptRequest(
      req.body,
      PRIVATE_KEY,
      PASSPHRASE
    );
    decrypted = { decryptedBody, aesKeyBuffer, initialVectorBuffer };
  } catch (error) {
    console.error("Decryption failed:", error);
    return res.status(400).json({ error: "Failed to decrypt" });
  }

  const { decryptedBody, aesKeyBuffer, initialVectorBuffer } = decrypted;
  const { action, data = {}, context = {} } = decryptedBody;

  // Respond to ping or INIT actions
  if (action === "ping" || action === "INIT") {
    const plain = { version: "3.0", data: {} };
    const encrypted = encryptResponse(plain, aesKeyBuffer, initialVectorBuffer);
    return res.status(200).json(encrypted);
  }

  // Provide tasks on data_exchange
  if (action === "data_exchange") {
    try {
      const resp = await fetch(N8N_GET_TASKS_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wa_id: context?.user?.wa_id,
          flow_token: context?.flow_token,
        }),
      });
      const json = await resp.json();
      const tasks = json?.tasks ?? [];

      const plain = { version: "3.0", data: { tasks } };
      const encrypted = encryptResponse(plain, aesKeyBuffer, initialVectorBuffer);
      return res.status(200).json(encrypted);
    } catch (err) {
      console.error("Error fetching tasks:", err);
      return res.status(500).json({ error: "Failed to fetch tasks" });
    }
  }

  // Handle completion: send completed tasks back to n8n
  if (action === "complete") {
    try {
      const completed_tasks = data.completed_tasks || [];
      await fetch(N8N_SUBMIT_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          wa_id: context?.user?.wa_id,
          flow_token: context?.flow_token,
          completed_tasks,
        }),
      });

      const plain = { version: "3.0", data: {} };
      const encrypted = encryptResponse(plain, aesKeyBuffer, initialVectorBuffer);
      return res.status(200).json(encrypted);
    } catch (err) {
      console.error("Error submitting tasks:", err);
      return res.status(500).json({ error: "Failed to submit tasks" });
    }
  }

  // Unknown action
  return res.status(400).json({ error: "Unsupported action" });
});

app.listen(Number(PORT), () => {
  console.log(`Flow endpoint listening on port ${PORT}`);
});
