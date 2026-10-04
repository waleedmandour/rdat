/**
 * Model profiles — pattern-based inference settings for ghost text.
 *
 * Fix 5 (v0.4.3): different model families need different inference
 * settings for ghost-text translation:
 *
 *   - gemma4 / qwen3: disable thinking (the Ollama `think` field) for
 *     fast, direct translation output. Thinking models waste tokens on
 *     reasoning that shouldn't appear in ghost text.
 *   - translategemma: single user message (no system message) with
 *     glossary hints folded into the user message. TranslateGemma was
 *     trained with a specific prompt format that doesn't use a system
 *     role.
 *   - Unknown models: safe defaults (think: false, system message
 *     allowed) + per-model override.
 *
 * The profiles are consumed by the OllamaAdapter's translate method to
 * decide the request structure. The Tutor prompt path is unchanged
 * (it always uses a system message + benefits from thinking).
 */

export interface ModelProfile {
  /** Whether to send `think: false` in the Ollama /api/chat request. */
  disableThinking: boolean;
  /**
   * Whether to fold the system prompt into the user message instead of
   * using a separate system role. TranslateGemma expects this.
   */
  foldSystemIntoUser: boolean;
  /** Display label for the profile (for debugging). */
  label: string;
}

const DEFAULT_PROFILE: ModelProfile = {
  disableThinking: false,
  foldSystemIntoUser: false,
  label: "default",
};

// ─── Pattern-based profiles ────────────────────────────────────────
// Patterns are checked in order; first match wins. This lets new model
// families be added without touching the lookup function.

interface ProfilePattern {
  /** Regex tested against the model tag (lowercase). */
  pattern: RegExp;
  profile: ModelProfile;
}

const PROFILES: ProfilePattern[] = [
  // Gemma 4 family — disable thinking for fast ghost text
  {
    pattern: /^gemma4/,
    profile: {
      disableThinking: true,
      foldSystemIntoUser: false,
      label: "gemma4",
    },
  },
  // Qwen 3 family — thinking models, disable thinking for ghost text
  {
    pattern: /^qwen3/,
    profile: {
      disableThinking: true,
      foldSystemIntoUser: false,
      label: "qwen3",
    },
  },
  // TranslateGemma — single user message, no system message
  {
    pattern: /^translategemma/,
    profile: {
      disableThinking: true,
      foldSystemIntoUser: true,
      label: "translategemma",
    },
  },
  // Qwen 2.5 — non-thinking, safe defaults
  {
    pattern: /^qwen2\.5/,
    profile: {
      disableThinking: false,
      foldSystemIntoUser: false,
      label: "qwen2.5",
    },
  },
  // Llama 3 — non-thinking, safe defaults
  {
    pattern: /^llama3/,
    profile: {
      disableThinking: false,
      foldSystemIntoUser: false,
      label: "llama3",
    },
  },
];

/**
 * Get the model profile for a given model tag.
 *
 * @param modelTag - the Ollama model tag (e.g. "gemma4:e2b", "qwen3:4b")
 * @returns the matching profile, or DEFAULT_PROFILE if no pattern matches
 */
export function getModelProfile(modelTag: string): ModelProfile {
  const lower = modelTag.toLowerCase();
  for (const { pattern, profile } of PROFILES) {
    if (pattern.test(lower)) {
      return profile;
    }
  }
  return DEFAULT_PROFILE;
}

/**
 * Build the Ollama /api/chat request body for a translation, respecting
 * the model profile. When foldSystemIntoUser is true, the system prompt
 * is prepended to the user prompt as a single user message.
 */
export function buildOllamaChatRequest(
  modelTag: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
  temperature: number
): Record<string, unknown> {
  const profile = getModelProfile(modelTag);

  if (profile.foldSystemIntoUser) {
    // TranslateGemma: single user message with system + user combined
    return {
      model: modelTag,
      messages: [
        { role: "user", content: `${systemPrompt}\n\n${userPrompt}` },
      ],
      stream: false,
      think: profile.disableThinking ? false : undefined,
      options: {
        num_predict: maxTokens,
        temperature,
      },
    };
  }

  // Standard: system + user messages
  return {
    model: modelTag,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    stream: false,
    think: profile.disableThinking ? false : undefined,
    options: {
      num_predict: maxTokens,
      temperature,
    },
  };
}
