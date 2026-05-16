/**
 * Greeting pool for the empty chat state. Each entry is just the
 * salutation — the consumer appends ", {firstName}" when rendering.
 *
 * The picker returns one entry tuned to time-of-day and day-of-week
 * context so legal users see something that reads as thoughtful
 * ("Happy Friday" on Friday, "Rise and file" on a weekday morning)
 * rather than a single hardcoded line. Once a component mounts, the
 * choice is memoised for the lifetime of that view — static in
 * presentation, but intelligent in how it was chosen.
 *
 * Total: ~40 greetings. Legal flavour reflects language a working
 * lawyer would actually use (brief, docket, draft, on the record,
 * filing, session) without tipping into parody.
 */

interface GreetingPool {
  time: {
    morning: readonly string[];
    midday: readonly string[];
    afternoon: readonly string[];
    evening: readonly string[];
    late: readonly string[];
  };
  day: {
    monday: readonly string[];
    friday: readonly string[];
    weekend: readonly string[];
  };
  universal: readonly string[];
}

const POOL: GreetingPool = {
  time: {
    // 05:00 – 10:59
    morning: [
      "Good morning",
      "Morning",
      "Rise and file",
      "Early start",
      "Ready to draft",
      "Fresh docket",
      "First up today",
    ],
    // 11:00 – 13:59
    midday: [
      "Good day",
      "Midday",
      "Back from lunch",
    ],
    // 14:00 – 16:59
    afternoon: [
      "Good afternoon",
      "Afternoon",
      "Back at it",
      "Back in session",
      "Afternoon session",
    ],
    // 17:00 – 20:59
    evening: [
      "Good evening",
      "Evening",
      "Wrapping up",
      "One more matter",
      "Closing time",
    ],
    // 21:00 – 04:59
    late: [
      "Working late",
      "Burning the midnight oil",
      "Still on the clock",
      "Late filing",
    ],
  },
  day: {
    monday: ["Ready for the week", "Fresh week", "New docket"],
    friday: ["Happy Friday", "Almost there", "Final filings of the week"],
    weekend: ["Weekend session", "Off the clock, but on it"],
  },
  universal: [
    "Hi",
    "Hey",
    "Hello",
    "Howdy",
    "Greetings",
    "Welcome back",
    "Good to see you",
    "Ready when you are",
    "Let's get to work",
    "On the record",
    "Let's brief it",
  ],
};

function timeBucket(hour: number): keyof GreetingPool["time"] {
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 14) return "midday";
  if (hour >= 14 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "late";
}

function dayKey(day: number): keyof GreetingPool["day"] | null {
  // JS: 0 = Sunday ... 6 = Saturday
  if (day === 1) return "monday";
  if (day === 5) return "friday";
  if (day === 0 || day === 6) return "weekend";
  return null;
}

/**
 * Pick one greeting appropriate for `now`. Combines the current time
 * bucket, today's day bucket (if any), and the universal pool into a
 * single candidate list, then chooses uniformly at random. Because
 * time/day lists are short (2–7 entries) relative to the universal
 * pool (11), context-specific greetings already fire roughly 40-50%
 * of the time without explicit weighting.
 */
export function pickGreeting(now: Date = new Date()): string {
  const timeList = POOL.time[timeBucket(now.getHours())];
  const dKey = dayKey(now.getDay());
  const dayList = dKey ? POOL.day[dKey] : [];
  const combined = [...timeList, ...dayList, ...POOL.universal];
  const i = Math.floor(Math.random() * combined.length);
  return combined[i] ?? "Hi";
}
