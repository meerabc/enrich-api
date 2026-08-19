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

const client = new OpenAI({
  baseURL: process.env.LLM_BASE_URL,
  apiKey: process.env.LLM_API_KEY,
});

const STUB_RESPONSE = {
  category: "fiction",
  summary: "A stubbed summary for testing without calling the model.",
  quality_flags: [],
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

async function quarantine(input, rawOutput, reason) {
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

async function callModel(userContent) {
  const completion = await client.chat.completions.create({
    model: process.env.LLM_MODEL,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
  });
  return completion.choices[0].message.content;
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

  const userContent = JSON.stringify(parsedInput.data);
  const firstRaw = await callModel(userContent);
  const firstJson = extractJson(firstRaw);
  const firstResult = firstJson ? OutputSchema.safeParse(firstJson) : { success: false, error: { message: "could not parse JSON from model output" } };

  if (firstResult.success) {
    return res.status(200).json(firstResult.data);
  }

  const errorDetail = firstJson
    ? firstResult.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")
    : "response was not valid JSON";

  const repairContent = `${userContent}\n\nYour previous answer was rejected for this reason: ${errorDetail}\nYour previous answer was: ${firstRaw}\nReturn only corrected JSON matching the schema.`;

  const secondRaw = await callModel(repairContent);
  const secondJson = extractJson(secondRaw);
  const secondResult = secondJson ? OutputSchema.safeParse(secondJson) : { success: false, error: { message: "could not parse JSON from repair attempt" } };

  if (secondResult.success) {
    return res.status(200).json(secondResult.data);
  }

  await quarantine(parsedInput.data, secondRaw, "failed validation after repair retry");
  return res.status(422).json({ error: "model could not produce a valid response after one repair attempt" });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`enrich-api listening on port ${PORT}`));