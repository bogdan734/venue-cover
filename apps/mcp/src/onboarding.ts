import {
  type CallToolResult,
  type InputRequiredResult,
  McpServer,
} from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { ApiClient, ProgramSummary } from './api.js';
import { confirmWithUser, failure, keyFor, ok } from './server.js';

const OPEN = 'Yes, open the portal to the public';
const today = () => new Date().toISOString().slice(0, 10);

function checklist(p: ProgramSummary) {
  return {
    programId: p.id,
    code: p.code,
    name: p.name,
    status: p.status,
    rulesVersion: p.versions.length,
    appearance: p.theme !== null,
    contacts: p.contacts !== null,
    portal: `/p/${p.code}`,
  };
}

// The tools an agent uses to set a new client up, from a letter to a portal that staff can try. Opening it to the public
// is the person's call: publish_client asks them, and nothing opens without a yes. The agent's key manages programs and
// nothing else, so it cannot read a report or take a payment, and every change it makes is in the audit log under its
// key's name.
export function createOnboardingServer(api: ApiClient): McpServer {
  const server = new McpServer(
    { name: 'venue-cover-onboarding', version: '1.0.0' },
    {
      instructions:
        'Set up a new client program from what the client wrote. draft_client creates it as a draft and turns the letter into rules; set_appearance gives its portal a colour, wording and contacts; preview_client moves it to test so staff can try the portal and reports what is done; publish_client asks the person before opening it to the public. A colour that cannot be read is refused: choose a darker one.',
    },
  );

  server.registerTool(
    'draft_client',
    {
      description:
        'Create a client program as a draft (only staff see its portal). When the client’s letter is given, its requirements become the program’s rules, and anything that could not be turned into a rule is listed for a person.',
      inputSchema: z.object({
        name: z.string().min(2).max(120),
        code: z
          .string()
          .regex(/^[A-Z][A-Z0-9]{2,5}$/)
          .describe('3 to 6 capitals or digits'),
        province: z.string().length(2).describe('Two-letter Canadian province code'),
        letter: z.string().max(10_000).optional(),
      }),
    },
    async (args) => {
      try {
        const options = await api.programOptions();
        const program = await api.createProgram(
          {
            templateId: options.templates[0]?.id,
            brokerId: options.brokers[0]?.id,
            name: args.name,
            code: args.code,
            province: args.province,
          },
          keyFor('agent-draft', { code: args.code }),
        );
        if (!args.letter) {
          return ok(
            `${program.name} (${program.code}) is a draft with the template’s rules.`,
            checklist(program),
          );
        }
        const draft = await api.draftRules(program.id, args.letter);
        const changed = Object.keys(draft.changes).length > 0;
        if (changed) {
          await api.publishRules(
            program.id,
            draft.changes,
            today(),
            keyFor('agent-rules', { id: program.id, changes: draft.changes }),
          );
        }
        const after = await api.getProgram(program.id);
        const unresolved = draft.unresolved.length
          ? ` For a person to look at: ${draft.unresolved.join('; ')}.`
          : '';
        return ok(
          `${after.name} (${after.code}) is a draft. ${changed ? `The letter changed ${Object.keys(draft.changes).join(', ')}.` : 'The letter changed none of the template’s rules.'}${unresolved}`,
          {
            ...checklist(after),
            changed: Object.keys(draft.changes),
            unresolved: draft.unresolved,
          },
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'set_appearance',
    {
      description:
        'Give the portal its look and the support contacts renters see. The colour must read at 4.5:1 against the page, or it is refused with the measured ratio.',
      inputSchema: z.object({
        programId: z.string(),
        brand: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        tagline: z.string().max(120).optional(),
        welcome: z.string().max(400).optional(),
        supportEmail: z.email().optional(),
        supportPhone: z.string().max(20).optional(),
        hours: z.string().max(80).optional(),
      }),
    },
    async ({ programId, brand, tagline, welcome, supportEmail, supportPhone, hours }) => {
      try {
        const current = await api.getProgram(programId);
        await api.setAppearance(programId, {
          brand,
          logo: current.theme?.logo ?? null,
          tagline: tagline ?? null,
          welcome: welcome ?? null,
        });
        if (supportEmail || supportPhone || hours) {
          await api.setContacts(programId, {
            supportEmail: supportEmail ?? null,
            supportPhone: supportPhone ?? null,
            telegram: current.contacts?.telegram ?? null,
            hours: hours ?? null,
          });
        }
        const after = await api.getProgram(programId);
        return ok(
          `${after.name} now has its colour${after.contacts ? ' and contacts' : ''}.`,
          checklist(after),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'preview_client',
    {
      description:
        'Move a draft to test, so staff can try its portal, and report what is done and what is left before it can open.',
      inputSchema: z.object({ programId: z.string() }),
    },
    async ({ programId }) => {
      try {
        let program = await api.getProgram(programId);
        if (program.status === 'draft') {
          await api.moveProgram(programId, 'test', keyFor('agent-test', { programId }));
          program = await api.getProgram(programId);
        }
        const left = [
          program.theme ? null : 'appearance',
          program.contacts ? null : 'contacts',
        ].filter(Boolean);
        return ok(
          `${program.name} is ${program.status}; staff can try it at ${`/p/${program.code}`}.${left.length ? ` Still to do: ${left.join(', ')}.` : ' Ready to open when the person agrees.'}`,
          checklist(program),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    'publish_client',
    {
      description:
        'Open the portal to the public. The person is asked first; nothing opens unless they accept.',
      inputSchema: z.object({ programId: z.string() }),
    },
    async ({ programId }, ctx): Promise<CallToolResult | InputRequiredResult> => {
      try {
        const program = await api.getProgram(programId);
        if (program.status === 'live')
          return ok(`${program.name} is already open.`, checklist(program));
        const decision = await confirmWithUser(
          ctx as never,
          `Open ${program.name} (${program.code}) to the public? Its portal at /p/${program.code} will be listed and take bookings.`,
          OPEN,
        );
        if (decision.kind === 'pending') return decision.result;
        if (decision.kind !== 'accepted') {
          return ok(
            decision.kind === 'declined'
              ? 'Not opened: the person did not agree. It stays as it is.'
              : 'Not opened: this client cannot ask the person, and nothing opens without them.',
            { ...checklist(program), opened: false },
          );
        }
        if (program.status === 'draft') {
          await api.moveProgram(programId, 'test', keyFor('agent-test', { programId }));
        }
        await api.moveProgram(programId, 'live', keyFor('agent-live', { programId }));
        const opened = await api.getProgram(programId);
        return ok(`${opened.name} is open at /p/${opened.code}.`, {
          ...checklist(opened),
          opened: true,
        });
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}
