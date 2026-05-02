import { Settings } from "../../shared/types";
import { sendToBackground } from "../../shared/messages";
import { sliceFirstJSONObject } from "../../background/ai/router";
import { setReactInput } from "../utils/dom";

interface FieldInfo {
  element: HTMLInputElement | HTMLTextAreaElement;
  label: string;
  index: number;
}

export async function runFormFiller(
  settings: Settings,
  onStatus: (msg: string) => void
): Promise<void> {
  onStatus("Detecting form fields…");

  const fields = detectFields();
  if (fields.length === 0) {
    onStatus("No fillable fields found on this page.");
    return;
  }

  onStatus(`Asking AI to fill ${fields.length} field(s)…`);

  const context = document.title + "\n" + document.body.innerText.slice(0, 2000);
  const answers = await generateFieldAnswers(fields, context);

  onStatus("Filling fields…");
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    const answer = answers[i] ?? "";
    setReactInput(field.element, answer);
    await delay(settings.delayMs / 4);
  }

  if (settings.autoSubmit) {
    onStatus("Submitting…");
    await submitForm();
    await delay(settings.delayMs);
  }

  onStatus("Done.");
}

function detectFields(): FieldInfo[] {
  const fields: FieldInfo[] = [];

  const inputs = Array.from(
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
      'input[type="text"], input[type="email"], textarea'
    )
  ).filter((el) => {
    if (el.disabled || el.readOnly) return false;
    // Skip hidden fields and search/nav inputs
    const role = el.getAttribute("role");
    if (role === "search" || role === "combobox") return false;
    const type = (el as HTMLInputElement).type;
    if (type === "search") return false;
    return true;
  });

  inputs.forEach((el, index) => {
    const label = getLabelText(el) ?? el.placeholder ?? el.getAttribute("aria-label") ?? `Field ${index + 1}`;
    fields.push({ element: el, label, index });
  });

  return fields;
}

function getLabelText(el: HTMLElement): string | null {
  // Explicit label
  const id = el.getAttribute("id");
  if (id) {
    const label = document.querySelector<HTMLElement>(`label[for="${id}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }
  // Wrapping label
  const parent = el.closest("label");
  if (parent?.textContent?.trim()) return parent.textContent.trim();
  // aria-labelledby
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const ref = document.getElementById(labelledBy);
    if (ref?.textContent?.trim()) return ref.textContent.trim();
  }
  return null;
}

async function generateFieldAnswers(
  fields: FieldInfo[],
  context: string
): Promise<string[]> {
  const fieldDescriptions = fields.map((f, i) => `${i}: "${f.label}"`).join("\n");
  const prompt = `You are helping fill out a form on an educational platform.
Context from the page:
${context}

Fields to fill (index: label):
${fieldDescriptions}

Return a JSON object with an "answers" array where each item is the text answer for the corresponding field (by index).
Keep answers concise, relevant, and educational.`;

  const response = await sendToBackground<{
    type: string;
    payload: { text?: string; error?: string };
  }>({
    type: "AI_REQUEST",
    payload: { prompt, jsonObjectResponse: true },
  });

  if (response.type === "AI_ERROR") {
    throw new Error(response.payload.error ?? "AI error");
  }

  const raw = response.payload.text ?? "";
  const slice = sliceFirstJSONObject(raw);
  if (!slice) {
    throw new Error(
      `AI form fill reply was not JSON. Start: "${raw.slice(0, 100).replace(/\s+/g, " ")}"`
    );
  }
  try {
    const parsed = JSON.parse(slice) as { answers: string[] };
    return parsed.answers;
  } catch (e) {
    throw new Error(
      `AI form fill JSON parse failed: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

async function submitForm(): Promise<void> {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
  const submit = buttons.find(
    (b) =>
      (b.textContent?.toLowerCase().includes("submit") ||
        b.textContent?.toLowerCase().includes("save")) &&
      !b.disabled
  );
  submit?.click();
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
