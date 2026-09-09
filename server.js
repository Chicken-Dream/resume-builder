require("dotenv").config();

const path = require("path");
const express = require("express");
const Anthropic = require("@anthropic-ai/sdk");
const { z } = require("zod/v4");
const { zodOutputFormat } = require("@anthropic-ai/sdk/helpers/zod");

const app = express();
const PORT = process.env.PORT || 4287;

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

// The cheapest current Claude model - this endpoint only does text extraction,
// which doesn't need a bigger model.
const IMPORT_MODEL = "claude-haiku-4-5";

const LinkSchema = z.object({ label: z.string(), url: z.string() });
const EducationSchema = z.object({
  school: z.string(),
  location: z.string(),
  degree: z.string(),
  start: z.string(),
  end: z.string(),
  details: z.string(),
});
const ExperienceSchema = z.object({
  title: z.string(),
  company: z.string(),
  location: z.string(),
  start: z.string(),
  end: z.string(),
  bullets: z.array(z.string()),
});
const ProjectSchema = z.object({
  name: z.string(),
  tech: z.string(),
  start: z.string(),
  end: z.string(),
  bullets: z.array(z.string()),
});
const SkillGroupSchema = z.object({ category: z.string(), items: z.string() });
const AwardSchema = z.object({
  title: z.string(),
  org: z.string(),
  location: z.string(),
  date: z.string(),
});

const ResumeSchema = z.object({
  name: z.string(),
  title: z.string(),
  email: z.string(),
  phone: z.string(),
  location: z.string(),
  links: z.array(LinkSchema),
  summary: z.string(),
  education: z.array(EducationSchema),
  experience: z.array(ExperienceSchema),
  projects: z.array(ProjectSchema),
  skills: z.array(SkillGroupSchema),
  certifications: z.array(z.string()),
  awards: z.array(AwardSchema),
});

const IMPORT_SYSTEM_PROMPT =
  "You extract structured resume data from raw resume text. " +
  "Copy information verbatim where possible - do not invent, embellish, or summarize content that isn't present. " +
  "If a field isn't present in the source text, use an empty string (or an empty array for list fields). " +
  "Preserve bullet points as separate array entries with the leading bullet character removed. " +
  "Dates should be copied as written (e.g. 'Aug 2025 - Present').";

app.post("/api/import-resume", async (req, res) => {
  const extractedText = typeof req.body.text === "string" ? req.body.text.trim() : "";

  if (!extractedText) {
    return res.status(400).json({ error: "No resume text was provided." });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({
      error: "ANTHROPIC_API_KEY is not set on the server. Add it to your .env file and restart the server.",
    });
  }

  try {
    const client = new Anthropic();
    const response = await client.messages.parse({
      model: IMPORT_MODEL,
      max_tokens: 4096,
      system: IMPORT_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Extract the resume data from the following text:\n\n${extractedText}`,
        },
      ],
      output_config: {
        format: zodOutputFormat(ResumeSchema),
      },
    });

    if (!response.parsed_output) {
      return res.status(502).json({ error: "Claude couldn't parse that resume into structured fields. Try again." });
    }

    return res.json({ resume: response.parsed_output });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return res.status(401).json({ error: "Invalid Anthropic API key." });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return res.status(429).json({ error: "Rate limited by the Anthropic API - try again shortly." });
    }
    if (err instanceof Anthropic.APIError) {
      return res.status(502).json({ error: `Anthropic API error: ${err.message}` });
    }
    console.error(err);
    return res.status(500).json({ error: "Unexpected server error while importing the resume." });
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  return res.status(500).json({ error: "Unexpected server error." });
});

app.listen(PORT, () => {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn(
      "WARNING: ANTHROPIC_API_KEY is not set. The 'Import resume' feature will not work until you add it to .env."
    );
  }
  console.log(`Resume builder running at http://localhost:${PORT}`);
});
