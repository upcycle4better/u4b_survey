export const REPORT_PALETTE = {
  light: "#e5efd7",
  green: "#bcdc87",
  grey: "#b2b2b2",
  blue: "#417fa2",
  purple: "#7e468a",
  violet: "#635a92",
  olive: "#566b43"
};

const P = REPORT_PALETTE;
const sevenColors = [P.green, P.blue, P.purple, P.olive, P.grey, P.violet, P.light];

export const LEARNING_THEMES = [
  {
    label: "Environmental protection and resource impacts",
    keywords: ["environment", "water", "pollution", "resource", "impact", "carbon", "climate", "landfill", "alam sekitar", "pencemaran", "tapak pelupusan"]
  },
  {
    label: "Recycling, reuse and upcycling",
    keywords: ["recycl", "reuse", "upcycl", "repurpose", "circular", "textile bin", "kitar semula", "guna semula"]
  },
  {
    label: "Waste reduction and responsible consumption",
    keywords: ["waste", "reduce", "consumption", "buy", "purchase", "donate", "throw", "clothing", "sisa", "kurangkan", "pembaziran", "pakaian", "buang"]
  },
  {
    label: "Sustainability, ESG and corporate responsibility",
    keywords: ["sustainab", "esg", "corporate", "responsibility", "awareness", "campaign", "kelestarian", "lestari", "tanggungjawab", "kesedaran", "kempen"]
  },
  {
    label: "Other learning themes",
    keywords: []
  }
];

export const REPORT_CHARTS = [
  {
    number: 1, id: "gender", section: "DEMOGRAPHICS", kind: "pie", title: "Gender",
    key: "GENDER", categories: ["Female", "Male"], colors: [P.green, P.blue]
  },
  {
    number: 2, id: "age", section: "DEMOGRAPHICS", kind: "pie", title: "Age",
    key: "AGE", categories: ["7-9", "10-12", "13-15", "16-18", "19-21", "22-24", "25+"], colors: sevenColors
  },
  {
    number: 3, id: "knowledge-before", section: "KNOWLEDGE", kind: "pie",
    title: "How much do you know about textile waste and recycling?",
    key: "Q1", categories: ["I know nothing", "I know a little bit", "I know a lot", "I know everything"],
    colors: [P.green, P.blue, P.olive, P.purple]
  },
  {
    number: 4, id: "knowledge-change", section: "KNOWLEDGE", kind: "pie",
    title: "How has what you know about textile waste and recycling changed?",
    key: "Q10", categories: ["It has changed a lot", "It has changed a little", "It has not changed"],
    colors: [P.green, P.blue, P.olive]
  },
  {
    number: 5, id: "learning-themes", section: "KNOWLEDGE", kind: "bar",
    title: "What is the most important thing you learned about textile recycling?",
    key: "Q11", categories: LEARNING_THEMES.map(theme => theme.label), colors: [P.green]
  },
  {
    number: 6, id: "unwanted-clothing", section: "PRACTICES", kind: "stacked", multi: true,
    title: "What do you do with unwanted clothing - before and after the school visit?",
    keyA: "Q4", keyB: "Q15",
    categories: ["Donate it to charity", "Throw it in the trash", "Drop it at a textile recycling bin", "Give it to friends or family", "Repurpose it as cloths/items", "Other"],
    colors: [P.green, P.grey, P.blue, P.purple, P.violet, P.olive]
  },
  {
    number: 7, id: "disposal-reasons", section: "PRACTICES", kind: "bar", multi: true,
    title: "What is your reason for getting rid of clothing?",
    key: "Q5",
    categories: ["It does not fit anymore", "It is damaged", "I do not like it anymore", "I never wear it", "It is not fashionable anymore", "Other"],
    colors: [P.green, P.blue, P.olive, P.grey, P.light, P.purple]
  },
  {
    number: 8, id: "purchase-frequency", section: "PRACTICES", kind: "stacked",
    title: "How often do you buy new clothing - before and after the school visit?",
    keyA: "Q6", keyB: "Q16",
    categories: ["Weekly", "Every month", "Every few months", "Every six months", "Yearly", "Other"],
    colors: [P.green, P.grey, P.blue, P.purple, P.violet, P.olive]
  },
  {
    number: 9, id: "environment-care", section: "ATTITUDES", kind: "stacked",
    title: "How much do you care about the environment - before and after the school visit?",
    keyA: "Q2", keyB: "Q13",
    categories: ["I do not care at all", "I care a little", "I care a lot"],
    sourceValuesA: ["I do not care", "I care a little", "I care a lot"],
    sourceValuesB: ["I do not care at all", "I care a little", "I care a lot"],
    colors: [P.light, P.green, P.blue]
  },
  {
    number: 10, id: "recycling-importance", section: "ATTITUDES", kind: "stacked",
    title: "How important is textile waste and recycling - before and after the school visit?",
    keyA: "Q3", keyB: "Q14",
    categories: ["Not important at all", "A little important", "Important", "Very important"],
    sourceValuesA: ["Not Important", "A little Important", "Important", "Very Important"],
    sourceValuesB: ["Not important at all", "A little important", "Important", "Very important"],
    colors: [P.light, P.green, P.grey, P.blue]
  },
  {
    number: 11, id: "emotions", section: "ATTITUDES", kind: "bar", multi: true,
    title: "How did the school visit make you feel about textile recycling?",
    key: "Q12",
    categories: ["Happy", "Sad", "Motivated", "Confused", "Interested in the topic", "Angry", "Other"],
    colors: [P.green, P.light, P.blue, P.grey, P.olive, P.purple, P.violet]
  },
  {
    number: 12, id: "current-second-hand", section: "PRACTICES", kind: "pie",
    title: "Do you shop at thrift or bundle stores?",
    key: "Q7", categories: ["Yes", "No"], colors: [P.green, P.blue]
  },
  {
    number: 13, id: "second-hand-frequency", section: "PRACTICES", kind: "pie",
    title: "If yes, how often do you shop second-hand?",
    key: "Q8", filter: { key: "Q7", equals: "Yes" },
    categories: ["Weekly", "Every month", "Every few months", "Every six months", "Yearly", "Other"],
    colors: [P.green, P.blue, P.olive, P.purple, P.violet, P.grey]
  },
  {
    number: 14, id: "future-second-hand", section: "PRACTICES", kind: "pie",
    title: "In the future, would you consider shopping at thrift or bundle stores?",
    key: "Q17", categories: ["Yes", "No"], colors: [P.green, P.blue]
  },
  {
    number: 15, id: "personal-impact", section: "ATTITUDES", kind: "stacked",
    title: "How much do you agree: I can help reduce textile waste?",
    keyA: "Q9", keyB: "Q18",
    categories: ["Strongly disagree", "Disagree", "Agree", "Strongly agree"],
    colors: [P.light, P.green, P.grey, P.blue]
  },
  {
    number: 16, id: "sharing-learning", section: "ATTITUDES", kind: "pie",
    title: "How likely are you to tell other people what you learned today?",
    key: "Q19", categories: ["Very unlikely", "Unlikely", "Likely", "Very likely"],
    colors: [P.light, P.grey, P.olive, P.green]
  }
];

export function answerValue(survey, key) {
  return survey.answers?.[key]?.value ?? survey.answers?.[key] ?? "";
}

function answerList(survey, key) {
  const value = answerValue(survey, key);
  return Array.isArray(value) ? value : value ? [value] : [];
}

function sideField(definition, field, side) {
  if (!side) return definition[field];
  return definition[`${field}${side}`];
}

function passesFilter(survey, filter) {
  return !filter || answerValue(survey, filter.key) === filter.equals;
}

export function resolveChartCategories(definition, surveys) {
  return [...definition.categories];
}

function themeCounts(surveys) {
  const counts = new Array(LEARNING_THEMES.length).fill(0);
  for (const survey of surveys) {
    const text = String(answerValue(survey, "Q11"))
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
    if (!text) continue;
    let matched = false;
    LEARNING_THEMES.slice(0, -1).forEach((theme, index) => {
      if (theme.keywords.some(keyword => text.includes(keyword))) {
        counts[index] += 1;
        matched = true;
      }
    });
    if (!matched) counts[counts.length - 1] += 1;
  }
  return counts;
}

function countCategory(definition, surveys, category, side = "") {
  const key = sideField(definition, "key", side);
  const baseIndex = definition.categories.indexOf(category);
  const sourceValues = sideField(definition, "sourceValues", side) || definition.categories;
  const expectedValue = baseIndex >= 0 ? sourceValues[baseIndex] : "Other";
  let count = 0;

  for (const survey of surveys) {
    if (!passesFilter(survey, definition.filter)) continue;
    const values = answerList(survey, key);
    if (baseIndex >= 0) {
      if (values.includes(expectedValue)) count += 1;
      continue;
    }
  }
  return count;
}

export function resolveChartData(definition, surveys) {
  const categories = resolveChartCategories(definition, surveys);
  if (definition.id === "learning-themes") {
    return { categories, values: themeCounts(surveys) };
  }
  if (definition.kind === "stacked") {
    return {
      categories,
      valuesA: categories.map(category => countCategory(definition, surveys, category, "A")),
      valuesB: categories.map(category => countCategory(definition, surveys, category, "B"))
    };
  }
  return { categories, values: categories.map(category => countCategory(definition, surveys, category)) };
}
