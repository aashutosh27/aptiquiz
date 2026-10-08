import { describe, it, expect } from 'vitest';
import { generateQuestionsWithAi, checkLlmRateLimit, recordLlmSuccess } from '../src/services/llmService.js';

describe('LLM Question Generation & Zod Validation', () => {
  it('parses and validates valid LLM question output', async () => {
    const questions = await generateQuestionsWithAi({
      hostId: 1,
      topic: 'Probability',
      category: 'quantitative',
      difficulty: 'medium',
      count: 1,
    });

    expect(questions.length).toBe(1);
    expect(questions[0].difficulty).toBe('medium');
    expect(questions[0].options.length).toBe(4);
  });

  it('filters out duplicates against existing question list', async () => {
    const existing = [
      { text: 'What is the sum of the prime numbers between 1 and 10?' },
      { text: 'How many prime numbers exist between 10 and 20?' },
      { text: 'In Primes, if a primary variable increases from 200 to 250, what is the percentage increase?' },
      { text: 'When calculating parameters in Primes, if the ratio of A to B is 3:4 and A = 18, what is B?' },
      { text: 'In an experiment involving Primes, if 4 units generate 60 output cycles, how many cycles will 7 units generate?' },
      { text: 'In Primes, what is the median of the dataset: [4, 7, 12, 15, 22]?' },
      { text: 'In Primes, if rate of flow is 60 units/hr and time is 2.5 hours, what is the total volume processed?' },
      { text: 'In Primes, how many unique pairs can be formed from a set of 5 distinct elements?' },
      { text: 'In Primes, what is the next term in the geometric sequence: 3, 6, 12, 24, __?' },
      { text: 'In Primes, what is the minimum value of f(x) = (x - 4)² + 9?' },
      { text: 'In Primes, if statement P is True and statement Q is False, what is the truth value of (P AND NOT Q)?' },
      { text: 'In Primes, if the average of 4 measurements is 15, what is their total sum?' },
    ];

    const questions = await generateQuestionsWithAi({
      hostId: 2,
      topic: 'Primes',
      category: 'quantitative',
      difficulty: 'medium',
      count: 1,
      existingQuestions: existing,
    });

    expect(questions.length).toBe(0); // All duplicate questions filtered out
  });

  it('enforces 5 successful requests per 10 minutes rate limit per host', () => {
    const hostId = 999;
    for (let i = 0; i < 5; i++) {
      recordLlmSuccess(hostId);
    }

    expect(() => {
      checkLlmRateLimit(hostId);
    }).toThrowError('Limit of 5 AI generation requests per 10 minutes reached.');
  });
});
