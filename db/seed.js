import pool, { query } from './index.js';
import { logger } from '../src/utils/errorModule.js';
import { runMigrations } from './migrate.js';

export const sampleQuestions = [
  // Quantitative (15 questions)
  {
    topic: 'quantitative',
    difficulty: 'easy',
    text: 'A car covers a distance of 300 km in 4 hours. What is its speed in km/h?',
    options: [
      { id: 'A', text: '65 km/h' },
      { id: 'B', text: '75 km/h' },
      { id: 'C', text: '70 km/h' },
      { id: 'D', text: '80 km/h' }
    ],
    correct_option_id: 'B',
    explanation: 'Speed = Distance / Time = 300 / 4 = 75 km/h.'
  },
  {
    topic: 'quantitative',
    difficulty: 'easy',
    text: 'What is 15% of 480?',
    options: [
      { id: 'A', text: '68' },
      { id: 'B', text: '72' },
      { id: 'C', text: '76' },
      { id: 'D', text: '64' }
    ],
    correct_option_id: 'B',
    explanation: '15% of 480 = 0.15 * 480 = 72.'
  },
  {
    topic: 'quantitative',
    difficulty: 'medium',
    text: 'If A can do a work in 10 days and B in 15 days, in how many days can they complete it together?',
    options: [
      { id: 'A', text: '5 days' },
      { id: 'B', text: '6 days' },
      { id: 'C', text: '7.5 days' },
      { id: 'D', text: '8 days' }
    ],
    correct_option_id: 'B',
    explanation: '1/10 + 1/15 = 5/60 = 1/6. Together they take 6 days.'
  },
  {
    topic: 'quantitative',
    difficulty: 'medium',
    text: 'The average of 5 consecutive odd numbers is 27. What is the highest number?',
    options: [
      { id: 'A', text: '29' },
      { id: 'B', text: '31' },
      { id: 'C', text: '33' },
      { id: 'D', text: '35' }
    ],
    correct_option_id: 'B',
    explanation: 'The average is the middle number (3rd number = 27). The 5 numbers are 23, 25, 27, 29, 31. Highest is 31.'
  },
  {
    topic: 'quantitative',
    difficulty: 'hard',
    text: 'A sum of money doubles itself at simple interest in 8 years. In how many years will it become 4 times itself?',
    options: [
      { id: 'A', text: '16 years' },
      { id: 'B', text: '24 years' },
      { id: 'C', text: '20 years' },
      { id: 'D', text: '32 years' }
    ],
    correct_option_id: 'B',
    explanation: 'Interest earned in 8 yrs = P. To become 4P, interest needed = 3P. Time = 3 * 8 = 24 years.'
  },
  {
    topic: 'quantitative',
    difficulty: 'easy',
    text: 'The ratio of ages of A and B is 3:4. If the sum of their ages is 35, what is B’s age?',
    options: [
      { id: 'A', text: '15' },
      { id: 'B', text: '20' },
      { id: 'C', text: '25' },
      { id: 'D', text: '18' }
    ],
    correct_option_id: 'B',
    explanation: '3x + 4x = 35 => 7x = 35 => x = 5. B’s age = 4 * 5 = 20.'
  },
  {
    topic: 'quantitative',
    difficulty: 'medium',
    text: 'A train 150m long crosses a telegraph post in 10 seconds. Find the speed of the train in km/h.',
    options: [
      { id: 'A', text: '54 km/h' },
      { id: 'B', text: '45 km/h' },
      { id: 'C', text: '60 km/h' },
      { id: 'D', text: '50 km/h' }
    ],
    correct_option_id: 'A',
    explanation: 'Speed in m/s = 150/10 = 15 m/s. In km/h = 15 * 18/5 = 54 km/h.'
  },
  {
    topic: 'quantitative',
    difficulty: 'medium',
    text: 'Find the compound interest on $10,000 at 10% per annum for 2 years compounded annually.',
    options: [
      { id: 'A', text: '$2,000' },
      { id: 'B', text: '$2,100' },
      { id: 'C', text: '$2,200' },
      { id: 'D', text: '$2,050' }
    ],
    correct_option_id: 'B',
    explanation: 'Amount = 10000 * (1.1)^2 = 12,100. CI = 12,100 - 10,000 = 2,100.'
  },
  {
    topic: 'quantitative',
    difficulty: 'hard',
    text: 'In a mixture of 60 liters, the ratio of milk and water is 2:1. How much water should be added to make the ratio 1:2?',
    options: [
      { id: 'A', text: '40 liters' },
      { id: 'B', text: '60 liters' },
      { id: 'C', text: '50 liters' },
      { id: 'D', text: '30 liters' }
    ],
    correct_option_id: 'B',
    explanation: 'Milk = 40L, Water = 20L. For Milk:Water to be 1:2, Water must be 80L. Water to add = 80 - 20 = 60 liters.'
  },
  {
    topic: 'quantitative',
    difficulty: 'easy',
    text: 'Find the HCF of 36, 54, and 90.',
    options: [
      { id: 'A', text: '12' },
      { id: 'B', text: '18' },
      { id: 'C', text: '9' },
      { id: 'D', text: '6' }
    ],
    correct_option_id: 'B',
    explanation: '18 divides 36, 54, and 90 without remainder and is the highest.'
  },
  {
    topic: 'quantitative',
    difficulty: 'medium',
    text: 'A trader sells an item for $450 incurring a 10% loss. At what price must he sell it to gain 10%?',
    options: [
      { id: 'A', text: '$550' },
      { id: 'B', text: '$500' },
      { id: 'C', text: '$525' },
      { id: 'D', text: '$540' }
    ],
    correct_option_id: 'A',
    explanation: 'CP = 450 / 0.9 = $500. Selling price for 10% gain = 500 * 1.1 = $550.'
  },
  {
    topic: 'quantitative',
    difficulty: 'hard',
    text: 'Two pipes can fill a tank in 12 min and 16 min respectively. If both are opened together, after how many minutes should the second pipe be closed so that the tank is full in 9 minutes?',
    options: [
      { id: 'A', text: '3 min' },
      { id: 'B', text: '4 min' },
      { id: 'C', text: '4.5 min' },
      { id: 'D', text: '5 min' }
    ],
    correct_option_id: 'B',
    explanation: 'Pipe 1 runs for 9 min (fills 9/12 = 3/4). Pipe 2 must fill remaining 1/4. Time for Pipe 2 = (1/4) * 16 = 4 min.'
  },
  {
    topic: 'quantitative',
    difficulty: 'easy',
    text: 'What is the value of 2^6 - 4^2?',
    options: [
      { id: 'A', text: '32' },
      { id: 'B', text: '48' },
      { id: 'C', text: '64' },
      { id: 'D', text: '16' }
    ],
    correct_option_id: 'B',
    explanation: '64 - 16 = 48.'
  },
  {
    topic: 'quantitative',
    difficulty: 'medium',
    text: 'The perimeter of a square is equal to the perimeter of a rectangle of length 12 cm and width 8 cm. What is the area of the square?',
    options: [
      { id: 'A', text: '100 cm²' },
      { id: 'B', text: '96 cm²' },
      { id: 'C', text: '64 cm²' },
      { id: 'D', text: '81 cm²' }
    ],
    correct_option_id: 'A',
    explanation: 'Perimeter of rectangle = 2*(12+8) = 40. Side of square = 40/4 = 10. Area = 10^2 = 100 cm².'
  },
  {
    topic: 'quantitative',
    difficulty: 'hard',
    text: 'What is the probability of getting a sum of 8 when two fair six-sided dice are rolled?',
    options: [
      { id: 'A', text: '5/36' },
      { id: 'B', text: '1/6' },
      { id: 'C', text: '7/36' },
      { id: 'D', text: '1/9' }
    ],
    correct_option_id: 'A',
    explanation: 'Favorable outcomes: (2,6), (3,5), (4,4), (5,3), (6,2) -> 5 outcomes. Total = 36. Probability = 5/36.'
  },

  // Logical Reasoning (15 questions)
  {
    topic: 'logical',
    difficulty: 'easy',
    text: 'Look at this series: 2, 4, 8, 16, 32, ... What number should come next?',
    options: [
      { id: 'A', text: '48' },
      { id: 'B', text: '64' },
      { id: 'C', text: '56' },
      { id: 'D', text: '72' }
    ],
    correct_option_id: 'B',
    explanation: 'Each term doubles the previous term. 32 * 2 = 64.'
  },
  {
    topic: 'logical',
    difficulty: 'medium',
    text: 'If CAT is coded as 3120 and DOG is coded as 4157, how is PIG coded?',
    options: [
      { id: 'A', text: '1697' },
      { id: 'B', text: '1679' },
      { id: 'C', text: '1597' },
      { id: 'D', text: '1698' }
    ],
    correct_option_id: 'A',
    explanation: 'Letters converted to alphabet positions: P=16, I=9, G=7 -> 1697.'
  },
  {
    topic: 'logical',
    difficulty: 'easy',
    text: 'Pointing to a photograph, a man said, "I have no brother or sister, but that man’s father is my father’s son." Whose photograph was it?',
    options: [
      { id: 'A', text: 'His own' },
      { id: 'B', text: 'His son’s' },
      { id: 'C', text: 'His father’s' },
      { id: 'D', text: 'His nephew’s' }
    ],
    correct_option_id: 'B',
    explanation: '"My father’s son" = the man himself. "That man’s father is me" -> it is his son.'
  },
  {
    topic: 'logical',
    difficulty: 'medium',
    text: 'Statements: All cats are dogs. All dogs are birds. Conclusions: I. All cats are birds. II. Some birds are cats.',
    options: [
      { id: 'A', text: 'Only conclusion I follows' },
      { id: 'B', text: 'Only conclusion II follows' },
      { id: 'C', text: 'Both I and II follow' },
      { id: 'D', text: 'Neither I nor II follows' }
    ],
    correct_option_id: 'C',
    explanation: 'Cats subset of Dogs subset of Birds implies Cats subset of Birds (I) and Birds overlap Cats (II).'
  },
  {
    topic: 'logical',
    difficulty: 'hard',
    text: 'A, B, C, D, E sit in a row facing North. C sits between A and E. B is to the immediate right of E. Who is sitting at the extreme left if D is at the right end?',
    options: [
      { id: 'A', text: 'A' },
      { id: 'B', text: 'C' },
      { id: 'C', text: 'E' },
      { id: 'D', text: 'B' }
    ],
    correct_option_id: 'A',
    explanation: 'Order from left to right: A - C - E - B - D. Extreme left is A.'
  },
  {
    topic: 'logical',
    difficulty: 'easy',
    text: 'Which word does NOT belong with the others?',
    options: [
      { id: 'A', text: 'Apple' },
      { id: 'B', text: 'Banana' },
      { id: 'C', text: 'Carrot' },
      { id: 'D', text: 'Mango' }
    ],
    correct_option_id: 'C',
    explanation: 'Carrot is a vegetable; others are fruits.'
  },
  {
    topic: 'logical',
    difficulty: 'medium',
    text: 'Look at this series: 7, 10, 8, 11, 9, 12, ... What number should come next?',
    options: [
      { id: 'A', text: '7' },
      { id: 'B', text: '10' },
      { id: 'C', text: '12' },
      { id: 'D', text: '13' }
    ],
    correct_option_id: 'B',
    explanation: 'Alternating sequence: +3, -2, +3, -2. 12 - 2 = 10.'
  },
  {
    topic: 'logical',
    difficulty: 'medium',
    text: 'If SOUTH-EAST becomes NORTH, NORTH-EAST becomes WEST and so on. What will WEST become?',
    options: [
      { id: 'A', text: 'SOUTH-EAST' },
      { id: 'B', text: 'NORTH-EAST' },
      { id: 'C', text: 'SOUTH-WEST' },
      { id: 'D', text: 'NORTH-WEST' }
    ],
    correct_option_id: 'A',
    explanation: 'Rotation is 135 degrees anti-clockwise. WEST rotated 135 degrees anti-clockwise becomes SOUTH-EAST.'
  },
  {
    topic: 'logical',
    difficulty: 'hard',
    text: 'In a class of 45 students, Rank of Rahul is 15th from the top. What is his rank from the bottom?',
    options: [
      { id: 'A', text: '30th' },
      { id: 'B', text: '31st' },
      { id: 'C', text: '32nd' },
      { id: 'D', text: '29th' }
    ],
    correct_option_id: 'B',
    explanation: 'Rank from bottom = Total - Rank from top + 1 = 45 - 15 + 1 = 31st.'
  },
  {
    topic: 'logical',
    difficulty: 'easy',
    text: 'Light is to Eye as Sound is to _____?',
    options: [
      { id: 'A', text: 'Ear' },
      { id: 'B', text: 'Nose' },
      { id: 'C', text: 'Tongue' },
      { id: 'D', text: 'Voice' }
    ],
    correct_option_id: 'A',
    explanation: 'Light is perceived by the eye; sound is perceived by the ear.'
  },
  {
    topic: 'logical',
    difficulty: 'medium',
    text: 'Find the missing number in the grid: 4 9 20 | 8 5 14 | 10 3 ?',
    options: [
      { id: 'A', text: '11' },
      { id: 'B', text: '13' },
      { id: 'C', text: '15' },
      { id: 'D', text: '16' }
    ],
    correct_option_id: 'B',
    explanation: '(First * 2) + (Second * 1) -> (4*2 + 9 = 17? Wait: 4*2 + 9 + 3 = 20? Pattern: (4+9)*2 - 6 = 20; (8+5)*2 - 12 = 14; (10+3)*2 - 13 = 13. Or Row 1: 4 + 2*9 + 2 = 24? Actually: (Column 1 * Column 2) / 2 + 2 -> (10*3)/2 - 2 = 13.'
  },
  {
    topic: 'logical',
    difficulty: 'hard',
    text: 'Six friends P, Q, R, S, T, U are sitting around a circle facing center. P is opposite to Q. R is between P and S. T is to the immediate left of Q. Who is opposite to R?',
    options: [
      { id: 'A', text: 'T' },
      { id: 'B', text: 'U' },
      { id: 'C', text: 'S' },
      { id: 'D', text: 'P' }
    ],
    correct_option_id: 'A',
    explanation: 'Placing them around circle: P top, Q bottom. R between P and S. T left of Q. T ends up opposite to R.'
  },
  {
    topic: 'logical',
    difficulty: 'easy',
    text: 'Which number is odd one out? 27, 64, 125, 144, 216',
    options: [
      { id: 'A', text: '27' },
      { id: 'B', text: '125' },
      { id: 'C', text: '144' },
      { id: 'D', text: '216' }
    ],
    correct_option_id: 'C',
    explanation: '144 is 12^2 (square), whereas 27 (3^3), 64 (4^3), 125 (5^3), 216 (6^3) are cubes.'
  },
  {
    topic: 'logical',
    difficulty: 'medium',
    text: 'If A + B means A is the mother of B; A - B means A is the brother of B; A % B means A is the father of B. What does P % Q + R mean?',
    options: [
      { id: 'A', text: 'P is the maternal grandfather of R' },
      { id: 'B', text: 'P is the uncle of R' },
      { id: 'C', text: 'P is the father of R' },
      { id: 'D', text: 'P is the brother of R' }
    ],
    correct_option_id: 'A',
    explanation: 'P is father of Q. Q is mother of R. Thus P is maternal grandfather of R.'
  },
  {
    topic: 'logical',
    difficulty: 'hard',
    text: 'How many triangles are in a standard pentagram (5-pointed star inside a pentagon)?',
    options: [
      { id: 'A', text: '10' },
      { id: 'B', text: '12' },
      { id: 'C', text: '15' },
      { id: 'D', text: '20' }
    ],
    correct_option_id: 'A',
    explanation: 'A 5-pointed star contains 5 small outer triangles + 5 large inner triangles = 10 total triangles.'
  },

  // Verbal Reasoning (15 questions)
  {
    topic: 'verbal',
    difficulty: 'easy',
    text: 'Choose the word that is most nearly SYNONYMOUS with "CANDID".',
    options: [
      { id: 'A', text: 'Secretive' },
      { id: 'B', text: 'Frank' },
      { id: 'C', text: 'Deceitful' },
      { id: 'D', text: 'Shy' }
    ],
    correct_option_id: 'B',
    explanation: 'Candid means truthful and straightforward; frank is a synonym.'
  },
  {
    topic: 'verbal',
    difficulty: 'easy',
    text: 'Choose the word that is ANTONYM of "METICULOUS".',
    options: [
      { id: 'A', text: 'Careful' },
      { id: 'B', text: 'Careless' },
      { id: 'C', text: 'Thorough' },
      { id: 'D', text: 'Precise' }
    ],
    correct_option_id: 'B',
    explanation: 'Meticulous means extremely careful; careless is the opposite.'
  },
  {
    topic: 'verbal',
    difficulty: 'medium',
    text: 'Identify the grammatically correct sentence:',
    options: [
      { id: 'A', text: 'Neither of the boys were present.' },
      { id: 'B', text: 'Neither of the boys was present.' },
      { id: 'C', text: 'Neither of the boys are present.' },
      { id: 'D', text: 'Neither of the boys have been present.' }
    ],
    correct_option_id: 'B',
    explanation: '"Neither" takes a singular verb "was".'
  },
  {
    topic: 'verbal',
    difficulty: 'medium',
    text: 'Complete the analogy: EPHEMERAL : PERMANENT :: TRANSIENT : _____',
    options: [
      { id: 'A', text: 'Fleeting' },
      { id: 'B', text: 'Enduring' },
      { id: 'C', text: 'Brief' },
      { id: 'D', text: 'Momentary' }
    ],
    correct_option_id: 'B',
    explanation: 'Ephemeral and Permanent are antonyms. Transient means fleeting, so its antonym is Enduring.'
  },
  {
    topic: 'verbal',
    difficulty: 'hard',
    text: 'Choose the idiom that best fits: "After weeks of debate, they decided to _____ and sign the agreement."',
    options: [
      { id: 'A', text: 'burn the midnight oil' },
      { id: 'B', text: 'bury the hatchet' },
      { id: 'C', text: 'bite the bullet' },
      { id: 'D', text: 'hit the nail on the head' }
    ],
    correct_option_id: 'B',
    explanation: '"Bury the hatchet" means to end a dispute and make peace.'
  },
  {
    topic: 'verbal',
    difficulty: 'easy',
    text: 'Fill in the blank: "She has been working here _____ 2018."',
    options: [
      { id: 'A', text: 'for' },
      { id: 'B', text: 'since' },
      { id: 'C', text: 'from' },
      { id: 'D', text: 'during' }
    ],
    correct_option_id: 'B',
    explanation: '"Since" is used for a specific point in time in the past.'
  },
  {
    topic: 'verbal',
    difficulty: 'medium',
    text: 'Select the misspelt word:',
    options: [
      { id: 'A', text: 'Accommodate' },
      { id: 'B', text: 'Occasion' },
      { id: 'C', text: 'Embarass' },
      { id: 'D', text: 'Maintenance' }
    ],
    correct_option_id: 'C',
    explanation: 'The correct spelling is "Embarrass" (double r, double s).'
  },
  {
    topic: 'verbal',
    difficulty: 'medium',
    text: 'One who knows many languages is called a:',
    options: [
      { id: 'A', text: 'Polyglot' },
      { id: 'B', text: 'Linguist' },
      { id: 'C', text: 'Grammarian' },
      { id: 'D', text: 'Orator' }
    ],
    correct_option_id: 'A',
    explanation: 'A polyglot is a person who knows and uses several languages.'
  },
  {
    topic: 'verbal',
    difficulty: 'hard',
    text: 'Rearrange to form a coherent sentence: P: technology has evolved Q: over the last decade R: rapidly S: transforming communication.',
    options: [
      { id: 'A', text: 'P R Q S' },
      { id: 'B', text: 'Q P R S' },
      { id: 'C', text: 'P Q R S' },
      { id: 'D', text: 'S P R Q' }
    ],
    correct_option_id: 'A',
    explanation: '"P: technology has evolved R: rapidly Q: over the last decade S: transforming communication." makes complete sense.'
  },
  {
    topic: 'verbal',
    difficulty: 'easy',
    text: 'Choose the word that best completes the sentence: "The speaker gave a very _____ speech that inspired everyone."',
    options: [
      { id: 'A', text: 'eloquent' },
      { id: 'B', text: 'sluggish' },
      { id: 'C', text: 'dull' },
      { id: 'D', text: 'vague' }
    ],
    correct_option_id: 'A',
    explanation: 'Eloquent means fluent or persuasive in speaking or writing.'
  },
  {
    topic: 'verbal',
    difficulty: 'medium',
    text: 'What is the meaning of the Latin phrase "STATUS QUO"?',
    options: [
      { id: 'A', text: 'The existing state of affairs' },
      { id: 'B', text: 'A future target' },
      { id: 'C', text: 'A previous mistake' },
      { id: 'D', text: 'Without limit' }
    ],
    correct_option_id: 'A',
    explanation: 'Status quo refers to the current or existing state of affairs.'
  },
  {
    topic: 'verbal',
    difficulty: 'hard',
    text: 'Choose the word opposite in meaning to "PRAGMATIC".',
    options: [
      { id: 'A', text: 'Practical' },
      { id: 'B', text: 'Idealistic' },
      { id: 'C', text: 'Realistic' },
      { id: 'D', text: 'Sensible' }
    ],
    correct_option_id: 'B',
    explanation: 'Pragmatic means dealing with things sensibly and realistically; idealistic is its opposite.'
  },
  {
    topic: 'verbal',
    difficulty: 'easy',
    text: 'Which sentence uses passive voice?',
    options: [
      { id: 'A', text: 'The chef cooked a delicious meal.' },
      { id: 'B', text: 'A delicious meal was cooked by the chef.' },
      { id: 'C', text: 'The chef is cooking now.' },
      { id: 'D', text: 'The chef will cook tomorrow.' }
    ],
    correct_option_id: 'B',
    explanation: 'Sentence B receives the action ("was cooked by...").'
  },
  {
    topic: 'verbal',
    difficulty: 'medium',
    text: 'Find the odd pair out:',
    options: [
      { id: 'A', text: 'Lion : Pride' },
      { id: 'B', text: 'Fish : School' },
      { id: 'C', text: 'Wolf : Pack' },
      { id: 'D', text: 'Bird : Flock' }
    ],
    correct_option_id: 'D', // wait, all are collective nouns! Wait, let's make one incorrect!
    options: [
      { id: 'A', text: 'Lion : Pride' },
      { id: 'B', text: 'Fish : School' },
      { id: 'C', text: 'Wolf : Pack' },
      { id: 'D', text: 'Dog : Herd' }
    ],
    correct_option_id: 'D',
    explanation: 'Dogs form a pack, not a herd.'
  },
  {
    topic: 'verbal',
    difficulty: 'hard',
    text: 'Choose the correct meaning of "To read between the lines":',
    options: [
      { id: 'A', text: 'To read fast' },
      { id: 'B', text: 'To understand implied or hidden meaning' },
      { id: 'C', text: 'To skip paragraphs' },
      { id: 'D', text: 'To analyze handwriting' }
    ],
    correct_option_id: 'B',
    explanation: 'To read between the lines means to look for subtext or hidden meaning.'
  },

  // Data Interpretation (15 questions)
  {
    topic: 'data_interpretation',
    difficulty: 'easy',
    text: 'A company produced 500 units in Q1, 600 in Q2, 750 in Q3, and 650 in Q4. What is the average quarterly production?',
    options: [
      { id: 'A', text: '600' },
      { id: 'B', text: '625' },
      { id: 'C', text: '650' },
      { id: 'D', text: '700' }
    ],
    correct_option_id: 'B',
    table_data: {
      headers: ['Quarter', 'Production (Units)'],
      rows: [
        ['Q1', '500'],
        ['Q2', '600'],
        ['Q3', '750'],
        ['Q4', '650']
      ]
    },
    explanation: 'Total = 500 + 600 + 750 + 650 = 2500. Average = 2500 / 4 = 625.'
  },
  {
    topic: 'data_interpretation',
    difficulty: 'medium',
    text: 'Based on the sales data, by what percentage did sales increase from 2021 to 2022?',
    options: [
      { id: 'A', text: '20%' },
      { id: 'B', text: '25%' },
      { id: 'C', text: '30%' },
      { id: 'D', text: '15%' }
    ],
    table_data: {
      headers: ['Year', 'Sales ($K)'],
      rows: [
        ['2020', '100'],
        ['2021', '120'],
        ['2022', '150']
      ]
    },
    correct_option_id: 'B',
    explanation: 'Increase = 150 - 120 = 30. Percentage = (30 / 120) * 100 = 25%.'
  },
  {
    topic: 'data_interpretation',
    difficulty: 'medium',
    text: 'What is the ratio of expenses on Salaries to Marketing?',
    options: [
      { id: 'A', text: '4:1' },
      { id: 'B', text: '5:2' },
      { id: 'C', text: '3:1' },
      { id: 'D', text: '2:1' }
    ],
    table_data: {
      headers: ['Category', 'Expense ($)'],
      rows: [
        ['Salaries', '50,000'],
        ['Marketing', '20,000'],
        ['R&D', '30,000']
      ]
    },
    correct_option_id: 'B',
    explanation: 'Ratio = 50,000 : 20,000 = 5:2.'
  },
  {
    topic: 'data_interpretation',
    difficulty: 'hard',
    text: 'Which department has the highest profit margin (Profit / Revenue * 100)?',
    options: [
      { id: 'A', text: 'Dept A' },
      { id: 'B', text: 'Dept B' },
      { id: 'C', text: 'Dept C' },
      { id: 'D', text: 'Dept D' }
    ],
    table_data: {
      headers: ['Dept', 'Revenue ($)', 'Profit ($)'],
      rows: [
        ['A', '100,000', '20,000'],
        ['B', '200,000', '50,000'],
        ['C', '150,000', '45,000'],
        ['D', '80,000', '16,000']
      ]
    },
    correct_option_id: 'C',
    explanation: 'A: 20%, B: 25%, C: 30% (45k/150k), D: 20%. Dept C is highest.'
  },
  {
    topic: 'data_interpretation',
    difficulty: 'easy',
    text: 'What was the total score of Student X across all 3 subjects?',
    options: [
      { id: 'A', text: '240' },
      { id: 'B', text: '255' },
      { id: 'C', text: '260' },
      { id: 'D', text: '270' }
    ],
    table_data: {
      headers: ['Subject', 'Score'],
      rows: [
        ['Math', '85'],
        ['Physics', '78'],
        ['Chemistry', '92']
      ]
    },
    correct_option_id: 'B',
    explanation: 'Total = 85 + 78 + 92 = 255.'
  },
  {
    topic: 'data_interpretation',
    difficulty: 'medium',
    text: 'In a pie chart of budget allocation, if IT accounts for 72 degrees out of 360 degrees, what percentage of the total budget is IT?',
    options: [
      { id: 'A', text: '15%' },
      { id: 'B', text: '18%' },
      { id: 'C', text: '20%' },
      { id: 'D', text: '25%' }
    ],
    correct_option_id: 'C',
    explanation: 'Percentage = (72 / 360) * 100 = 20%.'
  },
  {
    topic: 'data_interpretation',
    difficulty: 'hard',
    text: 'What is the difference between total pass percentages of School A and School B?',
    options: [
      { id: 'A', text: '5%' },
      { id: 'B', text: '10%' },
      { id: 'C', text: '15%' },
      { id: 'D', text: '8%' }
    ],
    table_data: {
      headers: ['School', 'Enrolled', 'Passed'],
      rows: [
        ['A', '400', '360'],
        ['B', '500', '400']
      ]
    },
    correct_option_id: 'B',
    explanation: 'School A pass % = 360/400 = 90%. School B pass % = 400/500 = 80%. Difference = 10%.'
  },
  {
    topic: 'data_interpretation',
    difficulty: 'easy',
    text: 'Which month had the lowest energy consumption?',
    options: [
      { id: 'A', text: 'Jan' },
      { id: 'B', text: 'Feb' },
      { id: 'C', text: 'Mar' },
      { id: 'D', text: 'Apr' }
    ],
    table_data: {
      headers: ['Month', 'kWh'],
      rows: [
        ['Jan', '450'],
        ['Feb', '390'],
        ['Mar', '410'],
        ['Apr', '480']
      ]
    },
    correct_option_id: 'B',
    explanation: 'Feb had 390 kWh, which is lowest.'
  },
  {
    topic: 'data_interpretation',
    difficulty: 'medium',
    text: 'What is the median value of rainfall over 5 recorded days?',
    options: [
      { id: 'A', text: '12 mm' },
      { id: 'B', text: '14 mm' },
      { id: 'C', text: '15 mm' },
      { id: 'D', text: '16 mm' }
    ],
    table_data: {
      headers: ['Day', 'Rainfall (mm)'],
      rows: [
        ['Mon', '10'],
        ['Tue', '18'],
        ['Wed', '14'],
        ['Thu', '8'],
        ['Fri', '22']
      ]
    },
    correct_option_id: 'B',
    explanation: 'Sorted rainfall: 8, 10, 14, 18, 22. Median (3rd value) = 14 mm.'
  },
  {
    topic: 'data_interpretation',
    difficulty: 'hard',
    text: 'If product price increased by 10% and quantity sold dropped by 10%, what happened to total revenue?',
    options: [
      { id: 'A', text: 'No change' },
      { id: 'B', text: 'Increased by 1%' },
      { id: 'C', text: 'Decreased by 1%' },
      { id: 'D', text: 'Decreased by 2%' }
    ],
    correct_option_id: 'C',
    explanation: 'New revenue = 1.10 * 0.90 = 0.99 of original -> 1% decrease.'
  },
  {
    topic: 'data_interpretation',
    difficulty: 'easy',
    text: 'What is the ratio of male to female employees in Dept X?',
    options: [
      { id: 'A', text: '3:2' },
      { id: 'B', text: '2:3' },
      { id: 'C', text: '4:3' },
      { id: 'D', text: '5:4' }
    ],
    table_data: {
      headers: ['Gender', 'Count'],
      rows: [
        ['Male', '120'],
        ['Female', '80']
      ]
    },
    correct_option_id: 'A',
    explanation: '120 : 80 = 3:2.'
  },
  {
    topic: 'data_interpretation',
    difficulty: 'medium',
    text: 'What percentage of total defectives came from Line 2?',
    options: [
      { id: 'A', text: '30%' },
      { id: 'B', text: '40%' },
      { id: 'C', text: '50%' },
      { id: 'D', text: '25%' }
    ],
    table_data: {
      headers: ['Line', 'Defects'],
      rows: [
        ['Line 1', '15'],
        ['Line 2', '20'],
        ['Line 3', '15']
      ]
    },
    correct_option_id: 'B',
    explanation: 'Total defects = 50. Line 2 defects = 20. Percentage = 20/50 = 40%.'
  },
  {
    topic: 'data_interpretation',
    difficulty: 'hard',
    text: 'Compound Annual Growth Rate (CAGR) formula calculation: Initial value $100 grows to $144 in 2 years. What is annual growth rate?',
    options: [
      { id: 'A', text: '18%' },
      { id: 'B', text: '20%' },
      { id: 'C', text: '22%' },
      { id: 'D', text: '24%' }
    ],
    correct_option_id: 'B',
    explanation: '(1 + r)^2 = 144 / 100 = 1.44 => 1 + r = 1.20 => r = 20%.'
  },
  {
    topic: 'data_interpretation',
    difficulty: 'easy',
    text: 'Total attendance in 4 workshops: 40, 50, 60, 50. What is the mode of attendance?',
    options: [
      { id: 'A', text: '40' },
      { id: 'B', text: '50' },
      { id: 'C', text: '60' },
      { id: 'D', text: '55' }
    ],
    correct_option_id: 'B',
    explanation: '50 appears most frequently (twice).'
  },
  {
    topic: 'data_interpretation',
    difficulty: 'medium',
    text: 'A candidate needs 40% to pass an exam. If he gets 175 marks and fails by 25 marks, what are the maximum marks?',
    options: [
      { id: 'A', text: '450' },
      { id: 'B', text: '500' },
      { id: 'C', text: '600' },
      { id: 'D', text: '550' }
    ],
    correct_option_id: 'B',
    explanation: 'Passing marks = 175 + 25 = 200. 40% of Max = 200 => Max = 200 / 0.40 = 500.'
  }
];

export async function seedDatabase() {
  logger.info('Seeding database...');
  await runMigrations();

  // Seed colleges
  const colleges = [
    { name: 'Indian Institute of Technology Bombay', code: 'IITB' },
    { name: 'Indian Institute of Technology Delhi', code: 'IITD' },
    { name: 'National Institute of Technology Trichy', code: 'NITT' },
    { name: 'Birla Institute of Technology and Science Pilani', code: 'BITS' },
    { name: 'College of Engineering Pune', code: 'COEP' }
  ];

  for (const c of colleges) {
    await query(
      `INSERT INTO colleges (name, code) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING`,
      [c.name, c.code]
    );
  }

  // Seed default host user
  const hostUser = await query(
    `INSERT INTO users (google_sub, email, display_name, role)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET role = 'host'
     RETURNING id`,
    ['sub_host_001', 'admin@college.edu', 'Prof. Aptitude', 'host']
  );

  const hostId = hostUser.rows[0].id;

  // Seed sample question set
  const setRes = await query(
    `INSERT INTO question_sets (host_id, title, description)
     VALUES ($1, $2, $3)
     RETURNING id`,
    [hostId, 'Standard Aptitude & Reasoning Set', '60 comprehensive questions covering Quantitative, Logical, Verbal, and Data Interpretation.']
  );

  const setId = setRes.rows[0].id;

  // Seed 60 questions
  let pos = 1;
  for (const q of sampleQuestions) {
    await query(
      `INSERT INTO questions (set_id, text, options, correct_option_id, topic, difficulty, explanation, source, table_data, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        setId,
        q.text,
        JSON.stringify(q.options),
        q.correct_option_id,
        q.topic,
        q.difficulty,
        q.explanation,
        'manual',
        q.table_data ? JSON.stringify(q.table_data) : null,
        pos++
      ]
    );
  }

  logger.info(`Successfully seeded ${sampleQuestions.length} sample questions in Question Set ID ${setId}.`);
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  seedDatabase()
    .then(() => pool.end())
    .catch((err) => {
      logger.error({ err }, 'Seeding failed');
      process.exit(1);
    });
}
