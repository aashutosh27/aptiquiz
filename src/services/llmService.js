import { AppError } from '../utils/errorModule.js';
import { aiGeneratedQuestionSchema, aiGeneratedListSchema } from '../utils/validators.js';
import { config } from '../config/env.js';
import { logger } from '../utils/errorModule.js';

// In-memory rate limiting for LLM generation: hostId -> Array of timestamps
const hostLlmSuccessLog = new Map();

// Recent question stems sliding window buffer (up to 30 stems)
const recentStems = [];

/**
 * Record a question stem into recent stems buffer (max 30)
 */
export function recordRecentStem(stem) {
  if (!stem || typeof stem !== 'string') return;
  const clean = stem.trim();
  if (!recentStems.includes(clean)) {
    recentStems.push(clean);
    if (recentStems.length > 30) {
      recentStems.shift();
    }
  }
}

/**
 * Get current recent stems buffer
 */
export function getRecentStems() {
  return [...recentStems];
}

/**
 * Tokenize text for Jaccard similarity comparison
 */
export function getTokens(text) {
  return new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

/**
 * Calculate Jaccard Similarity between two texts
 */
export function calculateJaccardSimilarity(textA, textB) {
  const setA = getTokens(textA);
  const setB = getTokens(textB);
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersectionCount = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      intersectionCount++;
    }
  }
  const unionSize = setA.size + setB.size - intersectionCount;
  return unionSize > 0 ? intersectionCount / unionSize : 0;
}

/**
 * Strip markdown code fences (```json ... ```) before JSON parsing
 */
export function stripCodeFences(text) {
  if (!text) return '';
  let cleaned = String(text).trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/gi, '').replace(/\s*```$/g, '');
  return cleaned.trim();
}

/**
 * Check host rate limit: max 5 requests per 10 minutes (600,000 ms)
 * Note: Does not mutate timestamps array here; only successful calls are recorded.
 */
export function checkLlmRateLimit(hostId) {
  const now = Date.now();
  const tenMinutesAgo = now - 600000;

  const timestamps = hostLlmSuccessLog.get(hostId) || [];
  const validTimestamps = timestamps.filter((t) => t > tenMinutesAgo);

  if (validTimestamps.length >= 5) {
    throw new AppError('RATE_LIMITED', 'Limit of 5 AI generation requests per 10 minutes reached.');
  }
}

/**
 * Record a successful LLM generation request against host rate limit
 */
export function recordLlmSuccess(hostId) {
  const now = Date.now();
  const tenMinutesAgo = now - 600000;

  const timestamps = hostLlmSuccessLog.get(hostId) || [];
  const validTimestamps = timestamps.filter((t) => t > tenMinutesAgo);
  validTimestamps.push(now);
  hostLlmSuccessLog.set(hostId, validTimestamps);
}

/**
 * Helper to dynamically generate variations of fallback questions (randomizing numerical inputs, option order, and correct answer mapping)
 */
export function generateDynamicQuestionVariant(rawQ, cleanTopic) {
  // Deep clone raw question
  const q = JSON.parse(JSON.stringify(rawQ));
  const origText = q.text || '';
  let correctText = q.options.find((o) => o.id === q.correct_option_id)?.text || '';

  // 1. Numerical & Dynamic parameter randomization for supported templates
  if (/if 3x \+ 7 = 22/i.test(origText) || /if \d+x \+ \d+ = \d+/i.test(origText)) {
    const a = Math.floor(Math.random() * 6) + 2; // 2..7
    const b = Math.floor(Math.random() * 10) + 3; // 3..12
    const x = Math.floor(Math.random() * 10) + 3; // 3..12
    const c = a * x + b;
    q.text = `In ${cleanTopic}, if ${a}x + ${b} = ${c}, what is the value of x?`;
    correctText = String(x);
    q.options = [
      { id: 'A', text: String(x) },
      { id: 'B', text: String(x - 1) },
      { id: 'C', text: String(x + 1) },
      { id: 'D', text: String(x + 2) },
    ];
    q.explanation = `Subtract ${b} from both sides: ${a}x = ${c - b}. Divide by ${a}: x = ${x}.`;
  } else if (/increases from 200 to 250/i.test(origText) || /percentage increase/i.test(origText)) {
    const startList = [100, 200, 300, 400, 500];
    const pctList = [10, 15, 20, 25, 30, 40, 50];
    const start = startList[Math.floor(Math.random() * startList.length)];
    const pct = pctList[Math.floor(Math.random() * pctList.length)];
    const end = start * (1 + pct / 100);
    q.text = `In ${cleanTopic}, if a primary variable increases from ${start} to ${end}, what is the percentage increase?`;
    correctText = `${pct}%`;
    q.options = [
      { id: 'A', text: `${pct}%` },
      { id: 'B', text: `${pct - 5}%` },
      { id: 'C', text: `${pct + 5}%` },
      { id: 'D', text: `${pct + 10}%` },
    ];
    q.explanation = `Percentage increase = ((${end} - ${start}) / ${start}) * 100 = (${end - start} / ${start}) * 100 = ${pct}%.`;
  } else if (/ratio of A to B is 3:4/i.test(origText) || /ratio of A to B is \d+:\d+/i.test(origText)) {
    const ratios = [{ r1: 3, r2: 4 }, { r1: 2, r2: 5 }, { r1: 4, r2: 5 }, { r1: 3, r2: 5 }];
    const chosen = ratios[Math.floor(Math.random() * ratios.length)];
    const m = Math.floor(Math.random() * 7) + 3; // 3..9
    const valA = chosen.r1 * m;
    const valB = chosen.r2 * m;
    q.text = `When calculating parameters in ${cleanTopic}, if the ratio of A to B is ${chosen.r1}:${chosen.r2} and A = ${valA}, what is B?`;
    correctText = String(valB);
    q.options = [
      { id: 'A', text: String(valB) },
      { id: 'B', text: String(valB - 4) },
      { id: 'C', text: String(valB + 4) },
      { id: 'D', text: String(valB + 8) },
    ];
    q.explanation = `${chosen.r1} / ${chosen.r2} = ${valA} / B => ${chosen.r1}B = ${valA * chosen.r2} => B = ${valB}.`;
  } else if (/what is 15% of 400/i.test(origText) || /what is \d+% of \d+/i.test(origText)) {
    const pcts = [10, 15, 20, 25, 30, 40, 50];
    const nums = [100, 200, 300, 400, 500, 600, 800];
    const pct = pcts[Math.floor(Math.random() * pcts.length)];
    const num = nums[Math.floor(Math.random() * nums.length)];
    const ans = (pct * num) / 100;
    q.text = `In ${cleanTopic}, what is ${pct}% of ${num}?`;
    correctText = String(ans);
    q.options = [
      { id: 'A', text: String(ans) },
      { id: 'B', text: String(ans - 10) },
      { id: 'C', text: String(ans + 10) },
      { id: 'D', text: String(ans + 20) },
    ];
    q.explanation = `${pct}% of ${num} = (${pct} / 100) * ${num} = ${pct * (num / 100)} = ${ans}.`;
  } else if (/4 units generate 60 output cycles/i.test(origText)) {
    const u1 = Math.floor(Math.random() * 4) + 3; // 3..6
    const perUnit = [10, 15, 20, 25][Math.floor(Math.random() * 4)];
    const u2 = u1 + Math.floor(Math.random() * 4) + 2;
    const c1 = u1 * perUnit;
    const c2 = u2 * perUnit;
    q.text = `In an experiment involving ${cleanTopic}, if ${u1} units generate ${c1} output cycles, how many cycles will ${u2} units generate?`;
    correctText = String(c2);
    q.options = [
      { id: 'A', text: String(c2) },
      { id: 'B', text: String(c2 - 10) },
      { id: 'C', text: String(c2 + 10) },
      { id: 'D', text: String(c2 + 15) },
    ];
    q.explanation = `Output per unit = ${c1} / ${u1} = ${perUnit}. Total for ${u2} units = ${u2} * ${perUnit} = ${c2}.`;
  } else if (/rate of flow is 60 units\/hr/i.test(origText)) {
    const rates = [40, 50, 60, 75, 80, 100];
    const times = [1.5, 2, 2.5, 3, 4];
    const rate = rates[Math.floor(Math.random() * rates.length)];
    const time = times[Math.floor(Math.random() * times.length)];
    const vol = rate * time;
    q.text = `In ${cleanTopic}, if rate of flow is ${rate} units/hr and time is ${time} hours, what is the total volume processed?`;
    correctText = `${vol} units`;
    q.options = [
      { id: 'A', text: `${vol} units` },
      { id: 'B', text: `${vol - 30} units` },
      { id: 'C', text: `${vol + 30} units` },
      { id: 'D', text: `${vol + 50} units` },
    ];
    q.explanation = `Volume = Rate * Time = ${rate} * ${time} = ${vol} units.`;
  } else if (/first derivative dy\/dx of y = 4x\^3 - 5x\^2 \+ 7/i.test(origText)) {
    const a = Math.floor(Math.random() * 5) + 2; // 2..6
    const b = Math.floor(Math.random() * 7) + 2; // 2..8
    const c = Math.floor(Math.random() * 9) + 1; // 1..9
    const d1 = a * 3;
    const d2 = b * 2;
    q.text = `In ${cleanTopic}, what is the first derivative dy/dx of y = ${a}x^3 - ${b}x^2 + ${c}?`;
    correctText = `${d1}x^2 - ${d2}x`;
    q.options = [
      { id: 'A', text: `${d1}x^2 - ${d2}x` },
      { id: 'B', text: `${d1}x^2 - ${b}x` },
      { id: 'C', text: `${a}x^2 - ${d2}x` },
      { id: 'D', text: `${d1}x^3 - ${d2}x` },
    ];
    q.explanation = `Using power rule: d/dx(${a}x^3) = ${d1}x^2 and d/dx(-${b}x^2) = -${d2}x. Derivative = ${d1}x^2 - ${d2}x.`;
  } else if (/average of 4 measurements is 15/i.test(origText) || /average of \d+ measurements is \d+/i.test(origText)) {
    const count = [3, 4, 5, 6][Math.floor(Math.random() * 4)];
    const avg = [12, 15, 20, 25, 30][Math.floor(Math.random() * 5)];
    const sum = count * avg;
    q.text = `In ${cleanTopic}, if the average of ${count} measurements is ${avg}, what is their total sum?`;
    correctText = String(sum);
    q.options = [
      { id: 'A', text: String(sum) },
      { id: 'B', text: String(sum - 15) },
      { id: 'C', text: String(sum + 15) },
      { id: 'D', text: String(sum + 30) },
    ];
    q.explanation = `Total sum = Average * Count = ${avg} * ${count} = ${sum}.`;
  } else if (/geometric sequence: 3, 6, 12, 24, __/i.test(origText)) {
    const start = Math.floor(Math.random() * 4) + 2; // 2..5
    const r = Math.floor(Math.random() * 2) + 2; // 2..3
    const t1 = start;
    const t2 = start * r;
    const t3 = start * r * r;
    const t4 = start * r * r * r;
    const next = start * r * r * r * r;
    q.text = `In ${cleanTopic}, what is the next term in the geometric sequence: ${t1}, ${t2}, ${t3}, ${t4}, __?`;
    correctText = String(next);
    q.options = [
      { id: 'A', text: String(next) },
      { id: 'B', text: String(next - 12) },
      { id: 'C', text: String(next + 12) },
      { id: 'D', text: String(next + 24) },
    ];
    q.explanation = `The common ratio is ${r}. The next term is ${t4} * ${r} = ${next}.`;
  } else if (/value of 5! \(5 factorial\)/i.test(origText)) {
    const nList = [4, 5, 6];
    const n = nList[Math.floor(Math.random() * nList.length)];
    const facts = { 4: 24, 5: 120, 6: 720 };
    const fact = facts[n];
    q.text = `In ${cleanTopic}, what is the value of ${n}! (${n} factorial)?`;
    correctText = String(fact);
    q.options = [
      { id: 'A', text: String(fact) },
      { id: 'B', text: String(fact / 2) },
      { id: 'C', text: String(fact + 30) },
      { id: 'D', text: String(fact * 2) },
    ];
    q.explanation = `${n}! = ${Array.from({ length: n }, (_, i) => n - i).join(' * ')} = ${fact}.`;
  }

  // 2. Ensure topic name substitution in question text if generic or cleanTopic needed
  if (!q.text.includes(cleanTopic)) {
    q.text = q.text.replace(/In [^,]+,/, `In ${cleanTopic},`);
  }

  // 3. Shuffle options array and re-map correct_option_id
  const optionTexts = q.options.map((o) => o.text);
  for (let i = optionTexts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [optionTexts[i], optionTexts[j]] = [optionTexts[j], optionTexts[i]];
  }

  const ids = ['A', 'B', 'C', 'D'];
  q.options = optionTexts.map((txt, index) => ({
    id: ids[index],
    text: txt,
  }));

  const newCorrectOption = q.options.find((o) => o.text === correctText);
  if (newCorrectOption) {
    q.correct_option_id = newCorrectOption.id;
  } else {
    q.correct_option_id = 'A';
  }

  return q;
}

/**
 * Topic-Specific Fallback Question Generator
 */
export function getFallbackQuestions(topic = 'General Aptitude', category = 'quantitative', difficulty = 'medium', count = 3) {
  const cleanTopic = String(topic || 'General Aptitude').trim();
  const lowerTopic = cleanTopic.toLowerCase();

  const topicBanks = {
    probability: [
      {
        text: 'What is the probability of rolling a sum of 7 with two standard 6-sided dice?',
        options: [
          { id: 'A', text: '1/12' },
          { id: 'B', text: '1/6' },
          { id: 'C', text: '1/4' },
          { id: 'D', text: '1/3' },
        ],
        correct_option_id: 'B',
        topic: category || 'quantitative',
        difficulty: difficulty || 'medium',
        explanation: 'There are 6 favorable combinations (1+6, 2+5, 3+4, 4+3, 5+2, 6+1) out of 36 total outcomes. 6/36 = 1/6.',
      },
      {
        text: 'A bag contains 4 red balls and 6 blue balls. What is the probability of drawing a red ball at random?',
        options: [
          { id: 'A', text: '2/5' },
          { id: 'B', text: '3/5' },
          { id: 'C', text: '1/2' },
          { id: 'D', text: '4/5' },
        ],
        correct_option_id: 'A',
        topic: category || 'quantitative',
        difficulty: difficulty || 'medium',
        explanation: 'Probability = Red balls / Total balls = 4 / (4 + 6) = 4/10 = 2/5.',
      },
      {
        text: 'Two fair coins are tossed simultaneously. What is the probability of getting at least one Head?',
        options: [
          { id: 'A', text: '1/4' },
          { id: 'B', text: '1/2' },
          { id: 'C', text: '3/4' },
          { id: 'D', text: '1' },
        ],
        correct_option_id: 'C',
        topic: category || 'quantitative',
        difficulty: difficulty || 'medium',
        explanation: 'Outcomes are HH, HT, TH, TT. 3 out of 4 outcomes contain at least one head.',
      },
      {
        text: 'A single card is drawn from a standard deck of 52 cards. What is the probability of drawing an Ace?',
        options: [
          { id: 'A', text: '1/52' },
          { id: 'B', text: '1/13' },
          { id: 'C', text: '1/4' },
          { id: 'D', text: '4/13' },
        ],
        correct_option_id: 'B',
        topic: category || 'quantitative',
        difficulty: difficulty || 'medium',
        explanation: 'There are 4 Aces in 52 cards. Probability = 4 / 52 = 1/13.',
      },
    ],
    syllogism: [
      {
        text: 'Statements: All cats are animals. All animals are mammals. Which conclusion is valid?',
        options: [
          { id: 'A', text: 'All cats are mammals' },
          { id: 'B', text: 'No cats are mammals' },
          { id: 'C', text: 'Some cats are not animals' },
          { id: 'D', text: 'None of the above' },
        ],
        correct_option_id: 'A',
        topic: category || 'logical',
        difficulty: difficulty || 'medium',
        explanation: 'If all A are B and all B are C, then all A are C.',
      },
      {
        text: 'Statements: Some apples are fruits. All fruits are healthy. Which conclusion follows?',
        options: [
          { id: 'A', text: 'Some apples are healthy' },
          { id: 'B', text: 'No apples are healthy' },
          { id: 'C', text: 'All healthy things are apples' },
          { id: 'D', text: 'No conclusion follows' },
        ],
        correct_option_id: 'A',
        topic: category || 'logical',
        difficulty: difficulty || 'medium',
        explanation: 'Since some apples belong to fruits and all fruits are healthy, those apples must be healthy.',
      },
      {
        text: 'Statements: No square is a circle. All circles are round. Conclusion: Some round shapes are not squares.',
        options: [
          { id: 'A', text: 'Valid' },
          { id: 'B', text: 'Invalid' },
          { id: 'C', text: 'Undetermined' },
          { id: 'D', text: 'False' },
        ],
        correct_option_id: 'A',
        topic: category || 'logical',
        difficulty: difficulty || 'medium',
        explanation: 'Circles are round and no circle is square, so circles represent round shapes that are not squares.',
      },
    ],
    time_distance: [
      {
        text: 'A train running at 54 km/h crosses a pole in 10 seconds. What is the length of the train?',
        options: [
          { id: 'A', text: '120m' },
          { id: 'B', text: '150m' },
          { id: 'C', text: '180m' },
          { id: 'D', text: '200m' },
        ],
        correct_option_id: 'B',
        topic: category || 'quantitative',
        difficulty: difficulty || 'medium',
        explanation: 'Speed = 54 * (5/18) = 15 m/s. Length = Speed * Time = 15 * 10 = 150 meters.',
      },
      {
        text: 'A train running at 72 km/h crosses a 200m long platform in 25 seconds. What is the length of the train?',
        options: [
          { id: 'A', text: '250m' },
          { id: 'B', text: '300m' },
          { id: 'C', text: '350m' },
          { id: 'D', text: '400m' },
        ],
        correct_option_id: 'B',
        topic: category || 'quantitative',
        difficulty: difficulty || 'medium',
        explanation: 'Speed = 72 * (5/18) = 20 m/s. Total distance = 20 * 25 = 500m. Train length = 500 - 200 = 300m.',
      },
      {
        text: 'If a person walks at 4 km/h, they take 3 hours to complete a journey. How long will it take at 6 km/h?',
        options: [
          { id: 'A', text: '1.5 hours' },
          { id: 'B', text: '2 hours' },
          { id: 'C', text: '2.5 hours' },
          { id: 'D', text: '3.5 hours' },
        ],
        correct_option_id: 'B',
        topic: category || 'quantitative',
        difficulty: difficulty || 'medium',
        explanation: 'Distance = 4 * 3 = 12 km. Time = 12 / 6 = 2 hours.',
      },
    ],
    profit_loss: [
      {
        text: 'An item bought for $80 is sold for $100. What is the profit percentage?',
        options: [
          { id: 'A', text: '20%' },
          { id: 'B', text: '25%' },
          { id: 'C', text: '30%' },
          { id: 'D', text: '35%' },
        ],
        correct_option_id: 'B',
        topic: category || 'quantitative',
        difficulty: difficulty || 'medium',
        explanation: 'Profit = $100 - $80 = $20. Profit % = (20 / 80) * 100 = 25%.',
      },
      {
        text: 'Find the simple interest on $5,000 at 8% per annum for 3 years.',
        options: [
          { id: 'A', text: '$1,000' },
          { id: 'B', text: '$1,200' },
          { id: 'C', text: '$1,400' },
          { id: 'D', text: '$1,500' },
        ],
        correct_option_id: 'B',
        topic: category || 'quantitative',
        difficulty: difficulty || 'medium',
        explanation: 'SI = (P * R * T) / 100 = (5000 * 8 * 3) / 100 = 1200.',
      },
    ],
    primes: [
      {
        text: 'What is the sum of the prime numbers between 1 and 10?',
        options: [
          { id: 'A', text: '15' },
          { id: 'B', text: '17' },
          { id: 'C', text: '18' },
          { id: 'D', text: '20' },
        ],
        correct_option_id: 'B',
        topic: category || 'quantitative',
        difficulty: difficulty || 'medium',
        explanation: 'The prime numbers between 1 and 10 are 2, 3, 5, 7. Sum = 2 + 3 + 5 + 7 = 17.',
      },
      {
        text: 'How many prime numbers exist between 10 and 20?',
        options: [
          { id: 'A', text: '3' },
          { id: 'B', text: '4' },
          { id: 'C', text: '5' },
          { id: 'D', text: '6' },
        ],
        correct_option_id: 'B',
        topic: category || 'quantitative',
        difficulty: difficulty || 'medium',
        explanation: 'The primes between 10 and 20 are 11, 13, 17, 19 (total 4).',
      },
    ],
    coding_logic: [
      {
        text: `If 'CLOCK' is coded as '34639', how is 'LOCK' coded in the same pattern?`,
        options: [
          { id: 'A', text: '4369' },
          { id: 'B', text: '4639' },
          { id: 'C', text: '3469' },
          { id: 'D', text: '4693' },
        ],
        correct_option_id: 'B',
        topic: category || 'logical',
        difficulty: difficulty || 'medium',
        explanation: 'From CLOCK -> C=3, L=4, O=6, C=3, K=9. So LOCK -> 4639.',
      },
      {
        text: `Pointing to a photo, Rahul said "His mother is the only daughter of my mother". How is Rahul related to the person in the photo?`,
        options: [
          { id: 'A', text: 'Father' },
          { id: 'B', text: 'Uncle' },
          { id: 'C', text: 'Brother' },
          { id: 'D', text: 'Grandfather' },
        ],
        correct_option_id: 'B',
        topic: category || 'logical',
        difficulty: difficulty || 'medium',
        explanation: 'Only daughter of Rahul’s mother is Rahul’s sister. Her child’s uncle is Rahul.',
      },
    ],
    verbal: [
      {
        text: `Select the word that is most opposite in meaning to 'METICULOUS':`,
        options: [
          { id: 'A', text: 'Careless' },
          { id: 'B', text: 'Detailed' },
          { id: 'C', text: 'Precise' },
          { id: 'D', text: 'Cautious' },
        ],
        correct_option_id: 'A',
        topic: category || 'verbal',
        difficulty: difficulty || 'easy',
        explanation: 'Meticulous means taking extreme care. Its opposite is careless.',
      },
      {
        text: `Choose the synonym of 'BENEVOLENT':`,
        options: [
          { id: 'A', text: 'Kind' },
          { id: 'B', text: 'Cruel' },
          { id: 'C', text: 'Greedy' },
          { id: 'D', text: 'Selfish' },
        ],
        correct_option_id: 'A',
        topic: category || 'verbal',
        difficulty: difficulty || 'easy',
        explanation: 'Benevolent means well-meaning and kindly.',
      },
    ],
    data_interpretation: [
      {
        text: `In a company, sales rose from 400 units in 2022 to 500 units in 2023. What is the percentage growth?`,
        options: [
          { id: 'A', text: '20%' },
          { id: 'B', text: '25%' },
          { id: 'C', text: '30%' },
          { id: 'D', text: '50%' },
        ],
        correct_option_id: 'B',
        topic: category || 'data_interpretation',
        difficulty: difficulty || 'medium',
        explanation: 'Growth = ((500 - 400) / 400) * 100 = (100 / 400) * 100 = 25%.',
      },
    ],
    python: [
      {
        text: `In ${cleanTopic}, what is the output of print(type([1, 2, 3]))?`,
        options: [
          { id: 'A', text: "<class 'list'>" },
          { id: 'B', text: "<class 'array'>" },
          { id: 'C', text: "<class 'tuple'>" },
          { id: 'D', text: "<class 'set'>" },
        ],
        correct_option_id: 'A',
        topic: category || 'quantitative',
        difficulty: difficulty || 'easy',
        explanation: 'Square brackets `[]` define a built-in `list` object in Python.',
      },
      {
        text: `In ${cleanTopic}, what will print("Python"[1:4]) output?`,
        options: [
          { id: 'A', text: 'ytho' },
          { id: 'B', text: 'yth' },
          { id: 'C', text: 'Pyt' },
          { id: 'D', text: 'hon' },
        ],
        correct_option_id: 'B',
        topic: category || 'quantitative',
        difficulty: difficulty || 'medium',
        explanation: 'String slicing `[1:4]` extracts characters starting at index 1 up to (excluding) index 4: "yth".',
      },
      {
        text: `In ${cleanTopic}, which data structure is immutable?`,
        options: [
          { id: 'A', text: 'List' },
          { id: 'B', text: 'Dictionary' },
          { id: 'C', text: 'Tuple' },
          { id: 'D', text: 'Set' },
        ],
        correct_option_id: 'C',
        topic: category || 'quantitative',
        difficulty: difficulty || 'easy',
        explanation: 'Tuples are immutable in Python; their elements cannot be changed after creation.',
      },
      {
        text: `In ${cleanTopic}, what will bool([]) evaluate to?`,
        options: [
          { id: 'A', text: 'True' },
          { id: 'B', text: 'False' },
          { id: 'C', text: 'None' },
          { id: 'D', text: 'TypeError' },
        ],
        correct_option_id: 'B',
        topic: category || 'quantitative',
        difficulty: difficulty || 'easy',
        explanation: 'Empty containers like lists, tuples, dicts, and strings evaluate to `False` in Python boolean contexts.',
      },
      {
        text: `In ${cleanTopic}, which keyword is used to define a function?`,
        options: [
          { id: 'A', text: 'func' },
          { id: 'B', text: 'def' },
          { id: 'C', text: 'function' },
          { id: 'D', text: 'define' },
        ],
        correct_option_id: 'B',
        topic: category || 'quantitative',
        difficulty: difficulty || 'easy',
        explanation: 'Functions in Python are defined using the `def` keyword.',
      },
    ],
    sql: [
      {
        text: 'Which SQL clause is used to filter records after aggregation (GROUP BY)?',
        options: [
          { id: 'A', text: 'WHERE' },
          { id: 'B', text: 'HAVING' },
          { id: 'C', text: 'ORDER BY' },
          { id: 'D', text: 'FILTER' },
        ],
        correct_option_id: 'B',
        topic: category || 'quantitative',
        difficulty: difficulty || 'medium',
        explanation: 'The `HAVING` clause filters aggregated grouped data; `WHERE` filters rows prior to aggregation.',
      },
      {
        text: 'Which JOIN type returns all records when there is a match in either left or right table?',
        options: [
          { id: 'A', text: 'INNER JOIN' },
          { id: 'B', text: 'LEFT JOIN' },
          { id: 'C', text: 'FULL OUTER JOIN' },
          { id: 'D', text: 'CROSS JOIN' },
        ],
        correct_option_id: 'C',
        topic: category || 'quantitative',
        difficulty: difficulty || 'medium',
        explanation: 'FULL OUTER JOIN returns all matching and non-matching rows from both tables.',
      },
    ],
    operating_systems: [
      {
        text: 'Which CPU scheduling algorithm gives smallest average waiting time for a given set of processes?',
        options: [
          { id: 'A', text: 'First-Come, First-Served (FCFS)' },
          { id: 'B', text: 'Shortest Job First (SJF)' },
          { id: 'C', text: 'Round Robin (RR)' },
          { id: 'D', text: 'Priority Scheduling' },
        ],
        correct_option_id: 'B',
        topic: category || 'quantitative',
        difficulty: difficulty || 'medium',
        explanation: 'Shortest Job First (SJF) is mathematically optimal for minimizing average process waiting time.',
      },
      {
        text: 'What condition is NOT required for a deadlock to occur in an operating system?',
        options: [
          { id: 'A', text: 'Mutual Exclusion' },
          { id: 'B', text: 'Hold and Wait' },
          { id: 'C', text: 'Preemption' },
          { id: 'D', text: 'Circular Wait' },
        ],
        correct_option_id: 'C',
        topic: category || 'quantitative',
        difficulty: difficulty || 'medium',
        explanation: 'No Preemption is a required Coffman condition; if processes can be preempted, deadlocks are prevented.',
      },
    ],
    math: [
      {
        text: `In ${cleanTopic}, if 3x + 7 = 22, what is the value of x?`,
        options: [
          { id: 'A', text: '4' },
          { id: 'B', text: '5' },
          { id: 'C', text: '6' },
          { id: 'D', text: '7' },
        ],
        correct_option_id: 'B',
        topic: category || 'quantitative',
        difficulty: difficulty || 'easy',
        explanation: 'Subtract 7 from both sides: 3x = 15. Divide by 3: x = 5.',
      },
      {
        text: `In ${cleanTopic}, what is 15% of 400?`,
        options: [
          { id: 'A', text: '50' },
          { id: 'B', text: '60' },
          { id: 'C', text: '70' },
          { id: 'D', text: '80' },
        ],
        correct_option_id: 'B',
        topic: category || 'quantitative',
        difficulty: difficulty || 'easy',
        explanation: '15% of 400 = (15 / 100) * 400 = 15 * 4 = 60.',
      },
      {
        text: `In ${cleanTopic}, what is the average of 12, 18, 24, 30, and 36?`,
        options: [
          { id: 'A', text: '22' },
          { id: 'B', text: '24' },
          { id: 'C', text: '26' },
          { id: 'D', text: '28' },
        ],
        correct_option_id: 'B',
        topic: category || 'quantitative',
        difficulty: difficulty || 'easy',
        explanation: 'Sum = 12 + 18 + 24 + 30 + 36 = 120. Average = 120 / 5 = 24.',
      },
      {
        text: `In ${cleanTopic}, what is the perimeter of a rectangle with length 12cm and width 8cm?`,
        options: [
          { id: 'A', text: '32cm' },
          { id: 'B', text: '40cm' },
          { id: 'C', text: '48cm' },
          { id: 'D', text: '96cm' },
        ],
        correct_option_id: 'B',
        topic: category || 'quantitative',
        difficulty: difficulty || 'easy',
        explanation: 'Perimeter = 2 * (length + width) = 2 * (12 + 8) = 2 * 20 = 40cm.',
      },
      {
        text: `In ${cleanTopic}, what is the value of 5! (5 factorial)?`,
        options: [
          { id: 'A', text: '60' },
          { id: 'B', text: '120' },
          { id: 'C', text: '150' },
          { id: 'D', text: '240' },
        ],
        correct_option_id: 'B',
        topic: category || 'quantitative',
        difficulty: difficulty || 'medium',
        explanation: '5! = 5 * 4 * 3 * 2 * 1 = 120.',
      },
    ],
    calculus: [
      {
        text: `In ${cleanTopic}, what is the first derivative dy/dx of y = 4x^3 - 5x^2 + 7?`,
        options: [
          { id: 'A', text: '12x^2 - 10x' },
          { id: 'B', text: '12x^2 - 5x' },
          { id: 'C', text: '4x^2 - 10x' },
          { id: 'D', text: '12x^3 - 10x' },
        ],
        correct_option_id: 'A',
        topic: category || 'quantitative',
        difficulty: difficulty || 'medium',
        explanation: 'Using power rule: d/dx(4x^3) = 12x^2 and d/dx(-5x^2) = -10x. Derivative = 12x^2 - 10x.',
      },
      {
        text: `In ${cleanTopic}, what is the order of the differential equation (d²y/dx²)³ + (dy/dx)⁴ = 0?`,
        options: [
          { id: 'A', text: 'Order 1' },
          { id: 'B', text: 'Order 2' },
          { id: 'C', text: 'Order 3' },
          { id: 'D', text: 'Order 4' },
        ],
        correct_option_id: 'B',
        topic: category || 'quantitative',
        difficulty: difficulty || 'medium',
        explanation: 'Order is the highest derivative present in the differential equation, which is d²y/dx² (Order 2).',
      },
      {
        text: `In ${cleanTopic}, what is the general solution for the differential equation dy/dx = y?`,
        options: [
          { id: 'A', text: 'y = C * x' },
          { id: 'B', text: 'y = C * e^x' },
          { id: 'C', text: 'y = e^x + C' },
          { id: 'D', text: 'y = C * ln(x)' },
        ],
        correct_option_id: 'B',
        topic: category || 'quantitative',
        difficulty: difficulty || 'medium',
        explanation: 'Separating variables: dy/y = dx => ln|y| = x + C => y = C * e^x.',
      },
      {
        text: `In ${cleanTopic}, what is the indefinite integral ∫ 2x dx?`,
        options: [
          { id: 'A', text: '2x² + C' },
          { id: 'B', text: 'x² + C' },
          { id: 'C', text: 'x + C' },
          { id: 'D', text: 'x³ + C' },
        ],
        correct_option_id: 'B',
        topic: category || 'quantitative',
        difficulty: difficulty || 'easy',
        explanation: '∫ 2x dx = 2 * (x² / 2) + C = x² + C.',
      },
      {
        text: `In ${cleanTopic}, what is the value of d/dx(sin x) at x = 0?`,
        options: [
          { id: 'A', text: '0' },
          { id: 'B', text: '1' },
          { id: 'C', text: '-1' },
          { id: 'D', text: 'Undefined' },
        ],
        correct_option_id: 'B',
        topic: category || 'quantitative',
        difficulty: difficulty || 'easy',
        explanation: 'd/dx(sin x) = cos x. At x = 0, cos(0) = 1.',
      },
    ],
  };

  // Dynamic fallback generator embedding 10 diverse mathematical & analytical problem templates
  const dynamicQuestions = [
    {
      text: `In ${cleanTopic}, if a primary variable increases from 200 to 250, what is the percentage increase?`,
      options: [
        { id: 'A', text: '20%' },
        { id: 'B', text: '25%' },
        { id: 'C', text: '30%' },
        { id: 'D', text: '50%' },
      ],
      correct_option_id: 'B',
      topic: category || 'quantitative',
      difficulty: difficulty || 'medium',
      explanation: 'Percentage increase = ((250 - 200) / 200) * 100 = (50 / 200) * 100 = 25%.',
    },
    {
      text: `When calculating parameters in ${cleanTopic}, if the ratio of A to B is 3:4 and A = 18, what is B?`,
      options: [
        { id: 'A', text: '20' },
        { id: 'B', text: '24' },
        { id: 'C', text: '28' },
        { id: 'D', text: '32' },
      ],
      correct_option_id: 'B',
      topic: category || 'quantitative',
      difficulty: difficulty || 'medium',
      explanation: '3 / 4 = 18 / B => 3B = 72 => B = 24.',
    },
    {
      text: `In an experiment involving ${cleanTopic}, if 4 units generate 60 output cycles, how many cycles will 7 units generate?`,
      options: [
        { id: 'A', text: '95' },
        { id: 'B', text: '105' },
        { id: 'C', text: '115' },
        { id: 'D', text: '120' },
      ],
      correct_option_id: 'B',
      topic: category || 'quantitative',
      difficulty: difficulty || 'medium',
      explanation: 'Output per unit = 60 / 4 = 15. Total for 7 units = 7 * 15 = 105.',
    },
    {
      text: `In ${cleanTopic}, what is the median of the dataset: [4, 7, 12, 15, 22]?`,
      options: [
        { id: 'A', text: '7' },
        { id: 'B', text: '12' },
        { id: 'C', text: '15' },
        { id: 'D', text: '13' },
      ],
      correct_option_id: 'B',
      topic: category || 'quantitative',
      difficulty: difficulty || 'medium',
      explanation: 'The median is the middle value of an ordered set. For 5 elements, the 3rd element is 12.',
    },
    {
      text: `In ${cleanTopic}, if rate of flow is 60 units/hr and time is 2.5 hours, what is the total volume processed?`,
      options: [
        { id: 'A', text: '120 units' },
        { id: 'B', text: '150 units' },
        { id: 'C', text: '180 units' },
        { id: 'D', text: '200 units' },
      ],
      correct_option_id: 'B',
      topic: category || 'quantitative',
      difficulty: difficulty || 'medium',
      explanation: 'Volume = Rate * Time = 60 * 2.5 = 150 units.',
    },
    {
      text: `In ${cleanTopic}, how many unique pairs can be formed from a set of 5 distinct elements?`,
      options: [
        { id: 'A', text: '8' },
        { id: 'B', text: '10' },
        { id: 'C', text: '12' },
        { id: 'D', text: '20' },
      ],
      correct_option_id: 'B',
      topic: category || 'quantitative',
      difficulty: difficulty || 'medium',
      explanation: 'Combinations 5C2 = (5 * 4) / (2 * 1) = 10 unique pairs.',
    },
    {
      text: `In ${cleanTopic}, what is the next term in the geometric sequence: 3, 6, 12, 24, __?`,
      options: [
        { id: 'A', text: '36' },
        { id: 'B', text: '48' },
        { id: 'C', text: '60' },
        { id: 'D', text: '72' },
      ],
      correct_option_id: 'B',
      topic: category || 'quantitative',
      difficulty: difficulty || 'easy',
      explanation: 'The common ratio is 2. The next term is 24 * 2 = 48.',
    },
    {
      text: `In ${cleanTopic}, what is the minimum value of f(x) = (x - 4)² + 9?`,
      options: [
        { id: 'A', text: '4' },
        { id: 'B', text: '9' },
        { id: 'C', text: '13' },
        { id: 'D', text: '0' },
      ],
      correct_option_id: 'B',
      topic: category || 'quantitative',
      difficulty: difficulty || 'medium',
      explanation: 'Since (x - 4)² ≥ 0 for all x, the minimum occurs when x = 4, giving f(4) = 0 + 9 = 9.',
    },
    {
      text: `In ${cleanTopic}, if statement P is True and statement Q is False, what is the truth value of (P AND NOT Q)?`,
      options: [
        { id: 'A', text: 'False' },
        { id: 'B', text: 'True' },
        { id: 'C', text: 'Undefined' },
        { id: 'D', text: 'Null' },
      ],
      correct_option_id: 'B',
      topic: category || 'logical',
      difficulty: difficulty || 'easy',
      explanation: 'Q is False so NOT Q is True. True AND True evaluates to True.',
    },
    {
      text: `In ${cleanTopic}, if the average of 4 measurements is 15, what is their total sum?`,
      options: [
        { id: 'A', text: '45' },
        { id: 'B', text: '60' },
        { id: 'C', text: '75' },
        { id: 'D', text: '90' },
      ],
      correct_option_id: 'B',
      topic: category || 'quantitative',
      difficulty: difficulty || 'easy',
      explanation: 'Total sum = Average * Count = 15 * 4 = 60.',
    },
  ];

  let selectedList = null;
  if (lowerTopic.includes('diff') || lowerTopic.includes('calculus') || lowerTopic.includes('derivat') || lowerTopic.includes('integr') || lowerTopic.includes('equat')) selectedList = topicBanks.calculus;
  else if (lowerTopic.includes('math') || lowerTopic.includes('algebra') || lowerTopic.includes('geom') || lowerTopic.includes('quant') || lowerTopic.includes('calc')) selectedList = topicBanks.math;
  else if (lowerTopic.includes('python') || lowerTopic.includes('django') || lowerTopic.includes('flask')) selectedList = topicBanks.python;
  else if (lowerTopic.includes('sql') || lowerTopic.includes('query') || lowerTopic.includes('database') || lowerTopic.includes('postgres')) selectedList = topicBanks.sql;
  else if (lowerTopic.includes('os') || lowerTopic.includes('operating') || lowerTopic.includes('process') || lowerTopic.includes('linux')) selectedList = topicBanks.operating_systems;
  else if (lowerTopic.includes('probab')) selectedList = topicBanks.probability;
  else if (lowerTopic.includes('syllogism') || lowerTopic.includes('statement')) selectedList = topicBanks.syllogism;
  else if (lowerTopic.includes('time') || lowerTopic.includes('distance') || lowerTopic.includes('speed') || lowerTopic.includes('train')) selectedList = topicBanks.time_distance;
  else if (lowerTopic.includes('profit') || lowerTopic.includes('loss') || lowerTopic.includes('discount') || lowerTopic.includes('interest')) selectedList = topicBanks.profit_loss;
  else if (lowerTopic.includes('prime')) selectedList = topicBanks.primes;
  else if (lowerTopic.includes('code') || lowerTopic.includes('pattern') || lowerTopic.includes('blood') || lowerTopic.includes('relation')) selectedList = topicBanks.coding_logic;
  else if (lowerTopic.includes('verbal') || lowerTopic.includes('english') || lowerTopic.includes('synonym') || lowerTopic.includes('antonym')) selectedList = topicBanks.verbal;
  else if (lowerTopic.includes('data') || lowerTopic.includes('chart') || lowerTopic.includes('graph') || lowerTopic.includes('table')) selectedList = topicBanks.data_interpretation;

  let pool = [];
  if (selectedList && selectedList.length > 0) {
    pool = [...selectedList, ...dynamicQuestions];
  } else {
    pool = [...dynamicQuestions];
  }

  // Shuffle pool using Fisher-Yates
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }

  // Generate dynamic variants for pool
  const variants = pool.map((q) => generateDynamicQuestionVariant(q, cleanTopic));

  return variants.slice(0, Math.min(count, variants.length));
}

/**
 * Mock/Real Gemini LLM Call Adapter with higher temperature (0.95)
 */
export async function callLlmApi(promptSystem, promptUser, fetchImpl = globalThis.fetch) {
  if (!config.LLM_API_KEY || config.LLM_API_KEY.includes('mock')) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout

  try {
    const response = await fetchImpl(
      `https://generativelanguage.googleapis.com/v1beta/models/${config.LLM_MODEL}:generateContent?key=${config.LLM_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: `${promptSystem}\n\n${promptUser}` }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.95,
          },
        }),
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      const errText = await response.text();
      logger.error({ status: response.status, errText }, 'LLM API error response (Using topic fallback)');
      return null;
    }

    const data = await response.json();
    const candidateText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!candidateText) {
      return null;
    }

    return candidateText;
  } catch (err) {
    clearTimeout(timeout);
    return null;
  }
}

/**
 * Generate Questions via LLM with Sub-angle, Nonce, Code-fence stripping, Jaccard near-duplicate filter (>0.6), and Automatic Top-up
 */
export async function generateQuestionsWithAi({ hostId, topic, category, difficulty, count = 5, existingQuestions = [] }, fetchImpl) {
  checkLlmRateLimit(hostId);

  const safeTopic = String(topic || 'General Aptitude').replace(/[<>{}]/g, '').substring(0, 100);
  const targetCount = Math.max(1, Math.min(10, Number(count) || 5));

  const SUB_ANGLES = [
    'practical real-world scenario',
    'reverse calculation and inverse deduction',
    'multi-step analytical reasoning',
    'edge-case and constraint evaluation',
    'comparative analysis',
    'conceptual speed-optimized logic',
    'data-driven decision making',
  ];

  const existingStems = existingQuestions.map((q) => String(q.text || '').trim());
  const allHistoryStems = [...new Set([...existingStems, ...recentStems])];

  let acceptedQuestions = [];

  const filterAndAcceptCandidate = (qCandidate, allowHistoryBypass = false) => {
    if (!qCandidate || !qCandidate.text) return false;
    const textClean = qCandidate.text.trim();

    // 1. Strictly reject if it matches any question ALREADY in the current room set
    const isRoomDuplicate = existingStems.some(
      (existingStem) => calculateJaccardSimilarity(textClean, existingStem) > 0.6
    );
    if (isRoomDuplicate) return false;

    // 2. Check Jaccard similarity > 0.6 against current batch accepted questions
    const batchStems = acceptedQuestions.map((a) => a.text.trim());
    for (const bStem of batchStems) {
      if (calculateJaccardSimilarity(textClean, bStem) > 0.6) return false;
    }

    // 3. Check Jaccard similarity against recent history unless history bypass is enabled for fallbacks
    if (!allowHistoryBypass) {
      for (const hStem of recentStems) {
        if (calculateJaccardSimilarity(textClean, hStem) > 0.6) return false;
      }
    }

    acceptedQuestions.push(qCandidate);
    recordRecentStem(textClean);
    return true;
  };

  let attempts = 0;
  while (acceptedQuestions.length < targetCount && attempts < 3) {
    attempts++;
    const needed = targetCount - acceptedQuestions.length;
    const randomSubAngle = SUB_ANGLES[Math.floor(Math.random() * SUB_ANGLES.length)];
    const nonce = Math.random().toString(36).substring(2, 9);

    const systemInstruction = `You are an expert aptitude quiz question generator.
You MUST generate original, distinct questions specifically focused on the user's requested topic: "${safeTopic}".
Generation Nonce: ${nonce}. Unique Perspective Sub-angle: ${randomSubAngle}.
Return a valid JSON array of ${needed} questions matching the schema.
Do NOT include markdown formatting or backticks around the JSON.
Each object in the array must match this schema:
{
  "text": "Question text directly about ${safeTopic}...",
  "options": [
    {"id": "A", "text": "Option 1"},
    {"id": "B", "text": "Option 2"},
    {"id": "C", "text": "Option 3"},
    {"id": "D", "text": "Option 4"}
  ],
  "correct_option_id": "A",
  "topic": "${category || 'quantitative'}",
  "difficulty": "${difficulty || 'medium'}",
  "explanation": "Short explanation of why answer is correct"
}
Ensure exactly one option matches correct_option_id. Options count must be 2 to 4. Topic must be one of: quantitative, logical, verbal, data_interpretation. Difficulty must be one of: easy, medium, hard.`;

    const userPrompt = `Generate ${needed} original quiz questions specifically and exclusively about the topic: "${safeTopic}".
Sub-angle / Approach: ${randomSubAngle}. Nonce: ${nonce}.
Category context: ${category || 'quantitative'}. Difficulty level: ${difficulty || 'medium'}.
CRITICAL DO NOT REPEAT: Do NOT generate questions similar to these previous stems:
${allHistoryStems.slice(-30).map((s, i) => `${i + 1}. ${s}`).join('\n')}
Every question must have a distinct angle and must NOT copy any stem listed above.`;

    let rawJson = await callLlmApi(systemInstruction, userPrompt, fetchImpl);
    let parsedData = null;

    if (!rawJson) {
      // API call failed (e.g. 429 quota, mock key, or timeout). Break immediately to avoid network delay!
      break;
    }

    const stripped = stripCodeFences(rawJson);
    try {
      parsedData = JSON.parse(stripped);
    } catch (e) {
      logger.warn('First LLM output malformed JSON. Retrying once after stripping code fences...');
      rawJson = await callLlmApi(systemInstruction, userPrompt, fetchImpl);
      if (rawJson) {
        try {
          parsedData = JSON.parse(stripCodeFences(rawJson));
        } catch (err2) {
          parsedData = null;
        }
      }
    }

    if (parsedData) {
      const validationResult = aiGeneratedListSchema.safeParse(parsedData);
      if (validationResult.success) {
        for (const qItem of validationResult.data) {
          if (acceptedQuestions.length < targetCount) {
            filterAndAcceptCandidate(qItem, false);
          }
        }
      }
    }
  }

  // Top up automatically with fallback questions if LLM returned fewer than targetCount unique questions
  if (acceptedQuestions.length < targetCount) {
    const fallbackList = getFallbackQuestions(safeTopic, category, difficulty, targetCount * 4);
    for (const fq of fallbackList) {
      if (acceptedQuestions.length >= targetCount) break;
      const accepted = filterAndAcceptCandidate(fq, false);
      if (!accepted) {
        // Try again allowing recentStems history bypass (still respecting current room duplicates)
        filterAndAcceptCandidate(fq, true);
      }
    }
  }

  const finalQuestions = acceptedQuestions.slice(0, targetCount);

  if (finalQuestions.length > 0) {
    recordLlmSuccess(hostId);
  }

  return finalQuestions;
}
