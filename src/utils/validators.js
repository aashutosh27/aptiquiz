import { z } from 'zod';

// Option schema
export const optionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1, 'Option text cannot be empty').max(200, 'Option text too long'),
});

// Single Question Schema
export const questionSchema = z.object({
  text: z.string().min(5, 'Enter a question text of at least 5 characters.').max(1000, 'Question text is too long.'),
  options: z.array(optionSchema).min(2, 'At least 2 options are required.').max(4, 'At most 4 options are allowed.'),
  correct_option_id: z.string().min(1, 'Select a correct option.'),
  topic: z.enum(['quantitative', 'logical', 'verbal', 'data_interpretation'], {
    errorMap: () => ({ message: 'Topic must be quantitative, logical, verbal, or data_interpretation.' }),
  }),
  difficulty: z.enum(['easy', 'medium', 'hard'], {
    errorMap: () => ({ message: 'Difficulty must be easy, medium, or hard.' }),
  }),
  explanation: z.string().optional(),
  source: z.enum(['manual', 'ai']).default('manual'),
  image_url: z.string().url().optional().or(z.literal('')),
  table_data: z
    .object({
      headers: z.array(z.string()),
      rows: z.array(z.array(z.string())),
    })
    .optional(),
});

// Question Set Schema
export const questionSetSchema = z.object({
  title: z.string().min(3, 'Enter a title of 3 to 100 characters.').max(100),
  description: z.string().max(500).optional(),
  questions: z.array(questionSchema).optional(),
});

// AI Question Generation Request Payload
export const aiGenerateRequestSchema = z.object({
  topic: z.string().min(2, 'Enter a topic of at least 2 characters.').max(100, 'Topic must be 100 characters or less.'),
  category: z.enum(['quantitative', 'logical', 'verbal', 'data_interpretation']),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  count: z.coerce.number().int().min(1, 'Request between 1 and 10 questions.').max(10, 'Request between 1 and 10 questions.'),
  avoid_repeating: z.boolean().default(true),
});

// AI Output Validation Schema (Single LLM generated question)
export const aiGeneratedQuestionSchema = z.object({
  text: z.string().min(5),
  options: z.array(optionSchema).min(2).max(4),
  correct_option_id: z.string().min(1),
  topic: z.string().min(1).default('quantitative'),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  explanation: z.string().min(5),
});

export const aiGeneratedListSchema = z.array(aiGeneratedQuestionSchema);

// Socket Event Payload Schemas
export const joinRoomPayloadSchema = z.object({
  pin: z.string().length(6, 'PIN must be exactly 6 digits.').optional(),
  inviteToken: z.string().optional(),
  guestName: z.string().min(2, 'Enter a name of 2 to 30 characters.').max(30, 'Enter a name of 2 to 30 characters.').optional(),
});

export const submitAnswerPayloadSchema = z.object({
  questionId: z.coerce.number().int().positive(),
  selectedOption: z.string().min(1),
  clientSendTime: z.number().positive(),
});

export const warnPlayerPayloadSchema = z.object({
  targetUserId: z.number().int().positive(),
  reason: z.string().min(1, 'Reason is required.').max(200),
  customReasonText: z.string().max(100).optional(),
});

export const proctorAuthPayloadSchema = z.object({
  proctorCode: z.string().min(4).max(10),
});
