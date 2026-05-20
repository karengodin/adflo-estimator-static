import { NextRequest, NextResponse } from "next/server";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  AlignmentType,
  WidthType,
  BorderStyle,
  convertInchesToTwip,
  ShadingType,
  VerticalAlign,
  Footer,
  PageNumber,
} from "docx";

// ─── Boilerplate texts ───────────────────────────────────────────────────────

const SECTION_1_PURPOSE =
  "The purpose of this Solutions Requirements Definition (SRD) document is to drive alignment between the Customer needs and requirements for engaging with TapClicks' products and services. The exercise aims to ensure that the Customer's expectations are set appropriately so that they can fully onboard smoothly and leverage TapClicks' offerings. This document will detail all items to be delivered in the implementation process, along with an initial project schedule. Customer's receipt and signed acknowledgement of the document will confirm scope of the TapClicks implementation project. SRD will be attached to the Master Service Agreement (MSA) as an exhibit. The project will be governed by the details, milestones and change controls outlined below.";

const SECTION_2_DEFINITIONS =
  "AdFlo is building the first outcome-based, end-to-end advertising operating system that replaces fragmented workflows with a compounding, AI-driven platform for planning, selling, activating, and reporting across digital and linear media. AdFlo consists of 4 modules (which can each exist separately): Proposal Front-end, Media Marketplace, Order Management & Kanban Workflow Management, Reporting.";

const SECTION_10_ROLES =
  "TapClicks to support: Configuration and ad hoc support during the Implementation including UAT/Production Configuration, Client/Order/Line Item/Flight forms, TapClicks QA of Configuration, Workflow Configuration, and User Acceptance Testing support. [CLIENT] to support: Project and program management, Use Cases and Solutioning, Scope alignment and management, User Acceptance Testing approval and signoff, and end-user Training.";

const SECTION_11_DELIVERABLES =
  "TapClicks Will Provide the following during the Implementation Project: Project Plan, Scope and Delivery Plan based on Discovery. Documentation Details for Milestone 1. Acceptance Criteria and User Acceptance Testing scripts for Milestone 2. Acceptance Criteria statements will be agreed-upon by both CUSTOMER and TapClicks. The Acceptance Criteria approves or rejects the User Acceptance Testing UAT for the Implementation. Confirmation of the Acceptance Criteria completes the implementation phase of the engagement.";

const SECTION_12_CADENCE =
  "In order for the project to progress forward, each of these checkpoints should be signed-off via email. Project Checkpoint 1 (Documentation Sign-Off): Product and Order Forms, Written approval of form fields as defined in shared implementation workbook, Delivery of Project Plan, Delivery dates, Estimated live date. Project Checkpoint 2 (UAT Start): Product and Order Forms platform configuration, Written approval of all forms configured on the TapClicks platform, Updated Project Plan, Remaining Delivery Dates, Live Date, User Acceptance Testing based on UAT Scripts provided by TapClicks.";

const SECTION_13_CHANGES =
  "Additional requirements that are uncovered during discovery will be managed using a change control process. These details will be documented in a separate Solutions Requirements Definition (SRD) or amendment to this document and will be estimated separately. Any material change to the scope, level of effort or schedule outlined below will require an amendment to this SRD and the CUSTOMER's signed acknowledgement of said amendment.";

// ─── Style constants ─────────────────────────────────────────────────────────

const BRAND_BLUE = "1F3A6E";   // dark navy
const ACCENT_BLUE = "2F6FED";  // bright blue
const LIGHT_BLUE = "EAF1FF";   // table header fill
const GRAY_TEXT = "627286";
const BODY_SIZE = 22;          // 11pt in half-points
const SMALL_SIZE = 18;         // 9pt
const FONT = "Calibri";

// ─── Paragraph helpers ───────────────────────────────────────────────────────

function sectionHeading(num: number, title: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: `Section ${num}: ${title}`, bold: true, size: 28, color: BRAND_BLUE, font: FONT }),
    ],
    spacing: { before: 480, after: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: ACCENT_BLUE, space: 4 } },
  });
}

function subHeading(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, size: 24, color: BRAND_BLUE, font: FONT })],
    spacing: { before: 240, after: 120 },
  });
}

function bodyPara(text: string, color = "000000"): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, size: BODY_SIZE, color, font: FONT })],
    spacing: { before: 0, after: 160 },
  });
}

function bulletPara(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, size: BODY_SIZE, font: FONT })],
    bullet: { level: 0 },
    spacing: { before: 0, after: 80 },
  });
}

function spacer(lines = 1): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text: "", break: lines })],
    spacing: { before: 0, after: 0 },
  });
}

function centeredPara(text: string, opts: { bold?: boolean; size?: number; color?: string } = {}): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text, bold: opts.bold, size: opts.size ?? BODY_SIZE, color: opts.color ?? "000000", font: FONT })],
    spacing: { before: 80, after: 80 },
  });
}

// ─── Table helpers ───────────────────────────────────────────────────────────

const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const thinBorder = { style: BorderStyle.SINGLE, size: 4, color: "DDE5EF" };

function hoursTable(breakdown: {
  form_configuration: { hours: number; detail: string[] };
  workflow_configuration: { hours: number; detail: string[] };
  qa: { hours: number; detail: string[] };
  uat_support: { hours: number; detail: string[] };
  program_management: { hours: number; detail: string[] };
  total: number;
}): Table {
  const headerCell = (text: string, pct: number) =>
    new TableCell({
      children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text, bold: true, size: BODY_SIZE, color: "FFFFFF", font: FONT })] })],
      width: { size: pct, type: WidthType.PERCENTAGE },
      shading: { type: ShadingType.SOLID, color: BRAND_BLUE },
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
    });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dataCell = (text: string, pct: number, bold = false, align: string = AlignmentType.LEFT) =>
    new TableCell({
      children: [new Paragraph({ alignment: align as any, children: [new TextRun({ text, bold, size: BODY_SIZE, font: FONT })] })],
      width: { size: pct, type: WidthType.PERCENTAGE },
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
      borders: { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder },
    });

  const totalCell = (text: string, pct: number, bold = false, align: string = AlignmentType.LEFT) =>
    new TableCell({
      children: [new Paragraph({ alignment: align as any, children: [new TextRun({ text, bold, size: BODY_SIZE, color: BRAND_BLUE, font: FONT })] })],
      width: { size: pct, type: WidthType.PERCENTAGE },
      shading: { type: ShadingType.SOLID, color: LIGHT_BLUE },
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
      borders: { top: thinBorder, bottom: thinBorder, left: thinBorder, right: thinBorder },
    });

  const rows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [headerCell("Category", 45), headerCell("Hours", 15), headerCell("Details", 40)],
    }),
  ];

  const items: Array<{ label: string; key: keyof typeof breakdown }> = [
    { label: "Form Configuration", key: "form_configuration" },
    { label: "Workflow Configuration", key: "workflow_configuration" },
    { label: "QA", key: "qa" },
    { label: "UAT Support", key: "uat_support" },
    { label: "Program Management", key: "program_management" },
  ];

  for (const { label, key } of items) {
    const item = breakdown[key] as { hours: number; detail: string[] };
    const detail = Array.isArray(item.detail) ? item.detail.join("\n") : "";
    rows.push(
      new TableRow({
        children: [
          dataCell(label, 45),
          dataCell(String(item.hours), 15, false, AlignmentType.CENTER),
          dataCell(detail, 40),
        ],
      })
    );
  }

  rows.push(
    new TableRow({
      children: [
        totalCell("TOTAL", 45, true),
        totalCell(String(breakdown.total), 15, true, AlignmentType.CENTER),
        totalCell("", 40),
      ],
    })
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
  });
}

function signatureTable(clientName: string): Table {
  const labelCell = (text: string) =>
    new TableCell({
      children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: SMALL_SIZE, color: GRAY_TEXT, font: FONT })] })],
      width: { size: 50, type: WidthType.PERCENTAGE },
      borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder },
      margins: { top: 60, bottom: 4, left: 0, right: 120 },
    });

  const lineCell = () =>
    new TableCell({
      children: [
        new Paragraph({ children: [new TextRun({ text: "", size: BODY_SIZE })] }),
        new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "000000" } }, children: [new TextRun({ text: " " })] }),
      ],
      width: { size: 50, type: WidthType.PERCENTAGE },
      borders: { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder },
      margins: { top: 60, bottom: 4, left: 120, right: 0 },
    });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ children: [labelCell(`${clientName} — Authorized Signature`), labelCell("TapClicks — Authorized Signature")] }),
      new TableRow({ children: [lineCell(), lineCell()] }),
      new TableRow({ children: [labelCell("Print Name"), labelCell("Print Name")] }),
      new TableRow({ children: [lineCell(), lineCell()] }),
      new TableRow({ children: [labelCell("Title"), labelCell("Title")] }),
      new TableRow({ children: [lineCell(), lineCell()] }),
      new TableRow({ children: [labelCell("Date"), labelCell("Date")] }),
      new TableRow({ children: [lineCell(), lineCell()] }),
    ],
  });
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const srd = await req.json();

  const clientName: string = srd.meta?.clientName || "Client";
  const repName: string = srd.meta?.repName || "TapClicks";
  const tier: string = srd.meta?.tier || "";
  const totalHours: number = srd.meta?.estimatedHours ?? 0;
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  // Replace [CLIENT] placeholder in boilerplates
  const replace = (text: string) => text.replace(/\[CLIENT\]/g, clientName);

  const methodologyText = `TapClicks provided demos of AdFlo and did a business process discovery focusing on ${clientName}'s Orders and Workflow processes and advertising-related systems. There was an emphasis on pre-sales, planning, order management and workflows. TapClicks then reviewed and highlighted where TapClicks technology can fit into ${clientName}'s ecosystem. TapClicks offered technical solutions to the problems that were uncovered during the various pre-sales meetings and discovery sessions. Said solutions are outlined below in more detail. The scope of the solution and project is subject to change based on new learnings that may be uncovered during the post-sale project discovery once the engagement begins or in other future sessions. Said scope changes will be handled via the Change Request process detailed in Section 13.`;

  const doc = new Document({
    creator: "AdFlo Estimator",
    title: `SRD — ${clientName}`,
    description: "Solutions Requirements Definition",
    styles: {
      default: {
        document: {
          run: { font: FONT, size: BODY_SIZE },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              right: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1.25),
            },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ children: [`TapClicks Confidential  |  ${clientName} SRD  |  Page `, PageNumber.CURRENT], size: SMALL_SIZE, color: GRAY_TEXT, font: FONT }),
                ],
              }),
            ],
          }),
        },
        children: [
          // ── Cover ──────────────────────────────────────────────────────────
          spacer(4),
          centeredPara("SOLUTIONS REQUIREMENTS DEFINITION", { bold: true, size: 36, color: BRAND_BLUE }),
          centeredPara("AdFlo Order Management & Workflow", { size: 26, color: ACCENT_BLUE }),
          spacer(2),
          centeredPara(clientName, { bold: true, size: 28, color: BRAND_BLUE }),
          centeredPara(`Prepared for: ${repName}`, { size: 22, color: GRAY_TEXT }),
          centeredPara(today, { size: 22, color: GRAY_TEXT }),
          spacer(1),
          centeredPara(`${totalHours} Hours  ·  ${tier} Tier`, { bold: true, size: 22, color: ACCENT_BLUE }),
          spacer(8),
          centeredPara("CONFIDENTIAL", { bold: true, size: 18, color: GRAY_TEXT }),
          centeredPara("This document contains proprietary and confidential information.", { size: 18, color: GRAY_TEXT }),
          centeredPara("© TapClicks, Inc. All rights reserved.", { size: 18, color: GRAY_TEXT }),

          // ── Section 1: Purpose ────────────────────────────────────────────
          sectionHeading(1, "Purpose"),
          bodyPara(SECTION_1_PURPOSE),

          // ── Section 2: Definitions ────────────────────────────────────────
          sectionHeading(2, "Definitions"),
          bodyPara(SECTION_2_DEFINITIONS),

          // ── Section 3: Engagement Overview ───────────────────────────────
          sectionHeading(3, "Engagement Overview"),
          bodyPara(srd.engagement_overview || ""),

          // ── Section 4: Methodology ────────────────────────────────────────
          sectionHeading(4, "Methodology"),
          bodyPara(methodologyText),

          // ── Section 5: Customer Objectives ───────────────────────────────
          sectionHeading(5, "Customer Objectives"),
          ...(Array.isArray(srd.customer_objectives)
            ? srd.customer_objectives.map((obj: string) => bulletPara(obj))
            : [bodyPara("See engagement overview.")]),

          // ── Section 6: System Architecture ───────────────────────────────
          sectionHeading(6, "System Architecture"),
          bodyPara(srd.system_architecture || ""),

          // ── Section 7: In Scope ───────────────────────────────────────────
          sectionHeading(7, "In Scope"),
          bodyPara(srd.in_scope?.narrative || ""),
          spacer(1),
          subHeading("Hours Breakdown"),
          ...(srd.in_scope?.hours_breakdown
            ? [hoursTable(srd.in_scope.hours_breakdown)]
            : [bodyPara("See engagement overview for details.")]),

          // ── Section 8: Out of Scope ───────────────────────────────────────
          sectionHeading(8, "Out of Scope"),
          bodyPara("The following items are explicitly excluded from this engagement:"),
          ...(Array.isArray(srd.out_of_scope)
            ? srd.out_of_scope.map((item: string) => bulletPara(item))
            : []),

          // ── Section 9: Integration Strategy ──────────────────────────────
          sectionHeading(9, "Integration Strategy"),
          bodyPara(
            srd.integration_strategy ||
              "No third-party integrations are included in this engagement scope. Any integration requirements identified in future sessions will be handled via the change request process."
          ),

          // ── Section 10: Project Roles ─────────────────────────────────────
          sectionHeading(10, "Project Roles & Responsibilities"),
          bodyPara(replace(SECTION_10_ROLES)),

          // ── Section 11: Deliverables ──────────────────────────────────────
          sectionHeading(11, "Deliverables"),
          bodyPara(SECTION_11_DELIVERABLES),

          // ── Section 12: Project Cadence ───────────────────────────────────
          sectionHeading(12, "Project Cadence"),
          bodyPara(SECTION_12_CADENCE),

          // ── Section 13: Change Requests ───────────────────────────────────
          sectionHeading(13, "Change Requests"),
          bodyPara(SECTION_13_CHANGES),

          // ── Risks & Flags (conditional) ───────────────────────────────────
          ...(Array.isArray(srd.risks_and_flags) && srd.risks_and_flags.length > 0
            ? [
                sectionHeading(14, "Risks & Scope Flags"),
                bodyPara(
                  "The following items were identified during discovery and may affect scope, timeline, or require special handling:",
                  "DC2626"
                ),
                ...srd.risks_and_flags.map((r: string) => bulletPara(r)),
              ]
            : []),

          // ── Signature Block ───────────────────────────────────────────────
          spacer(2),
          new Paragraph({
            children: [new TextRun({ text: "Acceptance & Authorization", bold: true, size: 26, color: BRAND_BLUE, font: FONT })],
            spacing: { before: 400, after: 200 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: ACCENT_BLUE, space: 4 } },
          }),
          bodyPara(
            `By signing below, both parties agree to the scope, timeline, and terms outlined in this Solutions Requirements Definition. This document becomes an exhibit to the Master Service Agreement between ${clientName} and TapClicks, Inc.`
          ),
          spacer(2),
          signatureTable(clientName),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);

  const safeName = clientName.replace(/[^a-zA-Z0-9\s-]/g, "").replace(/\s+/g, "-");
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="SRD-${safeName}-${new Date().toISOString().slice(0, 10)}.docx"`,
    },
  });
}
