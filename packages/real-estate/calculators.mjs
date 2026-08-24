/**
 * UAE property calculators — move-in cost, etc.
 */

export function computeMoveInCost({
  annualRent = 0,
  agencyFeePercent = 5,
  depositMonths = 1,
  ejariFee = 220,
  dewaDeposit = 2000,
  includeChiller = false,
  chillerDeposit = 2000
} = {}) {
  const rent = Math.max(Number(annualRent) || 0, 0);
  const agencyPct = Math.max(Number(agencyFeePercent) || 5, 0);
  const depMonths = Math.max(Number(depositMonths) || 1, 0);

  const securityDeposit = Math.round((rent / 12) * depMonths);
  const agencyFee = Math.round(rent * (agencyPct / 100));
  const firstCheque = rent;
  const dewa = Math.max(Number(dewaDeposit) || 0, 0);
  const ejari = Math.max(Number(ejariFee) || 0, 0);
  const chiller = includeChiller ? Math.max(Number(chillerDeposit) || 0, 0) : 0;

  const total = securityDeposit + agencyFee + firstCheque + dewa + ejari + chiller;

  return {
    annualRent: rent,
    securityDeposit,
    agencyFee,
    agencyFeePercent: agencyPct,
    firstCheque,
    ejariFee: ejari,
    dewaDeposit: dewa,
    chillerDeposit: chiller,
    total,
    lines: [
      { label: "First year's rent (1 cheque)", amount: firstCheque },
      { label: `Security deposit (${depMonths} month${depMonths === 1 ? "" : "s"})`, amount: securityDeposit },
      { label: `Agency fee (${agencyPct}%)`, amount: agencyFee },
      { label: "Ejari registration (est.)", amount: ejari },
      { label: "DEWA deposit (est.)", amount: dewa },
      ...(chiller ? [{ label: "Chiller/district cooling deposit (est.)", amount: chiller }] : [])
    ]
  };
}

export function parseMoveInCalculatorInput(text = "") {
  const lower = String(text || "").toLowerCase();
  const rentK = lower.match(/(\d{2,3})\s*k\b/);
  const rentAed = lower.match(/aed\s*([\d,]+)/i) || lower.match(/([\d,]+)\s*aed/i);
  const plainNum = lower.match(/\b(\d{4,6})\b/);

  let annualRent = 0;
  if (rentK) annualRent = Number(rentK[1]) * 1000;
  else if (rentAed) annualRent = Number(rentAed[1].replace(/,/g, ""));
  else if (plainNum) annualRent = Number(plainNum[1]);

  return {
    annualRent,
    includeChiller: /chiller|district cooling|cooling/.test(lower),
    depositMonths: /2\s*month.*deposit|two month.*deposit/.test(lower) ? 2 : 1
  };
}

export function formatMoveInCostWhatsApp(calc) {
  if (!calc?.total) return "Tell me the annual rent in AED (e.g. 120k or AED 120,000) and I'll break down move-in costs.";
  const lines = calc.lines.map((l) => `• ${l.label}: AED ${l.amount.toLocaleString()}`);
  return [
    `Move-in cost estimate (AED ${calc.annualRent.toLocaleString()}/yr rent):`,
    "",
    ...lines,
    "",
    `Total upfront (est.): AED ${calc.total.toLocaleString()}`,
    "",
    "Note: Ejari, DEWA and chiller vary by building. Agency fee is often 5% of annual rent."
  ].join("\n");
}

export function formatMoveInCostBlock(calc) {
  if (!calc?.total) return "";
  return [
    "MOVE-IN CALCULATOR:",
    ...calc.lines.map((l) => `- ${l.label}: AED ${l.amount.toLocaleString()}`),
    `- TOTAL UPFRONT (est.): AED ${calc.total.toLocaleString()}`
  ].join("\n");
}

export function userWantsMoveInCalculator(text = "") {
  const lower = String(text || "").toLowerCase();
  return /move[\s-]?in cost|upfront cost|total cost to move|how much to move in|calculator|cheques? needed|deposit.*agency|ejari.*dewa/.test(
    lower
  );
}
