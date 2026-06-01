import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "../../../../../../lib/supabaseServer";
import ExcelJS from "exceljs";

export const maxDuration = 60;

// ── Types ─────────────────────────────────────────────────────────────────────

interface DbQuestion {
  id: number;
  sort_order: number;
  question_type: string | null;
}

interface ExtractedData {
  clientName: string;
  primaryContact: { name: string; email: string; title: string };
  stakeholders: Array<{ name: string; email: string; title: string; company: string; role: string; type: string }>;
  products: Array<{ name: string; channel: string; vendor: string; managedService: boolean }>;
  queues: Array<{ name: string; notes: string }>;
  users: { count: number; roles: string[] };
  integrations: string[];
  goLiveDate: string | null;
  businessUnits: string[];
  orderApprovalFlow: string;
  workflowNotes: string;
}

interface AssignedIM {
  id: string;
  name: string;
  role: string;
  hoursPerWeek: number;
  experienceMultiplier: number;
}

// ── Color constants (ARGB — FF prefix = fully opaque) ─────────────────────────

const CLR = {
  DARK_BLUE:  "FF0B5AB2",
  LIGHT_BLUE: "FF6D9EEB",
  ORANGE:     "FFF6B26B",
  BLUE_GRAY:  "FFADB9CA",
  LIGHT_GRAY: "FFD8D8D8",
  VERY_LIGHT: "FFEAEEF3",
  PHASE_GRP:  "FFCCCCCC",
  GREEN_DATE: "FFD4EDBC",
  GRAY_ROW:   "FFB7B7B7",
  DARK_GRAY:  "FF999999",
  LIGHT_FILL: "FFF2F2F2",
  WHITE:      "FFFFFFFF",
  D6DCE4:     "FFD6DCE4",
};

// ── Style helpers ─────────────────────────────────────────────────────────────

function sf(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } } as ExcelJS.Fill;
}

function darkHdr(cell: ExcelJS.Cell, label: string) {
  cell.value = label;
  cell.fill = sf(CLR.DARK_BLUE);
  cell.font = { bold: true, color: { argb: CLR.WHITE }, size: 10, name: "Calibri" };
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
}

function addHeaderRow(ws: ExcelJS.Worksheet, rowNum: number, headers: string[]) {
  ws.getRow(rowNum).height = 25;
  headers.forEach((label, i) => darkHdr(ws.getCell(rowNum, i + 1), label));
}

function addBlankSheet(wb: ExcelJS.Workbook, name: string, headers: string[]) {
  const ws = wb.addWorksheet(name);
  headers.forEach((_, i) => { ws.getColumn(i + 1).width = 20; });
  addHeaderRow(ws, 1, headers);
}

// ── Sheet: Project Schedule ───────────────────────────────────────────────────

function addProjectSchedule(wb: ExcelJS.Workbook, extracted: ExtractedData) {
  const ws = wb.addWorksheet("Project Schedule");
  const today = new Date().toLocaleDateString("en-US", {
    month: "2-digit", day: "2-digit", year: "numeric",
  });

  // Column widths: A=margin, B=Phase Title, C=Start, D=Planned End, E=Duration,
  //                F=Actual Completion, G=Status, H=Owner, I=Resources, J=Risks, K=Issues, L=Comments
  [3, 45, 12, 18, 12, 22, 15, 20, 15, 15, 15, 25].forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  // ── Header block ──

  // Row 1: title
  ws.getRow(1).height = 22;
  const r1b = ws.getCell("B1");
  r1b.value = "PROJECT SCHEDULE";
  r1b.font = { bold: true, size: 14, color: { argb: CLR.DARK_BLUE }, name: "Calibri" };

  // Row 2: labels
  ws.getRow(2).height = 18;
  ws.getCell("B2").value = "PROJECT NAME";
  ws.getCell("B2").font = { bold: true, name: "Calibri" };
  ws.getCell("G2").value = "START DATE";
  ws.getCell("G2").font = { bold: true, name: "Calibri" };

  // Row 3: client name / today
  ws.getRow(3).height = 18;
  ws.getCell("B3").value = extracted.clientName;
  ws.getCell("B3").fill = sf(CLR.LIGHT_FILL);
  ws.getCell("B3").font = { name: "Calibri" };
  ws.getCell("G3").value = today;
  ws.getCell("G3").fill = sf(CLR.VERY_LIGHT);
  ws.getCell("G3").font = { name: "Calibri" };

  // Row 4: labels
  ws.getRow(4).height = 18;
  ws.getCell("B4").value = "POINT OF CONTACT";
  ws.getCell("B4").font = { bold: true, name: "Calibri" };
  ws.getCell("G4").value = "END DATE";
  ws.getCell("G4").font = { bold: true, name: "Calibri" };

  // Row 5: contact / go-live
  ws.getRow(5).height = 18;
  ws.getCell("B5").value = extracted.primaryContact.name || "";
  ws.getCell("B5").font = { name: "Calibri" };
  ws.getCell("G5").value = extracted.goLiveDate || "TBD";
  ws.getCell("G5").fill = sf(CLR.VERY_LIGHT);
  ws.getCell("G5").font = { name: "Calibri" };

  // Row 6: spacer
  ws.getRow(6).height = 6;

  // Row 7: TIMELINE label (merged C7:L7)
  ws.getRow(7).height = 18;
  ws.mergeCells("C7:L7");
  ws.getCell("C7").value = "TIMELINE";
  ws.getCell("C7").font = { bold: true, name: "Calibri" };
  ws.getCell("C7").fill = sf(CLR.D6DCE4);
  ws.getCell("C7").alignment = { horizontal: "center", vertical: "middle" };

  // Row 8: column headers — each col has its own fill per spec
  ws.getRow(8).height = 30;
  const hdr8: Array<[number, string, string]> = [
    [2,  "PHASE TITLE",            CLR.BLUE_GRAY],
    [3,  "START DATE",             CLR.LIGHT_GRAY],
    [4,  "PLANNED END DATE",       CLR.LIGHT_GRAY],
    [5,  "DURATION in days",       CLR.BLUE_GRAY],
    [6,  "ACTUAL COMPLETION DATE", CLR.VERY_LIGHT],
    [7,  "STATUS",                 CLR.VERY_LIGHT],
    [8,  "AdFlo Owner",            CLR.VERY_LIGHT],
    [9,  "RESOURCES",              CLR.VERY_LIGHT],
    [10, "RISKS",                  CLR.VERY_LIGHT],
    [11, "ISSUES",                 CLR.VERY_LIGHT],
    [12, "COMMENTS",               CLR.VERY_LIGHT],
  ];
  for (const [col, label, fillColor] of hdr8) {
    const cell = ws.getCell(8, col);
    cell.value = label;
    cell.fill = sf(fillColor);
    cell.font = { bold: true, size: 10, name: "Calibri" };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  }

  // ── Phase data rows (start at row 9) ──
  const phases: Array<{ name: string; isGroup?: boolean; startDate?: string }> = [
    { name: "Initiation", isGroup: true },
    { name: "Project Kickoff" },
    { name: "SRD Review & Sign-Off" },
    { name: "Stakeholder Introductions" },
    { name: "Workbook Completion" },
    { name: "Discovery", isGroup: true },
    { name: "Product Form Discovery" },
    { name: "Order Form Discovery" },
    { name: "Task Form Discovery" },
    { name: "Workflow Discovery" },
    { name: "User & Role Discovery" },
    { name: "Integration Discovery" },
    { name: "Checkpoint 1: Documentation Sign-Off" },
    { name: "UAT Configuration", isGroup: true },
    { name: "Product & Order Form Build" },
    { name: "Workflow Configuration" },
    { name: "User Setup & Permissions" },
    { name: "Integration Setup" },
    { name: "Checkpoint 2: UAT Start" },
    { name: "End-User Training", isGroup: true },
    { name: "Admin Training" },
    { name: "End-User Training Sessions" },
    { name: "Training Sign-Off" },
    { name: "UAT", isGroup: true },
    { name: "UAT Execution" },
    { name: "Bug Triage & Fixes" },
    { name: "UAT Sign-Off" },
    { name: "Checkpoint 3: UAT Sign-Off" },
    { name: "Launch", isGroup: true },
    { name: "Go-Live Preparation" },
    { name: "Go-Live", startDate: extracted.goLiveDate || "" },
    { name: "Post-Launch Hypercare" },
  ];

  let taskIdx = 0;
  phases.forEach((phase, i) => {
    const rowNum = 9 + i;
    ws.getRow(rowNum).height = 16;

    const titleCell = ws.getCell(rowNum, 2);
    titleCell.value = phase.name;
    titleCell.font = { bold: !!phase.isGroup, size: 10, name: "Calibri" };
    titleCell.alignment = { vertical: "middle", indent: phase.isGroup ? 0 : 1 };

    if (phase.isGroup) {
      for (let col = 2; col <= 12; col++) {
        ws.getCell(rowNum, col).fill = sf(CLR.PHASE_GRP);
        if (col !== 2) ws.getCell(rowNum, col).font = { size: 10, name: "Calibri" };
      }
    } else {
      const altFill = taskIdx % 2 === 0 ? CLR.WHITE : CLR.LIGHT_FILL;
      for (let col = 2; col <= 12; col++) {
        const cell = ws.getCell(rowNum, col);
        cell.font = { size: 10, name: "Calibri" };
        cell.alignment = { vertical: "middle" };
        if (col === 3) {
          if (phase.startDate) cell.value = phase.startDate;
          cell.fill = sf(CLR.GREEN_DATE);
        } else if (col === 7) {
          cell.value = "Not Started";
          cell.fill = sf(CLR.VERY_LIGHT);
        } else {
          cell.fill = sf(altFill);
        }
      }
      taskIdx++;
    }
  });
}

// ── Sheet: Stakeholder Register ───────────────────────────────────────────────

function addStakeholderRegister(wb: ExcelJS.Workbook, extracted: ExtractedData, assignedIMs: AssignedIM[]) {
  const ws = wb.addWorksheet("Stakeholder Register");
  [30, 30, 20, 20, 18, 12, 14, 20, 14].forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  // Header row: cols 1–6 = dark blue, cols 7–9 = orange (SME columns)
  ws.getRow(1).height = 30;
  const stakeHdrs = [
    "Stakeholder (Name - suffix)", "Email", "Title", "Project Role",
    "Project Involvement", "Comm Freq", "Business SME", "Internal System SME", "Involved in Sale",
  ];
  stakeHdrs.forEach((label, i) => {
    const cell = ws.getCell(1, i + 1);
    cell.value = label;
    cell.fill = sf(i >= 6 ? CLR.ORANGE : CLR.DARK_BLUE);
    cell.font = { bold: true, color: { argb: CLR.WHITE }, size: 10, name: "Calibri" };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  });

  let rowNum = 2;

  function addStakeRow(values: string[]) {
    ws.getRow(rowNum).height = 16;
    const altFill = rowNum % 2 === 0 ? CLR.LIGHT_FILL : CLR.WHITE;
    values.forEach((val, i) => {
      const cell = ws.getCell(rowNum, i + 1);
      cell.value = val;
      cell.fill = sf(altFill);
      cell.font = { size: 10, name: "Calibri" };
      cell.alignment = { vertical: "middle", wrapText: i === 0 };
    });
    rowNum++;
  }

  // Primary contact (client)
  if (extracted.primaryContact?.name) {
    const already = extracted.stakeholders.some(s => s.name === extracted.primaryContact.name);
    if (!already) {
      addStakeRow([
        `${extracted.primaryContact.name} - C`,
        extracted.primaryContact.email || "",
        extracted.primaryContact.title || "",
        "Primary Contact", "High", "Weekly", "No", "No", "No",
      ]);
    }
  }

  // Additional client stakeholders from transcript
  for (const s of extracted.stakeholders) {
    addStakeRow([
      `${s.name || ""} - ${s.type || "C"}`,
      s.email || "", s.title || "", s.role || "",
      "TBD", "TBD", "No", "No", "No",
    ]);
  }

  // AdFlo team rows — use real assigned IMs if provided, else generic placeholders
  const activeIMs = assignedIMs.filter(im => im.name || im.role);
  console.log(`[addStakeholderRegister] writing ${activeIMs.length > 0 ? activeIMs.length : 3} T rows (activeIMs: ${activeIMs.length}, total assignedIMs: ${assignedIMs.length})`);
  if (activeIMs.length > 0) {
    for (const im of activeIMs) {
      addStakeRow([`${im.name || "[Name]"} - T`, "", im.role || "", "", "", "", "No", "No", "No"]);
    }
  } else {
    for (const [name, email, title, role, inv, freq] of [
      ["[IM Name] - T",  "[im.name]@adflo.com",  "Implementation Manager",  "Implementation Lead", "High",   "Weekly"],
      ["[PM Name] - T",  "[pm.name]@adflo.com",  "Project Manager",          "Project Manager",     "High",   "Weekly"],
      ["[CSM Name] - T", "[csm.name]@adflo.com", "Customer Success Manager", "CSM",                 "Medium", "Bi-Weekly"],
    ]) {
      addStakeRow([name, email, title, role, inv, freq, "No", "No", "No"]);
    }
  }
}

// ── Sheet: Master Product List ────────────────────────────────────────────────

function addMasterProductList(wb: ExcelJS.Workbook, extracted: ExtractedData) {
  const ws = wb.addWorksheet("Master Product List");
  [30, 25, 20, 15, 22].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  addHeaderRow(ws, 1, ["Product Name", "Subproducts", "Vendor/Platform", "Team", "In House/Managed Service"]);

  // Only show rows if real names were extracted from transcript
  extracted.products.forEach((p, i) => {
    const rn = i + 2;
    ws.getRow(rn).height = 16;
    const altFill = i % 2 !== 0 ? CLR.LIGHT_FILL : CLR.WHITE;
    [p.name || "", "", p.vendor || "", "", p.managedService ? "Managed Service" : "In House"].forEach((val, j) => {
      const cell = ws.getCell(rn, j + 1);
      cell.value = val;
      cell.fill = sf(altFill);
      cell.font = { size: 10, name: "Calibri" };
      cell.alignment = { vertical: "middle" };
    });
  });
}

// ── Sheet: Users ──────────────────────────────────────────────────────────────

function addUsers(wb: ExcelJS.Workbook) {
  const ws = wb.addWorksheet("Users");
  [25, 30, 20, 20, 20, 15, 20, 12].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  addHeaderRow(ws, 1, ["User", "Email", "Business Unit", "Queue", "Data Profile", "Type", "AdFlo Role", "Status"]);
}

// ── Sheet: Governance ────────────────────────────────────────────────────────

function addGovernance(wb: ExcelJS.Workbook, estimatedHours: number) {
  const ws = wb.addWorksheet("Governance");
  [28, 20, 20, 20].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

  // Row 1: title
  ws.getRow(1).height = 22;
  ws.mergeCells("A1:D1");
  const a1 = ws.getCell("A1");
  a1.value = "Project Governance";
  a1.fill = sf(CLR.LIGHT_BLUE);
  a1.font = { bold: true, color: { argb: CLR.WHITE }, size: 12, name: "Calibri" };
  a1.alignment = { horizontal: "center", vertical: "middle" };

  // Row 2: Meeting Cadence section header
  ws.getRow(2).height = 16;
  ws.mergeCells("A2:D2");
  const a2 = ws.getCell("A2");
  a2.value = "Meeting Cadence";
  a2.fill = sf(CLR.DARK_GRAY);
  a2.font = { bold: true, color: { argb: CLR.WHITE }, size: 10, name: "Calibri" };

  // Row 3: column sub-headers
  ws.getRow(3).height = 16;
  ["Meeting Type", "Next Meeting", "Notes", ""].forEach((label, i) => {
    if (!label) return;
    const cell = ws.getCell(3, i + 1);
    cell.value = label;
    cell.fill = sf(CLR.DARK_GRAY);
    cell.font = { bold: true, color: { argb: CLR.WHITE }, size: 10, name: "Calibri" };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });

  // Rows 4–8: meeting rows
  ["Weekly Status", "Working Session", "Technical Call", "Steering Committee", "Launch Call"].forEach((name, i) => {
    const rn = 4 + i;
    ws.getRow(rn).height = 16;
    ws.getCell(rn, 1).value = name;
    for (let col = 1; col <= 4; col++) {
      ws.getCell(rn, col).fill = sf(CLR.GRAY_ROW);
      ws.getCell(rn, col).font = { size: 10, name: "Calibri" };
    }
  });

  // Row 9: spacer
  ws.getRow(9).height = 8;

  // Row 10: Contracted Hours section header
  ws.getRow(10).height = 16;
  ws.mergeCells("A10:D10");
  const a10 = ws.getCell("A10");
  a10.value = "Contracted Hours Tracker";
  a10.fill = sf(CLR.DARK_GRAY);
  a10.font = { bold: true, color: { argb: CLR.WHITE }, size: 10, name: "Calibri" };

  // Row 11: column headers
  ws.getRow(11).height = 16;
  ["Phase", "Contracted Hours", "Hours Used", "Hours Remaining"].forEach((label, i) => {
    const cell = ws.getCell(11, i + 1);
    cell.value = label;
    cell.fill = sf(CLR.DARK_GRAY);
    cell.font = { bold: true, color: { argb: CLR.WHITE }, size: 10, name: "Calibri" };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });

  // Phase rows 12–15
  const total = estimatedHours || 0;
  const disc  = total > 0 ? Math.round(total * 0.15) : 0;
  const train = total > 0 ? Math.round(total * 0.15) : 0;
  const test  = total > 0 ? Math.round(total * 0.15) : 0;
  const conf  = total > 0 ? total - disc - train - test : 0;

  const phaseData: Array<[string, number]> = [
    ["Discovery", disc], ["Configuration", conf], ["Training", train], ["Testing", test],
  ];
  phaseData.forEach(([name, hrs], i) => {
    const rn = 12 + i;
    ws.getRow(rn).height = 16;
    const altFill = i % 2 === 0 ? CLR.WHITE : CLR.LIGHT_FILL;

    ws.getCell(rn, 1).value = name;
    ws.getCell(rn, 1).fill = sf(altFill);
    ws.getCell(rn, 1).font = { size: 10, name: "Calibri" };

    ws.getCell(rn, 2).value = total > 0 ? hrs : "";
    ws.getCell(rn, 2).fill = sf(CLR.VERY_LIGHT);
    ws.getCell(rn, 2).font = { size: 10, name: "Calibri" };
    ws.getCell(rn, 2).alignment = { horizontal: "right" };

    for (let col = 3; col <= 4; col++) {
      ws.getCell(rn, col).fill = sf(CLR.VERY_LIGHT);
    }
  });

  // Row 16: Total (bold, SUM formula)
  ws.getRow(16).height = 16;
  ws.getCell(16, 1).value = "Total";
  ws.getCell(16, 1).font = { bold: true, size: 10, name: "Calibri" };
  if (total > 0) {
    ws.getCell(16, 2).value = { formula: "SUM(B12:B15)", result: total };
  }
  ws.getCell(16, 2).font = { bold: true, size: 10, name: "Calibri" };
  ws.getCell(16, 2).alignment = { horizontal: "right" };
}

// ── Sheet: Queue Names ────────────────────────────────────────────────────────

function addQueueNames(wb: ExcelJS.Workbook, extracted: ExtractedData) {
  const ws = wb.addWorksheet("Queue Names");
  [30, 50].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  addHeaderRow(ws, 1, ["Queue Name", "Description / Notes"]);

  extracted.queues.forEach((q, i) => {
    const rn = i + 2;
    ws.getRow(rn).height = 16;
    const altFill = i % 2 !== 0 ? CLR.LIGHT_FILL : CLR.WHITE;
    [q.name || "", q.notes || ""].forEach((val, j) => {
      const cell = ws.getCell(rn, j + 1);
      cell.value = val;
      cell.fill = sf(altFill);
      cell.font = { size: 10, name: "Calibri" };
      cell.alignment = { vertical: "middle", wrapText: j === 1 };
    });
  });
}

// ── Workbook builder ──────────────────────────────────────────────────────────

async function buildWorkbook(extracted: ExtractedData, estimatedHours: number, assignedIMs: AssignedIM[] = []): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "AdFlo";
  wb.created = new Date();

  addProjectSchedule(wb, extracted);
  addStakeholderRegister(wb, extracted, assignedIMs);
  addMasterProductList(wb, extracted);
  addUsers(wb);
  addGovernance(wb, estimatedHours);
  addQueueNames(wb, extracted);

  addBlankSheet(wb, "Order Form",     ["Order Name", "Advertiser", "Agency", "Market", "Product", "Salesperson", "Start Date", "End Date", "Rate", "Budget", "Notes"]);
  addBlankSheet(wb, "Product Form",   ["Product Name", "Product Type", "Vendor", "Channel", "Configuration Notes", "Status"]);
  addBlankSheet(wb, "Task Forms",     ["Task Name", "Phase", "Assigned To", "Due Date", "Priority", "Status", "Notes"]);
  addBlankSheet(wb, "Order Tasks",    ["Task Name", "Order", "Assigned To", "Due Date", "Status", "Notes"]);
  addBlankSheet(wb, "Product Tasks",  ["Task Name", "Product", "Assigned To", "Due Date", "Status", "Notes"]);
  addBlankSheet(wb, "Workflow Steps", ["Step #", "Phase", "Step Name", "Description", "Owner", "Trigger", "Outcome", "Notes"]);
  addBlankSheet(wb, "RAID Log",       ["ID", "Type", "Description", "Impact", "Probability", "Status", "Owner", "Due Date", "Resolution Date", "Notes"]);
  addBlankSheet(wb, "Change Log",     ["ID", "Date Raised", "Description", "Requested By", "Impact", "Approved By", "Approval Date", "Status", "Notes"]);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ── Data extraction ───────────────────────────────────────────────────────────

async function buildExtractedData(
  session: {
    client_name: string;
    primary_contact: string | null;
    answers: Record<string, string>;
    transcript: unknown;
    notes: string | null;
    estimated_hours: number;
  },
  questions: DbQuestion[]
): Promise<ExtractedData> {
  const bySort = (n: number) => questions.find((q) => q.sort_order === n);
  const ans = (session.answers || {}) as Record<string, string>;
  const getAns = (sort: number): string => { const q = bySort(sort); return q ? (ans[String(q.id)] || "") : ""; };
  const yes = (sort: number) => getAns(sort) === "Yes";
  const num = (sort: number) => parseInt(getAns(sort) || "0", 10) || 0;

  // Parse "Name <email>" primary contact format
  const pcStr = session.primary_contact || "";
  const pcEmailMatch = pcStr.match(/^(.+?)\s*<(.+?)>$/);
  const primaryContact = {
    name: pcEmailMatch ? pcEmailMatch[1].trim() : pcStr.trim(),
    email: pcEmailMatch ? pcEmailMatch[2].trim() : "",
    title: "",
  };

  const goLiveDate = getAns(27) || null;

  // Products: real names extracted from transcript only — no placeholders
  const products: ExtractedData["products"] = [];

  // Integrations
  const integrations: string[] = [];
  if (yes(7))  integrations.push("CRM");
  if (yes(8))  integrations.push("Proposal/Quoting Tool");
  if (yes(9))  integrations.push("Billing/Finance System");
  if (yes(10)) integrations.push("External API/Webhook");
  if (yes(11)) integrations.push("Bi-directional Sync");
  const connCount = num(12);
  if (connCount > 0) integrations.push(`Push Connectors (${connCount})`);

  const base: ExtractedData = {
    clientName: session.client_name || "Client",
    primaryContact,
    stakeholders: [],
    products,
    queues: [],
    users: { count: yes(28) ? 25 : 10, roles: [] },
    integrations,
    goLiveDate,
    businessUnits: yes(17) ? ["Multiple business units"] : [],
    orderApprovalFlow: yes(3) ? "Multi-step approval workflow" : "",
    workflowNotes: session.notes || "",
  };

  // Enrich from transcript if available
  const transcript = session.transcript as Array<{ role: string; content: string }> | null;
  if (Array.isArray(transcript) && transcript.length > 0 && process.env.ANTHROPIC_API_KEY) {
    try {
      const transcriptText = transcript
        .map((m) => `${m.role === "user" ? "Client" : "Advisor"}: ${m.content}`)
        .join("\n\n");

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1200,
          system: "Extract structured data from this transcript. Return strict JSON only — no markdown.",
          messages: [{
            role: "user",
            content: `Extract from this transcript:

TRANSCRIPT:
${transcriptText}

Return JSON:
{
  "stakeholders": [{"name":"","email":"","title":"","company":"","role":"","type":"C"}],
  "products": [{"name":"","channel":"","vendor":"","managedService":false}],
  "queues": [{"name":"","notes":""}]
}`,
          }],
        }),
      });

      if (res.ok) {
        const data = await res.json();
        let raw: string = (data.content?.[0]?.text ?? "{}") as string;
        raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
        const enriched = JSON.parse(raw) as Partial<Pick<ExtractedData, "stakeholders" | "products" | "queues">>;
        if (enriched.stakeholders?.length) base.stakeholders = enriched.stakeholders;
        if (enriched.products?.length)     base.products     = enriched.products;
        if (enriched.queues?.length)       base.queues       = enriched.queues;
      }
    } catch {
      // Fall through with answer-derived data
    }
  }

  return base;
}

const WORKBOOK_PATH = (projectId: string) => `${projectId}/workbook.xlsx`;

// ── GET — existence check (?check=true) or file download ─────────────────────

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const { data: project } = await supabaseServer
    .from("implementation_projects")
    .select("session_id")
    .eq("id", id)
    .single();

  let clientName = "Client";
  if (project?.session_id) {
    const { data: session } = await supabaseServer
      .from("sessions")
      .select("client_name")
      .eq("id", project.session_id)
      .single();
    if (session?.client_name) clientName = session.client_name;
  }
  const filename = `${clientName.replace(/\s+/g, "_")}_AdFlo_Workbook.xlsx`;

  if (req.nextUrl.searchParams.get("check") === "true") {
    const { data: signed } = await supabaseServer.storage
      .from("workbooks")
      .createSignedUrl(WORKBOOK_PATH(id), 60);
    if (!signed?.signedUrl) return NextResponse.json({ exists: false });
    return NextResponse.json({ exists: true, filename });
  }

  const { data, error } = await supabaseServer.storage
    .from("workbooks")
    .download(WORKBOOK_PATH(id));
  if (error || !data) return new NextResponse(null, { status: 404 });

  const buffer = Buffer.from(await data.arrayBuffer());
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

// ── POST — generate workbook ──────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await context.params;
  const body = await req.json().catch(() => ({})) as { assignedIMs?: AssignedIM[] };
  const assignedIMs: AssignedIM[] = body.assignedIMs ?? [];
  console.log("[workbook POST] request body:", JSON.stringify(body));

  // Fetch project → session_id + persisted team assignments
  const { data: project } = await supabaseServer
    .from("implementation_projects")
    .select("session_id, team_assignments")
    .eq("id", projectId)
    .single();
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  console.log("[workbook POST] project.team_assignments:", JSON.stringify((project as { team_assignments?: unknown }).team_assignments));

  // Merge IMs: request body takes precedence (may be ahead of debounced DB save)
  const dbIMs: AssignedIM[] = Array.isArray((project as { team_assignments?: AssignedIM[] }).team_assignments)
    ? (project as { team_assignments: AssignedIM[] }).team_assignments
    : [];
  const mergedIMs: AssignedIM[] = assignedIMs.length > 0 ? assignedIMs : dbIMs;
  console.log("[workbook POST] mergedIMs (used for workbook):", JSON.stringify(mergedIMs));

  // Fetch session
  const { data: session } = await supabaseServer
    .from("sessions")
    .select("client_name, primary_contact, answers, transcript, notes, estimated_hours")
    .eq("id", project.session_id)
    .single();
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  // Fetch active questions for answer mapping
  const { data: questionsData } = await supabaseServer
    .from("questions")
    .select("id, sort_order, question_type")
    .eq("active", true)
    .order("sort_order");
  const questions = (questionsData ?? []) as DbQuestion[];

  // Build extracted data (enriched from transcript if available)
  const extracted = await buildExtractedData(
    session as {
      client_name: string;
      primary_contact: string | null;
      answers: Record<string, string>;
      transcript: unknown;
      notes: string | null;
      estimated_hours: number;
    },
    questions
  );

  // Build workbook buffer
  const buffer = await buildWorkbook(extracted, session.estimated_hours as number, mergedIMs);

  // Upload to storage
  await supabaseServer.storage.createBucket("workbooks", { public: false }).catch(() => {});

  const { error: uploadError } = await supabaseServer.storage
    .from("workbooks")
    .upload(WORKBOOK_PATH(projectId), buffer, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: true,
    });

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 });
  }

  const clientName = (session.client_name as string) || "Client";
  const date = new Date().toISOString().split("T")[0];
  const filename = `${clientName.replace(/\s+/g, "_")}_AdFlo_Workbook_${date}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
