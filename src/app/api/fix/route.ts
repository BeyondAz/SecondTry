import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { z } from "zod";

const requestSchema = z.object({
  code: z.string().min(1).max(20_000),
  intendedBehavior: z.string().max(3_000).default(""),
  followUpAnswer: z.string().max(3_000).optional(),
});

const resultSchema = z.object({
  needsClarification: z.boolean(),
  question: z.string().nullable().optional(),
  correctedCode: z.string().nullable().optional(),
  summary: z.string().nullable().optional(),
  explanations: z.array(z.string()).optional(),
  concept: z.string().nullable().optional(),
});

function parseModelResponse(text: string) {
  const json = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const result = resultSchema.parse(JSON.parse(json));

  if (result.needsClarification) {
    if (!result.question?.trim()) {
      throw new Error("Gemini returned a clarification without a question.");
    }

    return {
      needsClarification: true,
      question: result.question,
      correctedCode: null,
      summary: null,
      explanations: [],
      concept: null,
    };
  }

  if (!result.correctedCode?.trim()) {
    throw new Error("Gemini returned a fix without corrected code.");
  }

  return {
    needsClarification: false,
    question: null,
    correctedCode: result.correctedCode,
    summary: result.summary ?? null,
    explanations: result.explanations ?? [],
    concept: result.concept ?? null,
  };
}

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsedRequest = requestSchema.safeParse(rawBody);
  if (!parsedRequest.success) {
    return NextResponse.json(
      { error: "Provide Python code and keep the request within the allowed size." },
      { status: 400 },
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Gemini is not configured. Add GEMINI_API_KEY to the server environment." },
      { status: 503 },
    );
  }

  const { code, intendedBehavior, followUpAnswer } = parsedRequest.data;
  const ai = new GoogleGenAI({ apiKey });
  const prompt = `You are a patient Python tutor. Help debug the user's Python code.
Return only a JSON object with this shape:
{
  "needsClarification": boolean,
  "question": string or null,
  "correctedCode": string or null,
  "summary": string or null,
  "explanations": array of short strings,
  "concept": string or null
}

If the intended behavior is unclear, set needsClarification to true, ask one concise question, and set the other result fields to null or an empty array. Otherwise provide complete corrected Python code, a concise summary, a few brief explanations of the changes, and one underlying Python concept.

User's code:
\`\`\`python
${code}
\`\`\`

Intended behavior:
${intendedBehavior || "(not provided)"}

${followUpAnswer ? `Answer to your follow-up question:\n${followUpAnswer}` : ""}`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    if (!response.text) {
      throw new Error("Gemini returned an empty response.");
    }

    return NextResponse.json(parseModelResponse(response.text));
  } catch (error) {
    console.error("Gemini code-fix request failed:", error);
    return NextResponse.json(
      { error: "Gemini could not complete the fix. Please retry in a moment." },
      { status: 502 },
    );
  }
}
