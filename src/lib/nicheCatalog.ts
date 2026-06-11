/**
 * Niche catalog — the "metrics" surface for the channel builder (wizard step 1)
 * and the per-channel Settings tab. Curated RPM ($/1000 views) + difficulty +
 * subcategories, each carrying a rough monthly search/view volume, an optional
 * per-subcategory RPM, and a SEED ARRAY OF SEO TAGS.
 *
 * Ported + extended from v1 autostudio's CONTENT_CATEGORIES (dashboard/server.js):
 * v1 attached a default `tags[]` to every subcategory and expanded them with
 * Gemini at publish time (its /api/smart-tags). We do the same: the chosen
 * subcategory's tags seed `metadata.baseTags`, which the metadata block merges
 * with its AI-generated tags. Live search volume + power words still come from
 * `competitor_research` at build time; these are the curated starting point.
 */
import type { FamilyKey } from "@/engine/families";

export type Difficulty = "Easy" | "Medium" | "Hard";

export interface Subcategory {
  /** Stable kebab id (used as the value + for tag seeding). */
  id: string;
  /** Display name. */
  name: string;
  /** Rough monthly search/avg-view volume, K-scale. */
  searchVolume: number;
  /** Optional per-subcategory RPM (USD / 1000 views); falls back to the niche RPM. */
  rpm?: number;
  /** Seed SEO tags — the pipeline expands these with AI at metadata time. */
  tags: string[];
}
export interface Niche {
  key: string;
  label: string;
  icon: string; // emoji for the card
  rpm: number; // USD / 1000 views
  difficulty: Difficulty;
  blurb: string;
  defaultFamily: FamilyKey;
  subcategories: Subcategory[];
}

export const NICHES: Niche[] = [
  {
    key: "lofi", label: "Lo-Fi Music", icon: "🎵", rpm: 3.2, difficulty: "Easy",
    blurb: "Study beats, chill music", defaultFamily: "music_loop",
    subcategories: [
      { id: "study-beats", name: "Study / Focus beats", searchVolume: 90, rpm: 2.8, tags: ["study music", "lofi hip hop", "focus music", "concentration", "study beats", "chill beats", "homework music", "lofi radio"] },
      { id: "sleep-calm", name: "Sleep / Calm", searchVolume: 74, rpm: 3.5, tags: ["sleep music", "relaxing music", "deep sleep", "insomnia relief", "calm music", "ambient sleep", "sleeping music", "8 hours"] },
      { id: "ghibli-anime", name: "Ghibli / Anime ambience", searchVolume: 61, rpm: 3.1, tags: ["ghibli lofi", "anime lofi", "studio ghibli music", "anime ambience", "cozy anime", "nostalgic lofi", "piano lofi", "chillhop"] },
      { id: "rainy-cozy", name: "Rainy / Cozy", searchVolume: 48, rpm: 3.2, tags: ["rain sounds", "rain on window", "rain for sleep", "rain ambience", "cozy lofi", "rainy day", "rain noise", "thunderstorm"] },
      { id: "coffee-shop", name: "Coffee Shop Ambience", searchVolume: 75, rpm: 3.0, tags: ["coffee shop ambient", "cafe music", "coffee shop sounds", "background noise", "cafe ambience", "work music", "cafe lofi"] },
      { id: "jazz-lofi", name: "Jazz Lo-Fi", searchVolume: 55, rpm: 3.4, tags: ["jazz lofi", "smooth jazz", "jazz hop", "jazz beats", "late night jazz", "jazz music", "chill jazz", "lofi jazz"] },
    ],
  },
  {
    key: "educational", label: "Educational", icon: "💡", rpm: 4.5, difficulty: "Medium",
    blurb: "Tutorials, explainers", defaultFamily: "whiteboard",
    subcategories: [
      { id: "how-to-tutorials", name: "How things work", searchVolume: 82, rpm: 4.5, tags: ["how it works", "explained", "how to", "step by step", "learn", "guide", "tips", "simply explained"] },
      { id: "science-explainers", name: "Science explainers", searchVolume: 70, rpm: 5.2, tags: ["science", "explained", "physics", "biology", "chemistry", "space", "universe", "facts"] },
      { id: "maths-logic", name: "Maths / Logic", searchVolume: 39, rpm: 4.0, tags: ["mathematics", "logic", "problem solving", "math explained", "puzzles", "reasoning", "numbers", "learn math"] },
    ],
  },
  {
    key: "finance", label: "Finance", icon: "💲", rpm: 9.5, difficulty: "Hard",
    blurb: "Investment, money tips (highest RPM)", defaultFamily: "whiteboard",
    subcategories: [
      { id: "money-basics", name: "Money basics (Fed, 2008, history of money)", searchVolume: 88, rpm: 8.0, tags: ["history of money", "federal reserve", "2008 crash", "how money works", "economy explained", "inflation", "central banks", "financial literacy"] },
      { id: "investing", name: "Investing 101", searchVolume: 95, rpm: 12.0, tags: ["investing", "stocks", "stock market", "portfolio", "dividends", "index funds", "wealth building", "investing for beginners"] },
      { id: "real-estate", name: "Real estate investing", searchVolume: 90, rpm: 13.0, tags: ["real estate", "real estate investing", "rental property", "property investment", "reits", "passive income real estate", "real estate for beginners", "how to invest in real estate"] },
      { id: "legal-tax", name: "Legal & tax education", searchVolume: 62, rpm: 16.0, tags: ["taxes", "tax tips", "llc", "legal tips", "tax strategy", "how to pay less taxes", "business taxes", "tax explained"] },
      { id: "economic-history", name: "Economic history", searchVolume: 51, rpm: 7.0, tags: ["economic history", "great depression", "market crash", "recession", "economic crisis", "money history", "boom and bust"] },
      { id: "passive-income", name: "Passive income", searchVolume: 110, rpm: 8.5, tags: ["passive income", "make money online", "side hustle", "income ideas", "financial freedom", "money tips", "earn online"] },
      { id: "crypto", name: "Cryptocurrency", searchVolume: 125, rpm: 7.0, tags: ["crypto", "bitcoin", "ethereum", "cryptocurrency", "blockchain", "defi", "web3", "altcoins"] },
    ],
  },
  {
    key: "technology", label: "Technology", icon: "🖥️", rpm: 6.2, difficulty: "Medium",
    blurb: "AI tools, software reviews (fastest-growing)", defaultFamily: "narrated_stock",
    subcategories: [
      { id: "ai-tools-automation", name: "AI tools & automation (agents)", searchVolume: 145, rpm: 7.0, tags: ["ai tools", "ai automation", "ai agents", "best ai tools", "chatgpt", "ai workflow", "automation", "ai apps", "ai for business"] },
      { id: "ai-ml", name: "AI news / tools", searchVolume: 99, rpm: 6.0, tags: ["artificial intelligence", "AI", "machine learning", "chatgpt", "AI tools", "deep learning", "AI news", "tech"] },
      { id: "programming", name: "Software reviews", searchVolume: 64, rpm: 4.5, tags: ["software review", "best software", "app review", "productivity tools", "saas", "tech review", "tools", "software"] },
      { id: "gadget-reviews", name: "Gadgets", searchVolume: 58, rpm: 5.0, tags: ["tech review", "gadget", "unboxing", "smartphone", "laptop", "tech news", "best tech", "gadgets 2026"] },
    ],
  },
  {
    key: "lifestyle", label: "Lifestyle", icon: "❤️", rpm: 3.8, difficulty: "Easy",
    blurb: "Wellness, productivity", defaultFamily: "narrated_stock",
    subcategories: [
      { id: "productivity", name: "Productivity", searchVolume: 72, rpm: 4.0, tags: ["productivity", "time management", "focus", "deep work", "habits", "morning routine", "get things done", "self improvement"] },
      { id: "wellness-habits", name: "Wellness / habits", searchVolume: 66, rpm: 3.8, tags: ["wellness", "healthy habits", "self care", "mindfulness", "wellbeing", "routine", "habit building", "healthy lifestyle"] },
      { id: "gratitude-series", name: "Gratitude / series", searchVolume: 33, rpm: 3.5, tags: ["gratitude", "daily gratitude", "thankfulness", "positive mindset", "morning affirmations", "gratitude practice", "mindset"] },
    ],
  },
  {
    key: "food", label: "Food", icon: "🍳", rpm: 3.1, difficulty: "Medium",
    blurb: "Recipes, cooking tips", defaultFamily: "narrated_stock",
    subcategories: [
      { id: "quick-recipes", name: "Quick recipes", searchVolume: 84, rpm: 3.1, tags: ["quick recipes", "easy recipes", "5 minute meals", "dinner ideas", "cooking", "recipe", "meal prep", "easy cooking"] },
      { id: "cooking-tips", name: "Cooking tips", searchVolume: 47, rpm: 3.0, tags: ["cooking tips", "kitchen hacks", "cooking techniques", "chef tips", "how to cook", "cooking basics", "food hacks"] },
    ],
  },
  {
    key: "travel", label: "Travel", icon: "📍", rpm: 3.4, difficulty: "Medium",
    blurb: "Destinations, guides", defaultFamily: "narrated_stock",
    subcategories: [
      { id: "destination-guides", name: "Destination guides", searchVolume: 76, rpm: 3.4, tags: ["travel guide", "best places to visit", "travel tips", "destination", "things to do", "travel vlog", "bucket list", "travel"] },
      { id: "hidden-gems", name: "Hidden gems", searchVolume: 42, rpm: 3.3, tags: ["hidden gems", "underrated travel", "secret spots", "off the beaten path", "unique destinations", "lesser known places"] },
    ],
  },
  {
    key: "entertainment", label: "Entertainment", icon: "▶️", rpm: 3.5, difficulty: "Easy",
    blurb: "Reviews, pop culture", defaultFamily: "narrated_stock",
    subcategories: [
      { id: "movie-reviews", name: "Movie Reviews", searchVolume: 52, rpm: 3.8, tags: ["movie review", "film", "cinema", "review", "rating", "recommendation", "netflix", "new movie"] },
      { id: "trending", name: "Trending Topics", searchVolume: 89, rpm: 3.2, tags: ["trending", "viral", "news", "reaction", "commentary", "pop culture", "2026"] },
      { id: "celebrity-news", name: "Celebrity News", searchVolume: 95, rpm: 3.0, tags: ["celebrity news", "celebrity", "gossip", "hollywood", "celebrity drama", "famous", "entertainment news"] },
      { id: "music-reviews", name: "Music Reviews", searchVolume: 44, rpm: 3.4, tags: ["music review", "new music", "album review", "song reaction", "music", "artist", "new song", "music breakdown"] },
      { id: "top-lists", name: "Pop Culture / Top 10", searchVolume: 67, rpm: 3.5, tags: ["top 10", "best of", "ranking", "list", "compilation", "countdown", "pop culture"] },
    ],
  },
  {
    key: "psychology", label: "Psychology", icon: "🧠", rpm: 4.8, difficulty: "Medium",
    blurb: "Stoicism, nihilism, philosophy", defaultFamily: "narrated_stock",
    subcategories: [
      { id: "stoicism", name: "Stoicism", searchVolume: 71, rpm: 5.5, tags: ["stoicism", "philosophy", "marcus aurelius", "stoic", "wisdom", "self improvement", "mindset", "seneca"] },
      { id: "nihilism", name: "Nihilism / existentialism", searchVolume: 38, rpm: 4.5, tags: ["nihilism", "existentialism", "meaning of life", "absurdism", "nietzsche", "camus", "philosophy", "existential"] },
      { id: "philosophy", name: "Philosophy", searchVolume: 63, rpm: 4.8, tags: ["philosophy", "wisdom", "deep thoughts", "life lessons", "ancient wisdom", "philosophers", "epictetus", "self reflection"] },
      { id: "mental-health", name: "Mental Health", searchVolume: 92, rpm: 4.2, tags: ["mental health", "anxiety", "depression", "therapy", "self care", "wellness", "mindfulness", "psychology"] },
      { id: "scripture-faith", name: "Scripture / faith readings", searchVolume: 49, rpm: 4.0, tags: ["bible", "scripture", "faith", "daily devotion", "christian", "prayer", "bible reading", "god"] },
    ],
  },
  {
    key: "crime", label: "Crime / Mystery", icon: "🕵️", rpm: 5.5, difficulty: "Hard",
    blurb: "True crime, heist, mystery", defaultFamily: "cinematic",
    subcategories: [
      { id: "true-crime", name: "True crime", searchVolume: 92, rpm: 5.8, tags: ["true crime", "crime story", "murder case", "criminal", "investigation", "case files", "crime documentary", "solved"] },
      { id: "heist-stories", name: "Heist stories", searchVolume: 41, rpm: 5.2, tags: ["heist", "robbery", "biggest heists", "crime caper", "stolen", "great heist", "true heist story"] },
      { id: "unsolved-mysteries", name: "Unsolved mysteries", searchVolume: 58, rpm: 5.3, tags: ["unsolved mystery", "mystery", "disappearance", "cold case", "unexplained", "missing", "creepy mystery"] },
    ],
  },
  {
    key: "history", label: "History", icon: "📜", rpm: 4.7, difficulty: "Medium",
    blurb: "Whiteboard history, documentaries", defaultFamily: "whiteboard",
    subcategories: [
      { id: "world-history", name: "World history", searchVolume: 79, rpm: 4.0, tags: ["history", "documentary", "ancient", "civilization", "historical", "timeline", "world history", "the past"] },
      { id: "wars-empires", name: "Wars / empires", searchVolume: 64, rpm: 4.5, tags: ["war history", "empire", "battle", "ancient rome", "world war", "military history", "rise and fall", "conquest"] },
      { id: "inventions", name: "Inventions", searchVolume: 45, rpm: 4.3, tags: ["inventions", "history of", "discovery", "innovation", "how it was invented", "origins", "breakthrough"] },
    ],
  },
  {
    key: "motivation", label: "Motivation", icon: "🔥", rpm: 3.6, difficulty: "Easy",
    blurb: "Speeches, shorts, discipline", defaultFamily: "shorts",
    subcategories: [
      { id: "motivational-shorts", name: "Motivational shorts", searchVolume: 96, rpm: 3.6, tags: ["motivation", "motivational speech", "inspiration", "discipline", "success", "mindset", "self improvement", "motivational video"] },
      { id: "discipline-mindset", name: "Discipline / mindset", searchVolume: 70, rpm: 3.8, tags: ["discipline", "self discipline", "mindset", "hard work", "mental toughness", "grind", "focus", "consistency"] },
      { id: "old-radio", name: "Old-radio narration", searchVolume: 22, rpm: 3.4, tags: ["old radio", "vintage motivation", "wisdom", "timeless advice", "classic speech", "narration", "retro"] },
    ],
  },
  {
    // 2026 breakout: ~21x growth, remarkably low competition, huge watch-time.
    // Faceless-perfect (AI voiceover + stock/atmospheric visuals).
    key: "stories", label: "Storytelling / Drama", icon: "🎭", rpm: 4.2, difficulty: "Easy",
    blurb: "Revenge, betrayal, Reddit stories", defaultFamily: "narrated_stock",
    subcategories: [
      { id: "revenge-betrayal", name: "Revenge & betrayal stories", searchVolume: 130, rpm: 4.5, tags: ["revenge story", "betrayal", "cheating story", "revenge", "story time", "dramatic story", "betrayal revenge", "satisfying revenge"] },
      { id: "reddit-stories", name: "Reddit stories (AITA, relationships)", searchVolume: 145, rpm: 4.0, tags: ["reddit stories", "aita", "am i the asshole", "reddit relationships", "reddit readings", "r slash", "reddit drama", "relationship stories"] },
      { id: "true-stories", name: "Dramatic true stories", searchVolume: 85, rpm: 4.3, tags: ["true story", "real story", "dramatic stories", "life story", "emotional story", "storytime", "true events", "inspiring story"] },
    ],
  },
  {
    // 2026 breakout: GLP-1/Ozempic search +800% since 2022; senior health rising.
    key: "health", label: "Health & Wellness", icon: "🩺", rpm: 7.5, difficulty: "Medium",
    blurb: "GLP-1, senior health, longevity", defaultFamily: "narrated_stock",
    subcategories: [
      { id: "glp1-weightloss", name: "GLP-1 / weight loss (Ozempic, Wegovy)", searchVolume: 165, rpm: 9.0, tags: ["ozempic", "wegovy", "glp-1", "weight loss", "mounjaro", "semaglutide", "weight loss journey", "zepbound"] },
      { id: "senior-health", name: "Senior health & longevity", searchVolume: 95, rpm: 8.0, tags: ["senior health", "longevity", "healthy aging", "health after 60", "anti aging", "living longer", "senior fitness", "health tips for seniors"] },
      { id: "sleep-recovery", name: "Sleep & recovery science", searchVolume: 78, rpm: 6.5, tags: ["sleep", "better sleep", "sleep science", "recovery", "insomnia", "deep sleep", "sleep tips", "circadian rhythm"] },
      { id: "nutrition", name: "Nutrition & supplements", searchVolume: 88, rpm: 7.0, tags: ["nutrition", "supplements", "healthy eating", "diet", "vitamins", "gut health", "nutrition science", "what to eat"] },
    ],
  },
  {
    // Highest-CPM cluster (research: business/SaaS/skills $14-35 CPM), low comp on skills.
    key: "business", label: "Business & Skills", icon: "💼", rpm: 9.5, difficulty: "Medium",
    blurb: "Entrepreneurship, SaaS, pro skills", defaultFamily: "narrated_stock",
    subcategories: [
      { id: "entrepreneurship", name: "Entrepreneurship & startups", searchVolume: 92, rpm: 10.0, tags: ["entrepreneurship", "startup", "business ideas", "how to start a business", "entrepreneur", "small business", "business tips", "founder"] },
      { id: "side-hustles", name: "Side hustles & online income", searchVolume: 135, rpm: 9.5, tags: ["side hustle", "make money online", "online business", "passive income", "work from home", "side income", "earn money", "online income"] },
      { id: "saas-reviews", name: "SaaS & software reviews", searchVolume: 70, rpm: 9.0, tags: ["saas", "software review", "best software", "business tools", "productivity software", "saas review", "tools for business"] },
      { id: "pro-skills", name: "Professional skills (Excel, PM)", searchVolume: 84, rpm: 8.5, tags: ["excel tutorial", "project management", "excel tips", "professional skills", "spreadsheet", "career skills", "microsoft excel", "work skills"] },
    ],
  },
];

export function getNiche(key: string): Niche | undefined {
  return NICHES.find((n) => n.key === key);
}

/** Resolve a subcategory by id OR display name within a niche. */
export function getSubcategory(nicheKey: string, idOrName?: string): Subcategory | undefined {
  if (!idOrName) return undefined;
  const subs = getNiche(nicheKey)?.subcategories ?? [];
  return subs.find((s) => s.id === idOrName || s.name === idOrName);
}

/** Seed SEO tags for a niche+subcategory selection (empty when unknown). */
export function subcategoryTags(nicheKey?: string, idOrName?: string): string[] {
  if (!nicheKey) return [];
  return getSubcategory(nicheKey, idOrName)?.tags ?? [];
}
