import "dotenv/config";
import fs from "fs";
import path from "path";
import express from "express";
import OpenAI from "openai";
import { InputSchema, OutputSchema } from "./llm/schema.js";

const app = express();
app.use(express.json());

const SYSTEM_PROMPT = fs.readFileSync("prompts/enrich-v1.md", "utf-8");
const PROMPT_VERSION = "enrich-v1";
const TIMEOUT_MS = 30000;
const MAX_RETRIES = 2;

const client = new OpenAI({
  baseURL: process.env.LLM_BASE_URL,
  apiKey: process.env.LLM_API_KEY,
  timeout: TIMEOUT_MS,
  maxRetries: 0,
});

const STUB_RESPONSE = {
  category: "fiction",
  summary: "A stubbed summary for testing without calling the model.",
  quality_flags: [],
};

const FALLBACK_RESPONSE = {
  category: "other",
  summary: "Enrichment temporarily unavailable.",
  quality_flags: ["llm_disabled"],
};

function extractJson(text) {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function quarantine(input, rawOutput, reason) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    input,
    raw_output: rawOutput,
    reason,
    prompt_version: PROMPT_VERSION,
  });
  fs.mkdirSync("logs", { recursive: true });
  fs.appendFileSync(path.join("logs", "quarantine.jsonl"), line + "\n");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryable(status) {
  return status === 429 || status >= 500;
}

async function callModel(userContent, isRepair) {
  const start = Date.now();
  let attempt = 0;
  let lastErr;

  while (attempt <= MAX_RETRIES) {
    try {
      const completion = await client.chat.completions.create({
        model: process.env.LLM_MODEL,
        temperature: 0.2,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      });

      const log = {
        prompt_version: PROMPT_VERSION,
        model: process.env.LLM_MODEL,
        input_tokens: completion.usage?.prompt_tokens ?? null,
        output_tokens: completion.usage?.completion_tokens ?? null,
        duration_ms: Date.now() - start,
        is_repair: isRepair,
        attempt: attempt + 1,
      };
      console.log(JSON.stringify(log));

      return completion.choices[0].message.content;
    } catch (err) {
      lastErr = err;
      const status = err.status;
      if (!isRetryable(status) || attempt === MAX_RETRIES) {
        throw err;
      }
      const backoff = 1000 * 2 ** attempt + Math.random() * 300;
      await sleep(backoff);
      attempt++;
    }
  }
  throw lastErr;
}

app.post("/enrich", async (req, res) => {
  const parsedInput = InputSchema.safeParse(req.body);

  if (!parsedInput.success) {
    const issue = parsedInput.error.issues[0];
    return res.status(400).json({ error: `invalid field: ${issue.path.join(".")} — ${issue.message}` });
  }

  if (process.env.LLM_STUB === "1") {
    return res.status(200).json(STUB_RESPONSE);
  }

  if (process.env.LLM_ENABLED === "false") {
    return res.status(200).json(FALLBACK_RESPONSE);
  }

  const userContent = JSON.stringify(parsedInput.data);
  let firstRaw;
  try {
    firstRaw = await callModel(userContent, false);
  } catch (err) {
    if (err.name === "APIConnectionTimeoutError" || err.code === "ETIMEDOUT") {
      return res.status(504).json({ error: "model call timed out" });
    }
    return res.status(502).json({ error: `model call failed: ${err.message}` });
  }

  const firstJson = extractJson(firstRaw);
  const firstResult = firstJson ? OutputSchema.safeParse(firstJson) : { success: false, error: { message: "could not parse JSON from model output" } };

  if (firstResult.success) {
    return res.status(200).json(firstResult.data);
  }

  const errorDetail = firstJson
    ? firstResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    : "response was not valid JSON";

  const repairContent = `${userContent}\n\nYour previous answer was rejected for this reason: ${errorDetail}\nYour previous answer was: ${firstRaw}\nReturn only corrected JSON matching the schema.`;

  let secondRaw;
  try {
    secondRaw = await callModel(repairContent, true);
  } catch (err) {
    if (err.name === "APIConnectionTimeoutError" || err.code === "ETIMEDOUT") {
      return res.status(504).json({ error: "model call timed out" });
    }
    return res.status(502).json({ error: `model call failed: ${err.message}` });
  }

  const secondJson = extractJson(secondRaw);
  const secondResult = secondJson ? OutputSchema.safeParse(secondJson) : { success: false, error: { message: "could not parse JSON from repair attempt" } };

  if (secondResult.success) {
    return res.status(200).json(secondResult.data);
  }

  quarantine(parsedInput.data, secondRaw, "failed validation after repair retry");
  return res.status(422).json({ error: "model could not produce a valid response after one repair attempt" });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`enrich-api listening on port ${PORT}`));