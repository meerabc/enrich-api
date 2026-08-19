import "dotenv/config";
import fs from "fs";
import express from "express";
import OpenAI from "openai";
import { InputSchema, OutputSchema } from "./llm/schema.js";

const app = express();
app.use(express.json());

const SYSTEM_PROMPT = fs.readFileSync("prompts/enrich-v1.md", "utf-8");

const client = new OpenAI({
  baseURL: process.env.LLM_BASE_URL,
  apiKey: process.env.LLM_API_KEY,
});

const STUB_RESPONSE = {
  category: "fiction",
  summary: "A stubbed summary for testing without calling the model.",
  quality_flags: [],
};

app.post("/enrich", async (req, res) => {
  const parsed = InputSchema.safeParse(req.body);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({ error: `invalid field: ${issue.path.join(".")} — ${issue.message}` });
  }

  if (process.env.LLM_STUB === "1") {
    return res.status(200).json(STUB_RESPONSE);
  }

  const completion = await client.chat.completions.create({
    model: process.env.LLM_MODEL,
    temperature: 0.2,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(parsed.data) },
    ],
  });

  res.status(200).json({ raw_model_output: completion.choices[0].message.content });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`enrich-api listening on port ${PORT}`));