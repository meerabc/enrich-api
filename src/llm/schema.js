import { z } from "zod";

export const InputSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(3000).nullable(),
});

export const OutputSchema = z.object({
  category: z.enum(["fiction", "nonfiction", "poetry", "childrens", "other"]),
  summary: z.string().min(1).max(300),
  quality_flags: z.array(z.string()),
});