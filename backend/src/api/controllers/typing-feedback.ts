import {
  GetTypingFeedbackQuery,
  GetTypingFeedbackResponse,
} from "@typeai/contracts/users";
import { MonkeyResponse } from "../../utils/monkey-response";
import { MonkeyRequest } from "../types";
import { getTypingFeedbackForUser } from "../../services/typing-feedback";

export async function getTypingFeedback(
  req: MonkeyRequest<GetTypingFeedbackQuery>,
): Promise<GetTypingFeedbackResponse> {
  const { uid } = req.ctx.decodedToken;
  const refresh = req.query.refresh === "true";

  const feedback = await getTypingFeedbackForUser(uid, { refresh });

  return new MonkeyResponse("Typing feedback retrieved", feedback);
}
