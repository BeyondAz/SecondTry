import { getPracticeHistory } from "@/lib/practice-store";
import { practiceErrorResponse, practiceJson } from "@/lib/practice-api";

export async function GET(request: Request) {
  try {
    return practiceJson(await getPracticeHistory(request));
  } catch (error) {
    return practiceErrorResponse(error);
  }
}
