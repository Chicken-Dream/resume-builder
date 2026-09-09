import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod/v4";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

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

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(body, status, env) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }

    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/import") {
      return json({ error: "Not found." }, 404, env);
    }

    let payload;
    try {
      payload = await request.json();
    } catch (err) {
      return json({ error: "Invalid JSON body." }, 400, env);
    }

    const extractedText = typeof payload.text === "string" ? payload.text.trim() : "";
    if (!extractedText) {
      return json({ error: "No resume text was provided." }, 400, env);
    }

    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: "The import service isn't configured (missing API key)." }, 500, env);
    }

    try {
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
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
        return json({ error: "Claude couldn't parse that resume into structured fields. Try again." }, 502, env);
      }

      return json({ resume: response.parsed_output }, 200, env);
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        return json({ error: "Invalid Anthropic API key." }, 401, env);
      }
      if (err instanceof Anthropic.RateLimitError) {
        return json({ error: "Rate limited by the Anthropic API - try again shortly." }, 429, env);
      }
      if (err instanceof Anthropic.APIError) {
        return json({ error: `Anthropic API error: ${err.message}` }, 502, env);
      }
      console.error(err);
      return json({ error: "Unexpected error while importing the resume." }, 500, env);
    }
  },
};
