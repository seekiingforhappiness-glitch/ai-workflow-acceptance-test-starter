const testDefinitions = [
  { id: "happy_path", name: "Happy path", file: "test_01_happy_path.json", description: "The intended outcome completes and records evidence." },
  { id: "malformed_input", name: "Malformed input", file: "test_02_malformed_input.json", description: "Invalid input is rejected before a side effect occurs." },
  { id: "duplicate_event", name: "Duplicate event", file: "test_03_duplicate_event.json", description: "A retried event produces no duplicate side effect." },
  { id: "dependency_failure", name: "Dependency failure", file: "test_04_dependency_failure.json", description: "A failed dependency is recorded and never hidden." },
  { id: "missing_approval", name: "Missing approval", file: "test_05_missing_approval.json", description: "The workflow stops before its human approval point." },
  { id: "evidence_missing", name: "Evidence missing", file: "test_06_evidence_missing.json", description: "Completion is rejected when the evidence reference is absent." },
];

const examples = {
  "event-driven": {
    workflowName: "Customer support ticket triage",
    desiredOutcome: "Tickets are classified, prioritized, and routed to the correct team with evidence saved.",
    approvalPoint: "Approval is required before closing a high-priority ticket or when routing confidence is below 0.80.",
    sideEffect: "Create one audit record and send one requester notification.",
  },
  "document-review": {
    workflowName: "Invoice exception review",
    desiredOutcome: "Each invoice is matched to its purchase order or routed to a named review queue with evidence.",
    approvalPoint: "A person must approve any amount variance above USD 100 or missing purchase order.",
    sideEffect: "Update the review status once and append an immutable audit entry.",
  },
  "agent-api": {
    workflowName: "Research brief agent",
    desiredOutcome: "The agent returns a sourced brief that separates facts, inferences, and unresolved questions.",
    approvalPoint: "A person approves the brief before it is sent outside the workspace.",
    sideEffect: "Publish one approved brief and record its evidence references.",
  },
};

const form = document.querySelector("#contract-form");
const testList = document.querySelector("#test-list");
const suiteSummary = document.querySelector("#suite-summary");
const downloadButton = document.querySelector("#download-package");
const runLog = document.querySelector("#run-log");
const fileState = document.querySelector("#file-state");
let generatedPackage = null;

function renderTests() {
  testList.replaceChildren(...testDefinitions.map((test, index) => {
    const row = document.createElement("li");
    row.className = "test-row";
    row.innerHTML = `
      <span class="test-number">${index + 1}</span>
      <span class="test-name">${test.name}</span>
      <span class="test-description">${test.description}</span>
      <span class="test-file">${test.file}</span>`;
    return row;
  }));
}

function fieldValue(name) {
  return String(new FormData(form).get(name) || "").trim();
}

function contract() {
  return {
    schemaVersion: 1,
    workflowName: fieldValue("workflowName"),
    workflowType: fieldValue("workflowType"),
    desiredOutcome: fieldValue("desiredOutcome"),
    approvalPoint: fieldValue("approvalPoint"),
    sideEffect: fieldValue("sideEffect"),
  };
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function buildFiles(value) {
  const contractMarkdown = `# Workflow contract\n\n- Workflow: ${value.workflowName}\n- Type: ${value.workflowType}\n- Desired outcome: ${value.desiredOutcome}\n- Human approval point: ${value.approvalPoint}\n- Side effect: ${value.sideEffect}\n\n## Completion rule\n\nCompletion requires an observable outcome, an evidence reference, and no unapproved or duplicate side effect.\n`;
  const testsCsv = [
    ["id", "name", "pass_condition", "failure_condition", "evidence_required"],
    ...testDefinitions.map((test) => [
      test.id,
      test.name,
      test.description,
      `The workflow claims completion without satisfying ${test.name.toLowerCase()}.`,
      "run_id, observed outcome, evidence_ref, side_effect_count, approval state",
    ]),
  ].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
  const checklist = `# QA checklist\n\n- [ ] Representative input and malformed input are both tested.\n- [ ] Duplicate delivery creates no duplicate side effect.\n- [ ] Dependency failure is visible and recoverable.\n- [ ] The approval point blocks external or irreversible action.\n- [ ] Completion contains an evidence reference.\n- [ ] Logs contain no credentials or customer data.\n`;
  const manifest = JSON.stringify({
    schemaVersion: 1,
    generatedBy: "Acceptance Workbench",
    workflow: value.workflowName,
    fileCount: 4,
    privacyBoundary: "generated_locally_no_upload",
  }, null, 2) + "\n";
  return {
    "WORKFLOW-CONTRACT.md": contractMarkdown,
    "acceptance-tests.csv": testsCsv,
    "QA-CHECKLIST.md": checklist,
    "manifest.json": manifest,
  };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) {
  return new Uint8Array([value & 255, (value >>> 8) & 255]);
}

function u32(value) {
  return new Uint8Array([value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]);
}

function concat(chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function storedZip(files) {
  const encoder = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const filename = encoder.encode(name);
    const data = encoder.encode(content);
    const checksum = crc32(data);
    const local = concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(checksum), u32(data.length), u32(data.length), u16(filename.length), u16(0), filename, data,
    ]);
    locals.push(local);
    centrals.push(concat([
      u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0),
      u32(checksum), u32(data.length), u32(data.length), u16(filename.length), u16(0), u16(0),
      u16(0), u16(0), u32(0), u32(offset), filename,
    ]));
    offset += local.length;
  }
  const central = concat(centrals);
  return concat([
    ...locals,
    central,
    u32(0x06054b50), u16(0), u16(0), u16(centrals.length), u16(centrals.length),
    u32(central.length), u32(offset), u16(0),
  ]);
}

function loadContractExample() {
  const type = fieldValue("workflowType") || "event-driven";
  const value = examples[type];
  for (const [name, content] of Object.entries(value)) form.elements[name].value = content;
  generatePackage();
}

function generatePackage(event) {
  event?.preventDefault();
  if (!form.reportValidity()) return;
  const value = contract();
  generatedPackage = buildFiles(value);
  suiteSummary.textContent = `Four files generated for “${value.workflowName}”; six acceptance tests included.`;
  downloadButton.disabled = false;
}

function downloadPackage() {
  if (!generatedPackage) return;
  const bytes = storedZip(generatedPackage);
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "acceptance-workbench-package.zip";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const passingLog = {
  runId: "run_2026_07_19_001",
  workflowName: "Customer support ticket triage",
  status: "success",
  outcomeEvidence: "ticket_1842 routed to escalation_queue",
  validations: { malformedInputRejected: true, dependencyFailureRecorded: true },
  metrics: { duplicateSideEffects: 0 },
  approval: { required: true, granted: true },
  artifacts: ["audit_ticket_1842.json", "notification_ticket_1842.json"],
  evidenceRef: "evidence/run_2026_07_19_001.json",
};

function parseRunLog(raw) {
  const text = raw.trim();
  if (!text) throw new Error("Paste a run log or load the example first.");
  try { return JSON.parse(text); } catch (error) {
    const rows = text.split(/\r?\n/).filter(Boolean).map((row) => JSON.parse(row));
    if (!rows.length) throw error;
    return rows.at(-1);
  }
}

function state(provided, condition) {
  if (!provided) return "review";
  return condition ? "pass" : "fail";
}

function validateRunLog() {
  let log;
  try {
    log = parseRunLog(runLog.value);
    fileState.textContent = "Local parse complete; no network request was made.";
  } catch (error) {
    fileState.textContent = `Cannot parse: ${error.message}`;
    updateResults(testDefinitions.map((test) => ({ name: test.name, result: "review" })));
    return;
  }
  const checks = [
    { name: "Happy path", result: state("status" in log || "outcomeEvidence" in log, log.status === "success" && Boolean(log.outcomeEvidence)) },
    { name: "Malformed input", result: state(log.validations && "malformedInputRejected" in log.validations, log.validations?.malformedInputRejected === true) },
    { name: "Duplicate event", result: state(log.metrics && "duplicateSideEffects" in log.metrics, log.metrics?.duplicateSideEffects === 0) },
    { name: "Dependency failure", result: state(log.validations && "dependencyFailureRecorded" in log.validations, log.validations?.dependencyFailureRecorded === true) },
    { name: "Missing approval", result: state(log.approval && "granted" in log.approval, log.approval?.granted === true) },
    { name: "Evidence missing", result: state("artifacts" in log || "evidenceRef" in log, Array.isArray(log.artifacts) && log.artifacts.length > 0 && Boolean(log.evidenceRef)) },
  ];
  updateResults(checks);
}

function updateResults(checks) {
  const counts = { pass: 0, review: 0, fail: 0 };
  for (const check of checks) counts[check.result] += 1;
  document.querySelector("#pass-count").textContent = counts.pass;
  document.querySelector("#review-count").textContent = counts.review;
  document.querySelector("#fail-count").textContent = counts.fail;
  const details = document.querySelector("#validation-details");
  details.replaceChildren(...checks.map((check) => {
    const item = document.createElement("li");
    item.textContent = `${check.name}: ${check.result === "review" ? "needs evidence" : check.result}`;
    return item;
  }));
}

async function readDroppedFile(file) {
  if (!file) return;
  if (file.size > 512 * 1024) {
    fileState.textContent = "File rejected: maximum local file size is 512 KB.";
    return;
  }
  runLog.value = await file.text();
  fileState.textContent = `${file.name} loaded locally (${Math.ceil(file.size / 1024)} KB).`;
  validateRunLog();
}

form.addEventListener("submit", generatePackage);
document.querySelector("#load-example").addEventListener("click", loadContractExample);
document.querySelector("#workflow-type").addEventListener("change", loadContractExample);
downloadButton.addEventListener("click", downloadPackage);
document.querySelector("#load-run-log").addEventListener("click", () => { runLog.value = JSON.stringify(passingLog, null, 2); validateRunLog(); });
document.querySelector("#validate-log").addEventListener("click", validateRunLog);
runLog.addEventListener("dragover", (event) => { event.preventDefault(); runLog.classList.add("dragging"); });
runLog.addEventListener("dragleave", () => runLog.classList.remove("dragging"));
runLog.addEventListener("drop", (event) => {
  event.preventDefault();
  runLog.classList.remove("dragging");
  readDroppedFile(event.dataTransfer.files[0]);
});

renderTests();
loadContractExample();
runLog.value = JSON.stringify(passingLog, null, 2);
validateRunLog();
