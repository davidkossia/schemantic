export const LIMITS = {
  maxImageBytes: 5 * 1024 * 1024,     // decoded size
  maxFrameBytes: 8 * 1024 * 1024,
  maxQuestionChars: 1000,
  maxComponents: 40,
  maxSeries: 10,                      // graph series in an approved structure
  maxPoints: 500,                     // points per series in an approved structure
  maxFieldChars: 200,                 // each string field of an approved structure
  maxStructureChars: 50_000,          // an approved structure as compact JSON (JSON.stringify)
  maxSolveTurns: 12,
  maxSessionTokens: 200_000,
  readTimeoutMs: 120_000,
  solveTimeoutMs: 300_000,
} as const;
