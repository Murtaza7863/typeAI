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

/** Shared passages for quote races. 0 short, 1 medium, 2 long. */
const RACE_QUOTES: Record<0 | 1 | 2, string[]> = {
  0: [
    "The only way to do great work is to love what you do.",
    "In the middle of difficulty lies opportunity.",
    "Stay hungry. Stay foolish.",
    "It always seems impossible until it is done.",
    "Simplicity is the ultimate sophistication.",
    "The secret of getting ahead is getting started.",
    "Well done is better than well said.",
    "What we think, we become.",
  ],
  1: [
    "Trust thyself: every heart vibrates to that iron string. Accept the place the divine providence has found for you, the society of your contemporaries, the connection of events. Great men have always done so, and confided themselves childlike to the genius of their age.",
    "I went to the woods because I wished to live deliberately, to front only the essential facts of life, and see if I could not learn what it had to teach, and not, when I came to die, discover that I had not lived.",
    "It is not the critic who counts; not the man who points out how the strong man stumbles, or where the doer of deeds could have done them better. The credit belongs to the man who is actually in the arena.",
    "Two roads diverged in a yellow wood, and sorry I could not travel both and be one traveler, long I stood and looked down one as far as I could to where it bent in the undergrowth.",
    "The happiness of your life depends upon the quality of your thoughts: therefore, guard accordingly, and take care that you entertain no notions unsuitable to virtue and reasonable nature.",
  ],
  2: [
    "It was the best of times, it was the worst of times, it was the age of wisdom, it was the age of foolishness, it was the epoch of belief, it was the epoch of incredulity, it was the season of Light, it was the season of Darkness, it was the spring of hope, it was the winter of despair, we had everything before us, we had nothing before us, we were all going direct to Heaven, we were all going direct the other way.",
    "All the world's a stage, and all the men and women merely players; they have their exits and their entrances, and one man in his time plays many parts, his acts being seven ages. At first the infant, mewling and puking in the nurse's arms. Then the whining schoolboy, with his satchel and shining morning face, creeping like snail unwillingly to school.",
    "Call me Ishmael. Some years ago, never mind how long precisely, having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world. Whenever I find myself growing grim about the mouth, whenever it is a damp, drizzly November in my soul, I account it high time to get to sea as soon as I can.",
    "I have sometimes thought that a woman's nature is like a great house full of rooms: there is the hall, through which everyone passes going in and out; the drawing-room, where one receives formal visits; the sitting-room, where the members of the family come and go as they list; but beyond that, the closed doors she has never opened, and the little room at the top where her own soul sits.",
  ],
};

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

function quoteGroup(length: number | undefined): string[] {
  if (length === 0) return RACE_QUOTES[0];
  if (length === 2) return RACE_QUOTES[2];
  return RACE_QUOTES[1];
}

function generateQuoteWords(length?: number): string[] {
  const group = quoteGroup(length);
  const quote =
    group[Math.floor(Math.random() * group.length)] ??
    "The only way to do great work is to love what you do.";
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
  mode: "words" | "quote" | "time";
  wordCount: 25 | 50 | 100;
  time?: 15 | 30 | 60;
  punctuation: boolean;
  quoteLength?: 0 | 1 | 2;
}): string[] {
  if (settings.mode === "quote") {
    return generateQuoteWords(settings.quoteLength);
  }
  const count =
    settings.mode === "time"
      ? Math.max(200, (settings.time ?? 30) * 8)
      : settings.wordCount;
  const words = generateRaceWordList(count);
  return settings.punctuation ? applyPunctuation(words) : words;
}
