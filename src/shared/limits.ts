export const LIMITS = {
  maxImageBytes: 5 * 1024 * 1024,     // decoded size
  maxFrameBytes: 8 * 1024 * 1024,
  maxQuestionChars: 1000,
  maxComponents: 40,
  maxSolveTurns: 12,
  maxSessionTokens: 200_000,
  readTimeoutMs: 120_000,
  solveTimeoutMs: 300_000,
} as const;
