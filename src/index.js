import "dotenv/config";
import express from "express";
import { InputSchema, OutputSchema } from "./llm/schema.js";

const app = express();
app.use(express.json());

const STUB_RESPONSE = {
  category: "fiction",
  summary: "A stubbed summary for testing without calling the model.",
  quality_flags: [],
};

app.post("/enrich", (req, res) => {
  const parsed = InputSchema.safeParse(req.body);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return res.status(400).json({ error: `invalid field: ${issue.path.join(".")} — ${issue.message}` });
  }

  if (process.env.LLM_STUB === "1") {
    return res.status(200).json(STUB_RESPONSE);
  }

  res.status(501).json({ error: "real model call not implemented yet" });
});

const PORT = 3000;
app.listen(PORT, () => console.log(`enrich-api listening on port ${PORT}`));