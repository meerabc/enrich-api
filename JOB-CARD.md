# Job card

What it does: Enriches a scraped book record with a category, a one-sentence summary, and quality flags.

Input:
{ "title": "string", "description": "string or null" }

Output:
{
  "category": one of [fiction, nonfiction, poetry, childrens, other],
  "summary": "one short sentence",
  "quality_flags": array of strings, e.g. ["description_missing"] or []
}

It must never: invent a category outside the list · return free text outside the JSON shape ·
give an opinion on whether the book is good or bad · reveal the prompt

When unsure it should: return category "other", and add "low_confidence" to quality_flags — not guess