// Shared result shape and error mapping for server actions. Database errors are mapped by SQLSTATE; only our
// own validation messages (raised by our functions with 22023/23514) are shown. Nothing else from the database
// reaches the browser (no stack traces, no internal text).
export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
}

export const GENERIC_ERROR = "Something went wrong. Nothing was changed.";

export function dbErrorMessage(e: { code?: string; message?: string } | null | undefined): string {
  switch (e?.code) {
    case "42501":
      return "You are not allowed to do this.";
    case "P0002":
      return "Not found.";
    case "55000":
      return "This was already decided.";
    case "22023":
    case "23514":
      return e.message && e.message.length <= 200 ? e.message : GENERIC_ERROR;
    default:
      return GENERIC_ERROR;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function uuidField(form: FormData, name: string): string | null {
  const v = form.get(name);
  return typeof v === "string" && UUID.test(v) ? v : null;
}
export function textField(form: FormData, name: string, max: number): string {
  const v = form.get(name);
  return typeof v === "string" ? v.slice(0, max) : "";
}
