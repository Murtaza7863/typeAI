import { RACE_WORD_COUNT } from "@typeai/schemas/race";

/** Top ~200 English words (same pool as frontend english.json). */
const ENGLISH_WORDS = [
  "the",
  "be",
  "of",
  "and",
  "a",
  "to",
  "in",
  "he",
  "have",
  "it",
  "that",
  "for",
  "they",
  "I",
  "with",
  "as",
  "not",
  "on",
  "she",
  "at",
  "by",
  "this",
  "we",
  "you",
  "do",
  "but",
  "from",
  "or",
  "which",
  "one",
  "would",
  "all",
  "will",
  "there",
  "say",
  "who",
  "make",
  "when",
  "can",
  "more",
  "if",
  "no",
  "man",
  "out",
  "other",
  "so",
  "what",
  "time",
  "up",
  "go",
  "about",
  "than",
  "into",
  "could",
  "state",
  "only",
  "new",
  "year",
  "some",
  "take",
  "come",
  "these",
  "know",
  "see",
  "use",
  "get",
  "like",
  "then",
  "first",
  "any",
  "work",
  "now",
  "may",
  "such",
  "give",
  "over",
  "think",
  "most",
  "even",
  "find",
  "day",
  "also",
  "after",
  "way",
  "many",
  "must",
  "look",
  "before",
  "great",
  "back",
  "through",
  "long",
  "where",
  "much",
  "should",
  "well",
  "people",
  "down",
  "own",
  "just",
  "because",
  "good",
  "each",
  "those",
  "feel",
  "seem",
  "how",
  "high",
  "too",
  "place",
  "little",
  "world",
  "very",
  "still",
  "nation",
  "hand",
  "old",
  "life",
  "tell",
  "write",
  "become",
  "here",
  "show",
  "house",
  "both",
  "between",
  "need",
  "mean",
  "call",
  "develop",
  "under",
  "last",
  "right",
  "move",
  "thing",
  "general",
  "school",
  "never",
  "same",
  "another",
  "begin",
  "while",
  "number",
  "part",
  "turn",
  "real",
  "leave",
  "might",
  "want",
  "point",
  "form",
  "off",
  "child",
  "few",
  "small",
  "since",
  "against",
  "ask",
  "late",
  "home",
  "interest",
  "large",
  "person",
  "end",
  "open",
  "public",
  "follow",
  "during",
  "present",
  "without",
  "again",
  "hold",
  "govern",
  "around",
  "possible",
  "head",
  "consider",
  "word",
  "program",
  "problem",
  "however",
  "lead",
  "system",
  "set",
  "order",
  "eye",
  "plan",
  "run",
  "keep",
  "face",
  "fact",
  "group",
  "play",
  "stand",
  "increase",
  "early",
  "course",
  "change",
  "help",
  "line",
];

/** Short curated quotes for race mode (already punctuated). */
const RACE_QUOTES: string[] = [
  "The only way to do great work is to love what you do.",
  "In the middle of difficulty lies opportunity.",
  "It is not the strongest of the species that survives, but the most adaptable.",
  "Life is what happens when you are busy making other plans.",
  "The future belongs to those who believe in the beauty of their dreams.",
  "Do not go where the path may lead, go instead where there is no path and leave a trail.",
  "Success is not final, failure is not fatal: it is the courage to continue that counts.",
  "What you get by achieving your goals is not as important as what you become by achieving your goals.",
  "The best time to plant a tree was twenty years ago. The second best time is now.",
  "You miss one hundred percent of the shots you never take.",
  "Whether you think you can or you think you cannot, you are right.",
  "The journey of a thousand miles begins with a single step.",
  "It always seems impossible until it is done.",
  "Everything you can imagine is real.",
  "Stay hungry, stay foolish.",
  "Simplicity is the ultimate sophistication.",
  "Be yourself; everyone else is already taken.",
  "The secret of getting ahead is getting started.",
  "Action is the foundational key to all success.",
  "Dream big and dare to fail.",
];

function applyPunctuation(words: string[]): string[] {
  if (words.length === 0) return words;
  const out = [...words];
  const first = out[0];
  if (first !== undefined && first.length > 0) {
    out[0] = first.charAt(0).toUpperCase() + first.slice(1);
  }
  for (let i = 0; i < out.length; i++) {
    const word = out[i];
    if (word === undefined) continue;
    if (i > 0 && i % 7 === 0 && !word.endsWith(",") && !word.endsWith(".")) {
      out[i] = `${word},`;
    }
  }
  const lastIdx = out.length - 1;
  const last = out[lastIdx];
  if (last !== undefined && !/[.!?]$/.test(last)) {
    out[lastIdx] = `${last}.`;
  }
  return out;
}

function generateQuoteWords(): string[] {
  const quote =
    RACE_QUOTES[Math.floor(Math.random() * RACE_QUOTES.length)] ??
    "The journey of a thousand miles begins with a single step.";
  return quote.split(/\s+/).filter((w) => w.length > 0);
}

export function generateRaceWordList(count = RACE_WORD_COUNT): string[] {
  const words: string[] = [];
  let previous = "";
  while (words.length < count) {
    const word =
      ENGLISH_WORDS[Math.floor(Math.random() * ENGLISH_WORDS.length)] ?? "the";
    if (word === previous && ENGLISH_WORDS.length > 1) continue;
    words.push(word);
    previous = word;
  }
  return words;
}

export function generateRaceText(settings: {
  mode: "words" | "quote";
  wordCount: 25 | 50 | 100;
  punctuation: boolean;
}): string[] {
  if (settings.mode === "quote") {
    return generateQuoteWords();
  }
  const words = generateRaceWordList(settings.wordCount);
  return settings.punctuation ? applyPunctuation(words) : words;
}
