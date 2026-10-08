import { describe, it, expect } from 'vitest';
import { generateQuestionsWithAi } from '../src/services/llmService.js';

describe('Topic-Specific Question Generation', () => {
  it('generates distinct questions for Probability topic', async () => {
    const questions = await generateQuestionsWithAi({
      hostId: 101,
      topic: 'Probability',
      category: 'quantitative',
      difficulty: 'medium',
      count: 2,
    });

    expect(questions.length).toBe(2);
    expect(questions[0].text.toLowerCase()).toContain('probability');
  });

  it('generates distinct questions for Time & Distance topic', async () => {
    const questions = await generateQuestionsWithAi({
      hostId: 102,
      topic: 'Time and Distance',
      category: 'quantitative',
      difficulty: 'medium',
      count: 2,
    });

    expect(questions.length).toBe(2);
    const hasTimeOrTrain = questions.some(
      (q) => q.text.toLowerCase().includes('train') || q.text.toLowerCase().includes('time') || q.text.toLowerCase().includes('speed')
    );
    expect(hasTimeOrTrain).toBe(true);
  });

  it('generates dynamic custom-topic questions for arbitrary topics like Python', async () => {
    const questions = await generateQuestionsWithAi({
      hostId: 103,
      topic: 'Python Programming',
      category: 'quantitative',
      difficulty: 'medium',
      count: 3,
    });

    expect(questions.length).toBe(3);
    expect(questions[0].text).toContain('Python Programming');
    expect(questions[1].text).toContain('Python Programming');
  });
});
