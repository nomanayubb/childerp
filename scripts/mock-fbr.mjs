// A stand-in for the FBR DI gateway, for local testing ONLY.
// Follows the request/response shapes in docs/fbr/DI-API-v1.12.pdf. The error
// codes below are made up for the mock; the real gateway's rules are stricter.
import http from "node:http";

export const MOCK_TOKEN = "MOCK-TOKEN-1234567890";
let last = null;
let seq = 0;

const digits = (v) => String(v ?? "").replace(/[^0-9]/g, "");

function validate(p, sandbox) {
  const errs = [];
  const need = (k) => { if (p[k] === undefined || p[k] === null || p[k] === "") errs.push(["0001", `Missing ${k}`]); };
  ["invoiceType", "invoiceDate", "sellerNTNCNIC", "sellerBusinessName", "sellerProvince", "sellerAddress", "buyerProvince", "buyerAddress", "buyerRegistrationType"].forEach(need);
  if (![7, 13].includes(digits(p.sellerNTNCNIC).length)) errs.push(["0401", "Seller NTN/CNIC must be 7 or 13 digits"]);
  if (p.buyerRegistrationType === "Registered" && ![7, 9, 13].includes(digits(p.buyerNTNCNIC).length)) errs.push(["0002", "Invalid Buyer Registration No or NTN"]);
  if (sandbox && !p.scenarioId) errs.push(["0200", "scenarioId is required in sandbox"]);
  if (!Array.isArray(p.items) || !p.items.length) errs.push(["0010", "No items"]);
  const itemErrs = (p.items ?? []).map((it, i) => {
    const e = [];
    if (!/^\d{4}\.\d{4}$/.test(String(it.hsCode ?? ""))) e.push(["0052", "Provide proper HS Code"]);
    if (!/^\d+(\.\d+)?%$/.test(String(it.rate ?? ""))) e.push(["0046", "Provide rate."]);
    else {
      const rate = parseFloat(it.rate);
      const expect = Math.round(Number(it.valueSalesExcludingST) * rate) / 100;
      if (Math.abs(expect - Number(it.salesTaxApplicable)) > 0.011) e.push(["0300", "The calculated percentage sales tax does not match."]);
    }
    if (Math.abs(Number(it.valueSalesExcludingST) + Number(it.salesTaxApplicable) - Number(it.totalValues)) > 0.011) e.push(["0401", "Total value does not equal value + tax."]);
    if (!it.uoM) e.push(["0099", "Provide UoM"]);
    return { itemSNo: String(i + 1), e };
  });
  return { errs, itemErrs };
}

export function startMock(port = 4010) {
  const server = http.createServer((req, res) => {
    const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (req.headers.authorization !== `Bearer ${MOCK_TOKEN}`) return send(401, { message: "Unauthorized" });
    const url = new URL(req.url, "http://x");
    if (req.method === "GET" && url.pathname === "/pdi/v1/provinces") {
      return send(200, [{ stateProvinceCode: 7, stateProvinceDesc: "PUNJAB" }, { stateProvinceCode: 8, stateProvinceDesc: "SINDH" }]);
    }
    if (req.method === "GET" && url.pathname === "/__last") return send(200, last ?? {});
    const m = url.pathname.match(/^\/di_data\/v1\/di\/(post|validate)invoicedata(_sb)?$/);
    if (req.method === "POST" && m) {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        let p;
        try { p = JSON.parse(body); } catch { return send(400, { message: "bad json" }); }
        last = p;
        const dated = new Date().toISOString().replace("T", " ").slice(0, 19);
        const { errs, itemErrs } = validate(p, !!m[2]);
        if (errs.length) {
          return send(200, { dated, validationResponse: { statusCode: "01", status: "Invalid", errorCode: errs[0][0], error: errs.map((e) => e[1]).join("; "), invoiceStatuses: null } });
        }
        if (itemErrs.some((x) => x.e.length)) {
          return send(200, {
            dated,
            validationResponse: {
              statusCode: "00", status: "invalid", error: "",
              invoiceStatuses: itemErrs.map((x) => x.e.length
                ? { itemSNo: x.itemSNo, statusCode: "01", status: "Invalid", invoiceNo: null, errorCode: x.e[0][0], error: x.e.map((e) => e[1]).join("; ") }
                : { itemSNo: x.itemSNo, statusCode: "00", status: "Valid", invoiceNo: null, errorCode: "", error: "" }),
            },
          });
        }
        const irn = `${digits(p.sellerNTNCNIC).padStart(7, "0")}DI${Date.now()}${seq++ % 10}`;
        const ok = {
          statusCode: "00", status: "Valid", error: "",
          invoiceStatuses: p.items.map((_, i) => ({ itemSNo: String(i + 1), statusCode: "00", status: "Valid", invoiceNo: `${irn}-${i + 1}`, errorCode: "", error: "" })),
        };
        return send(200, m[1] === "post" ? { invoiceNumber: irn, dated, validationResponse: ok } : { dated, validationResponse: ok });
      });
      return;
    }
    send(404, { message: "not found" });
  });
  server.listen(port, "127.0.0.1");
  return server;
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) {
  startMock(Number(process.env.PORT) || 4010);
  console.log(`Mock FBR gateway on http://127.0.0.1:${process.env.PORT || 4010} (token ${MOCK_TOKEN})`);
}
