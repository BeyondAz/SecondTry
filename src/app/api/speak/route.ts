import { NextResponse } from "next/server";
import { z } from "zod";
import {
  checkPaidRequestLimit,
  paidRequestLimitResponse,
} from "@/lib/paidRequestLimit";

const requestSchema = z
  .object({ text: z.string().trim().min(1).max(3_000) })
  .strict();
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
const MAX_BODY_BYTES = 16_000;

class RequestBodyTooLargeError extends Error {}

async function readBoundedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError("Missing request body.");
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RequestBodyTooLargeError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(body));
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Narration text must be no longer than 3,000 characters." },
      { status: 413 },
    );
  }

  let rawBody: unknown;
  try {
    rawBody = await readBoundedJson(request);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        { error: "Narration text must be no longer than 3,000 characters." },
        { status: 413 },
      );
    }
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
      { error: "Narration is not configured. Please try again later." },
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
    const voiceId = encodeURIComponent(
      process.env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID,
    );
    const audioResponse = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          text: parsed.data.text,
          model_id: "eleven_multilingual_v2",
        }),
        cache: "no-store",
        signal: AbortSignal.any([
          request.signal,
          AbortSignal.timeout(30_000),
        ]),
      },
    );

    if (!audioResponse.ok) {
      const category =
        audioResponse.status === 401 || audioResponse.status === 403
          ? "authentication"
          : audioResponse.status === 429
            ? "quota"
            : audioResponse.status >= 500
              ? "upstream"
              : "request";
      console.error("ElevenLabs narration request failed", {
        category,
        upstreamStatus: audioResponse.status,
      });
      const message =
        category === "quota"
          ? "Narration is temporarily unavailable because the provider usage limit was reached."
          : category === "authentication"
            ? "Narration is temporarily unavailable. Please contact the app owner."
            : "Narration could not be generated right now. Please retry.";
      return NextResponse.json(
        { error: message },
        { status: category === "quota" ? 429 : 502 },
      );
    }
    if (!audioResponse.body) {
      throw new Error("Narration provider returned no audio stream.");
    }

    return new NextResponse(audioResponse.body, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("ElevenLabs narration request failed", {
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "Narration could not be generated right now. Please retry." },
      { status: 502 },
    );
  }
}
