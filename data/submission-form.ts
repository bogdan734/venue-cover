import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import {
  CHOICE_FIELDS,
  type ChoiceField,
  LABELS,
  type SubmissionValues,
  TEXT_FIELDS,
  type TextField,
} from '../apps/api/src/modules/submissions/fields.js';

// A fillable PDF for the large-event application (no timestamps in it, so that the same input is the same bytes), built here so that the repository needs no third-party form.
// Text boxes hold free text and numbers; every yes/no and choice is a dropdown that starts empty, so that "not answered"
// can be told from "no".
export async function blankForm(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const form = pdf.getForm();

  let page = pdf.addPage([595, 842]);
  page.drawText('Large event application', { x: 40, y: 800, size: 16, font: bold });
  page.drawText('Demonstration form: not an insurance application', {
    x: 40,
    y: 784,
    size: 8,
    font,
    color: rgb(0.6, 0.1, 0.1),
  });
  let y = 756;

  const names = [...TEXT_FIELDS, ...(Object.keys(CHOICE_FIELDS) as ChoiceField[])];
  for (const name of names) {
    if (y < 60) {
      page = pdf.addPage([595, 842]);
      y = 800;
    }
    page.drawText(LABELS[name], { x: 40, y: y + 4, size: 8, font });
    if ((TEXT_FIELDS as readonly string[]).includes(name)) {
      const field = form.createTextField(name);
      const tall = name === 'description';
      if (tall) field.enableMultiline();
      field.addToPage(page, { x: 300, y: y - (tall ? 24 : 2), width: 240, height: tall ? 40 : 16 });
      y -= tall ? 52 : 22;
    } else {
      const field = form.createDropdown(name);
      field.addOptions([...CHOICE_FIELDS[name as ChoiceField]]);
      field.addToPage(page, { x: 300, y: y - 2, width: 240, height: 16 });
      y -= 22;
    }
  }
  return pdf.save();
}

export async function filledForm(values: SubmissionValues): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(await blankForm(), { updateMetadata: false });
  const form = pdf.getForm();
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === '') continue; // blank stays blank
    if (name in CHOICE_FIELDS) form.getDropdown(name).select(value);
    else form.getTextField(name as TextField).setText(value);
  }
  return pdf.save();
}

// A complete, invented application: a two-day music festival.
export function sampleValues(over: SubmissionValues = {}): SubmissionValues {
  return {
    organizerName: 'Riverside Music Society',
    contactName: 'Alex Morgan',
    contactEmail: 'alex@riverside-music.example',
    contactPhone: '416-555-0100',
    eventName: 'Riverside Summer Sounds',
    description:
      'Two-day summer music festival with food vendors, a beer garden and a main stage in the waterfront park',
    eventDate: '2027-06-19',
    startTime: '12:00',
    endTime: '23:00',
    eventDays: '2',
    dailyMin: '800',
    dailyMax: '2500',
    totalAttendance: '4200',
    shareUnder18: '20',
    lastYearDailyMax: '2300',
    temporarySeats: '300',
    vendor_food: '12',
    vendor_liquor: '2',
    vendor_performer: '6',
    vendor_retail: '10',
    vendor_animal: '0',
    vendor_carnival: '0',
    vendor_dunk_tank: '0',
    vendor_inflatable: '0',
    vendor_security: '2',
    alcoholServedBy: 'vendors',
    serverTraining: 'yes',
    pyrotechnics: 'no',
    overnight: 'no',
    priorClaims: 'no',
    refusedBefore: 'no',
    truthful: 'yes',
    limitDollars: '2000000',
    signedBy: 'Alex Morgan',
    ...over,
  };
}

// A page of text with no form fields: what a scan or a print-to-PDF looks like.
export async function flatPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create({ updateMetadata: false });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([595, 842]).drawText('A scanned application', { x: 40, y: 780, size: 14, font });
  return pdf.save();
}
