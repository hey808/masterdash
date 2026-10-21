/**
 * The agreement as a PDF (pdf-lib, standard fonts: no files read at runtime).
 * Page 1: header, parties, equipment & totals, details, notes.
 * Then: terms in two columns, acknowledgement, signatures, signing record.
 */
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { SHIELD_PNG_BASE64 } from "./brand-logo";
import { ACKNOWLEDGEMENT, COMPANY, MAINTENANCE_PLAN, SOAP_PACKAGES, TERMS } from "./agreement-terms";
import { balanceAtInstall, customerName, fullAddress, type Agreement } from "./agreements";

const W = 612;
const H = 792;
const M = 48; // margin
const NAVY = rgb(0.02, 0.17, 0.44);
const BLUE = rgb(0.03, 0.49, 0.99);
const INK = rgb(0.11, 0.14, 0.2);
const MUTED = rgb(0.42, 0.47, 0.56);
const LINE = rgb(0.86, 0.89, 0.94);
const GREEN = rgb(0.07, 0.5, 0.31);

const money = (c: number) => (c / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const longDate = (d: string) => new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: d.length === 10 ? "UTC" : "America/New_York" });
const dateTime = (d: string) =>
  new Date(d).toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" });
const METHOD: Record<string, string> = { check: "Check", card: "Card", cash: "Cash", other: "Other" };

export async function agreementPdf(a: Agreement): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Customer Agreement ${a.number}`);
  doc.setAuthor(COMPANY.name);
  doc.setSubject(customerName(a));
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const serif = await doc.embedFont(StandardFonts.TimesRomanBold);
  const logo = await doc.embedPng(Buffer.from(SHIELD_PNG_BASE64, "base64"));

  // Standard fonts only carry WinAnsi; swap anything else for a close character.
  const okChar = new Map<string, boolean>();
  const safe = (s: string) =>
    [...s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/–/g, "-")]
      .map((ch) => {
        if (!okChar.has(ch)) {
          try {
            reg.encodeText(ch);
            okChar.set(ch, true);
          } catch {
            okChar.set(ch, false);
          }
        }
        return okChar.get(ch) ? ch : "?";
      })
      .join("");
  const wrap = (s: string, font: PDFFont, size: number, width: number): string[] => {
    const out: string[] = [];
    for (const para of s.split("\n").map(safe)) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const tryLine = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(tryLine, size) <= width) line = tryLine;
        else {
          if (line) out.push(line);
          line = word;
        }
      }
      out.push(line);
    }
    return out;
  };

  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;
  const pages: PDFPage[] = [page];
  const newPage = () => {
    page = doc.addPage([W, H]);
    pages.push(page);
    y = H - M;
  };
  const ensure = (h: number) => {
    if (y - h < M + 30) newPage();
  };
  const t = (s: string, x: number, yy: number, o: { font?: PDFFont; size?: number; color?: RGB; right?: boolean } = {}) => {
    const font = o.font ?? reg;
    const size = o.size ?? 9.5;
    const str = safe(s);
    const xx = o.right ? x - font.widthOfTextAtSize(str, size) : x;
    page.drawText(str, { x: xx, y: yy, font, size, color: o.color ?? INK });
  };
  const rule = (yy: number, color = LINE, x1 = M, x2 = W - M, th = 0.8) => page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: th, color });
  let sectionNo = 0;
  const section = (title: string) => {
    ensure(40);
    sectionNo++;
    y -= 14;
    t(String(sectionNo), M, y, { font: bold, size: 10, color: BLUE });
    t(title, M + 16, y, { font: bold, size: 10.5, color: NAVY });
    y -= 7;
    rule(y);
    y -= 14;
  };
  const label = (s: string, x: number, yy: number) => t(s.toUpperCase(), x, yy, { font: bold, size: 6.8, color: MUTED });
  /** A label/value pair at x, wrapping in width; returns the height used. */
  const field = (lab: string, value: string, x: number, yy: number, width: number) => {
    label(lab, x, yy);
    const lines = wrap(value || "—", reg, 9.5, width);
    lines.forEach((ln, i) => t(ln, x, yy - 12 - i * 12));
    return 14 + lines.length * 12;
  };

  // ── Header
  page.drawImage(logo, { x: M, y: y - 34, width: 33, height: 34 });
  t(COMPANY.name, M + 44, y - 12, { font: bold, size: 13, color: NAVY });
  t(`${COMPANY.address}  ·  ${COMPANY.phone}`, M + 44, y - 25, { size: 7.5, color: MUTED });
  t(`${COMPANY.email}  ·  ${COMPANY.web}`, M + 44, y - 35, { size: 7.5, color: MUTED });
  t("Customer Agreement", W - M, y - 10, { font: serif, size: 19, color: NAVY, right: true });
  const meta: Array<[string, string]> = [
    ["Agreement No.", a.number],
    ["Date", longDate(a.createdAt)],
    [a.status === "signed" ? "Executed" : "Status", a.status === "signed" && a.signedAt ? dateTime(a.signedAt) : a.status === "void" ? "Cancelled" : "Awaiting signature"],
  ];
  meta.forEach(([k, v], i) => {
    t(k, W - M - 150, y - 26 - i * 11, { size: 7.5, color: MUTED });
    t(v, W - M, y - 26 - i * 11, { font: bold, size: 7.5, right: true, color: a.status === "void" && k === "Status" ? rgb(0.8, 0.1, 0.15) : INK });
  });
  y -= 66;
  rule(y, BLUE, M, W - M, 1.4);
  y -= 6;

  const colW = (W - 2 * M - 24) / 2;
  const x2 = M + colW + 24;

  // ── 1 Parties
  section("Parties");
  {
    const top = y;
    let l = top;
    l -= field("Customer", customerName(a), M, l, colW);
    l -= field("Service address", fullAddress(a), M, l, colW);
    let r = top;
    r -= field("Phone", [a.phone, a.phone2].filter(Boolean).join("  ·  "), x2, r, colW);
    r -= field("Email", a.email ?? "", x2, r, colW);
    r -= field("Representative", a.repName ?? "", x2, r, colW);
    y = Math.min(l, r) - 4;
  }

  // ── 2 Equipment & services
  section("Equipment & services");
  label("Description", M, y);
  label("Amount", W - M - 30, y);
  y -= 6;
  rule(y, INK, M, W - M, 0.6);
  y -= 15;
  const lineItem = (desc: string, amount: string, sub?: string) => {
    ensure(30);
    t(desc, M, y, { font: bold, size: 9.5 });
    t(amount, W - M, y, { right: true });
    if (sub) {
      y -= 11;
      t(sub, M, y, { size: 7.5, color: MUTED });
    }
    y -= 8;
    rule(y);
    y -= 15;
  };
  for (const e of a.equipment.length ? a.equipment : a.systems) lineItem(e, "Included");
  if (a.soapPackage !== "none") lineItem(`Soap package: ${SOAP_PACKAGES[a.soapPackage]}`, "Included");
  if (a.maintenancePlan) lineItem(MAINTENANCE_PLAN.name, `${money(MAINTENANCE_PLAN.priceCents)} / year`, MAINTENANCE_PLAN.detail);
  {
    const tx0 = W - M - 250;
    ensure(80);
    t("Total contract price", tx0, y, { font: bold, size: 10.5 });
    t(money(a.priceCents), W - M, y, { font: bold, size: 10.5, right: true });
    y -= 8;
    rule(y, INK, tx0, W - M, 0.6);
    y -= 14;
    if (a.financedCents > 0) {
      t(`Financed${a.lender ? ` (${a.lender})` : ""}`, tx0, y, { size: 8.5, color: MUTED });
      t(money(a.financedCents), W - M, y, { size: 8.5, right: true });
      y -= 14;
    }
    if (a.depositCents > 0) {
      const lab = `Down payment (${METHOD[a.depositMethod ?? ""] ?? "Paid"})`;
      t(lab, tx0, y, { size: 8.5, color: MUTED });
      t("RECEIVED", tx0 + reg.widthOfTextAtSize(lab, 8.5) + 6, y, { font: bold, size: 6.5, color: GREEN });
      t(money(a.depositCents), W - M, y, { size: 8.5, right: true });
      y -= 14;
    }
    t("Balance due at installation", tx0, y, { size: 8.5, color: MUTED });
    t(money(balanceAtInstall(a)), W - M, y, { size: 8.5, right: true });
    y -= 10;
  }

  // ── 3 Details
  section("Details");
  {
    const top = y;
    let l = top;
    l -= field("System", (a.systems.length ? a.systems : a.equipment).join(", "), M, l, colW);
    l -= field("Soap package", a.soapPackage === "none" ? "None" : SOAP_PACKAGES[a.soapPackage], M, l, colW);
    let r = top;
    r -= field("Hardness test result", a.hardness ?? "", x2, r, colW);
    r -= field("Installation date", a.installDate ? longDate(a.installDate) : "To be scheduled", x2, r, colW);
    y = Math.min(l, r) - 4;
  }

  // ── 4 Notes
  if (a.notes || a.installerNotes) {
    section("Notes");
    const body = [a.notes, a.installerNotes ? `Installer notes:\n${a.installerNotes}` : null].filter(Boolean).join("\n\n");
    const lines = wrap(body, reg, 9, W - 2 * M - 20);
    ensure(lines.length * 12 + 20);
    const h = lines.length * 12 + 14;
    page.drawRectangle({ x: M, y: y - h + 10, width: W - 2 * M, height: h, borderColor: LINE, borderWidth: 0.8, color: rgb(0.98, 0.99, 1) });
    lines.forEach((ln, i) => t(ln, M + 10, y - 4 - i * 12, { size: 9, font: ln === "Installer notes:" ? bold : reg }));
    y -= h + 4;
  }

  // ── 5 Terms, two balanced columns
  newPage();
  section("Terms & conditions");
  {
    const cw = (W - 2 * M - 22) / 2;
    type Ln = { text: string; font: PDFFont; size: number; indent: number; num?: string; gap: number };
    const lines: Ln[] = [];
    for (const sec of TERMS) {
      lines.push({ text: sec.heading.toUpperCase(), font: bold, size: 7.5, indent: 0, gap: 12 });
      if (sec.intro) for (const ln of wrap(sec.intro, reg, 7.6, cw)) lines.push({ text: ln, font: reg, size: 7.6, indent: 0, gap: 10.6 });
      sec.items.forEach((it, i) => {
        const num = sec.items.length > 1 ? `${i + 1}.` : "";
        wrap(`${it.title ? `${it.title}. ` : ""}${it.text}`, reg, 7.6, cw - (num ? 12 : 0)).forEach((ln, j) =>
          lines.push({ text: ln, font: reg, size: 7.6, indent: num ? 12 : 0, num: j === 0 ? num : undefined, gap: 10.6 }),
        );
        lines[lines.length - 1]!.gap += 3;
      });
      lines[lines.length - 1]!.gap += 7;
    }
    let i = 0;
    while (i < lines.length) {
      const room = y - (M + 30);
      const rest = lines.slice(i).reduce((h, l) => h + l.gap, 0);
      // Balance the two columns when the rest fits on this page; otherwise fill both.
      const colCap = rest <= 2 * room ? Math.min(room, Math.ceil(rest / 2) + 12) : room;
      let lowest = y;
      for (const x of [M, M + cw + 22]) {
        let yy = y;
        while (i < lines.length && y - yy + lines[i]!.gap <= colCap + 0.01) {
          const l = lines[i]!;
          if (l.num) t(l.num, x, yy, { font: bold, size: l.size });
          t(l.text, x + l.indent, yy, { font: l.font, size: l.size });
          yy -= l.gap;
          i++;
        }
        lowest = Math.min(lowest, yy);
      }
      y = lowest - 6;
      if (i < lines.length) newPage();
    }
  }

  // ── 6 Acknowledgement & signatures
  ensure(190);
  section("Acknowledgement & signatures");
  for (const ln of wrap(ACKNOWLEDGEMENT, reg, 9, W - 2 * M)) {
    t(ln, M, y, { size: 9 });
    y -= 12;
  }
  y -= 26;
  const sigTop = y;
  if (a.signaturePng) {
    const img = await doc.embedPng(Buffer.from(a.signaturePng.split(",")[1]!, "base64"));
    const scale = Math.min(170 / img.width, 46 / img.height);
    page.drawImage(img, { x: M, y: sigTop - 6, width: img.width * scale, height: img.height * scale });
  } else {
    t(a.status === "void" ? "CANCELLED" : "Awaiting customer signature", M, sigTop + 8, { size: 9, color: MUTED });
  }
  rule(sigTop - 10, INK, M, M + colW, 0.6);
  t(a.signedName ?? customerName(a), M, sigTop - 24, { font: bold, size: 9.5 });
  t(a.signedAt ? `Customer · signed electronically ${dateTime(a.signedAt)}` : "Customer", M, sigTop - 36, { size: 7.5, color: MUTED });
  label("Prepared by", x2, sigTop + 4);
  rule(sigTop - 10, INK, x2, W - M, 0.6);
  t(a.repName ?? "", x2, sigTop - 24, { font: bold, size: 9.5 });
  t(COMPANY.name, x2, sigTop - 36, { size: 7.5, color: MUTED });
  y = sigTop - 62;
  const box = (s: string, x: number, cap: string) => {
    page.drawRectangle({ x, y: y - 6, width: 38, height: 20, borderColor: INK, borderWidth: 0.7 });
    t(s || " ", x + 19 - serif.widthOfTextAtSize(safe(s || " "), 11) / 2, y, { font: serif, size: 11 });
    t(cap, x + 46, y + 1, { size: 7.5, color: MUTED });
  };
  box(a.customerInitials ?? "", M, "Customer initials");
  box(a.repInitials ?? "", M + 150, "Representative initials");
  y -= 34;

  if (a.status === "signed") {
    ensure(70);
    label("Electronic signature record", M, y);
    y -= 12;
    const rec = [
      `Signed by ${a.signedName} on ${a.signedAt ? dateTime(a.signedAt) : ""} after agreeing to sign electronically.`,
      `IP address ${a.signedIp ?? "unknown"} · ${a.signedUserAgent ? a.signedUserAgent.slice(0, 110) : "unknown browser"}`,
      `Document fingerprint (SHA-256): ${a.signedHash ?? ""}`,
    ];
    for (const r of rec) for (const ln of wrap(r, reg, 7, W - 2 * M)) {
      t(ln, M, y, { size: 7, color: MUTED });
      y -= 10;
    }
  }

  // ── Footer on every page
  pages.forEach((p, i) => {
    page = p;
    rule(M - 10, LINE);
    t(`${COMPANY.name} · ${COMPANY.phone} · ${COMPANY.email}`, M, M - 22, { size: 6.8, color: MUTED });
    t(`Agreement No. ${a.number} · Page ${i + 1} of ${pages.length}`, W - M, M - 22, { size: 6.8, color: MUTED, right: true });
  });
  return doc.save();
}
