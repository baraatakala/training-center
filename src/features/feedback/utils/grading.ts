import type { FeedbackQuestion } from '@/shared/types/database.types';

export interface GradingResult {
  /** null = not a test question */
  isCorrect: boolean | null;
  /** For partial mode: "1/2", for exact/any: "1/1" or "0/1". null if not graded. */
  detail: string | null;
  /** 0–1 score. null if not graded. */
  score: number | null;
}

/**
 * Grade a student answer against a question's correct answer.
 * Centralised so every consumer (check-in form, analytics, export) uses the same logic.
 */
export function gradeAnswer(question: FeedbackQuestion, answer: unknown): GradingResult {
  if (!question.correct_answer) {
    return { isCorrect: null, detail: null, score: null };
  }

  // Single-value questions (text, single-select multiple_choice)
  if (!question.allow_multiple || !Array.isArray(answer)) {
    const student = String(answer ?? '').trim().toLowerCase();
    const correct = question.correct_answer.trim().toLowerCase();
    const isCorrect = student === correct;
    return { isCorrect, detail: isCorrect ? '1/1' : '0/1', score: isCorrect ? 1 : 0 };
  }

  // Multi-select grading
  const correctArr = question.correct_answer.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const studentArr = (answer as string[]).map(s => String(s).trim().toLowerCase());
  const mode = question.grading_mode || 'exact';

  if (correctArr.length === 0) {
    return { isCorrect: null, detail: null, score: null };
  }

  const correctSet = new Set(correctArr);
  const correctPicks = studentArr.filter(s => correctSet.has(s)).length;
  const wrongPicks = studentArr.filter(s => !correctSet.has(s)).length;
  const totalCorrect = correctArr.length;

  switch (mode) {
    case 'exact': {
      // Must match exactly — all correct, nothing extra
      const isCorrect = correctPicks === totalCorrect && wrongPicks === 0;
      return {
        isCorrect,
        detail: `${correctPicks}/${totalCorrect}`,
        score: isCorrect ? 1 : 0,
      };
    }
    case 'partial': {
      // Proportional credit: correct_picks / total_correct, penalised by wrong picks
      // Score = max(0, (correct_picks - wrong_picks) / total_correct)
      const rawScore = Math.max(0, (correctPicks - wrongPicks) / totalCorrect);
      const score = Math.round(rawScore * 100) / 100;
      return {
        isCorrect: score === 1,
        detail: `${correctPicks}/${totalCorrect}`,
        score,
      };
    }
    case 'any': {
      // At least one correct answer selected (wrong picks don't matter)
      const isCorrect = correctPicks > 0;
      return {
        isCorrect,
        detail: `${correctPicks}/${totalCorrect}`,
        score: isCorrect ? 1 : 0,
      };
    }
    default:
      return { isCorrect: null, detail: null, score: null };
  }
}
