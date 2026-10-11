import { ElevenLabsClient, ElevenLabsError } from "@elevenlabs/elevenlabs-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  checkPaidRequestLimit,
  paidRequestLimitResponse,
} from "@/lib/paidRequestLimit";

const requestSchema = z.object({
  text: z.string().trim().min(1).max(3_000),
});

const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

export async function POST(request: Request) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = requestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Provide nonblank text no longer than 3,000 characters." },
      { status: 400 },
    );
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "Narration is not configured. Add ELEVENLABS_API_KEY on the server." },
      { status: 503 },
    );
  }
  try {
    const limitResponse = paidRequestLimitResponse(
      await checkPaidRequestLimit(request),
    );
    if (limitResponse) return limitResponse;
  } catch (error) {
    console.error("Shared paid-request limit check failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "Paid features are temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }

  try {
    const client = new ElevenLabsClient({ apiKey });
    const audio = await client.textToSpeech.convert(
      process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID,
      {
        text: parsed.data.text,
        modelId: "eleven_multilingual_v2",
        outputFormat: "mp3_44100_128",
      },
      {
        abortSignal: request.signal,
        timeoutInSeconds: 30,
        maxRetries: 0,
      },
    );

    return new NextResponse(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const statusCode = error instanceof ElevenLabsError ? error.statusCode : undefined;
    const category =
      statusCode === 401 || statusCode === 403
        ? "authentication"
        : statusCode === 429
          ? "quota"
          : statusCode !== undefined && statusCode >= 500
            ? "upstream"
            : "request";
    console.error("ElevenLabs narration request failed", {
      category,
      statusCode,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });

    const message =
      category === "authentication"
        ? "Narration could not authenticate. Check the server's ElevenLabs credentials."
        : category === "quota"
          ? "Narration is temporarily unavailable because the ElevenLabs quota was reached."
          : "Narration could not be generated right now. Please try again.";
    return NextResponse.json(
      { error: message },
      { status: category === "quota" ? 429 : 502 },
    );
  }
}
