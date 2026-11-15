import type { QuestionDef } from '../../domain/types.js';

// A standard set of follow-up questions, invented for the demo. A program starts from it and adds or drops questions
// as data; none of this needs code.
export const STANDARD_QUESTIONS: QuestionDef[] = [
  {
    id: 'server_training',
    text: 'Will everyone who serves alcohol hold a recognised server certificate?',
    type: 'yesno',
    appliesWhen: { alcohol: ['served', 'sold'] },
    referIf: { equals: false },
  },
  {
    id: 'waivers_minors',
    text: 'Will a parent or guardian sign a waiver for every participant under 18?',
    type: 'yesno',
    appliesWhen: { flag: 'minors' },
    referIf: { equals: false },
  },
  {
    id: 'inflatable_supervision',
    text: 'Who will supervise the inflatables?',
    type: 'choice',
    choices: ['operator', 'organizer', 'nobody'],
    appliesWhen: { flag: 'inflatables' },
    referIf: { equals: 'nobody' },
  },
  {
    id: 'animal_handler',
    text: 'Will a licensed handler be present with the animals at all times?',
    type: 'yesno',
    appliesWhen: { flag: 'animals' },
    referIf: { equals: false },
  },
  {
    id: 'security_plan',
    text: 'Is there a written security plan with trained staff?',
    type: 'yesno',
    appliesWhen: { minParticipants: 250 },
    referIf: { equals: false },
  },
];
