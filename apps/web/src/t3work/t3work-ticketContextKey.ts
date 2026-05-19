import type { ProjectTicket } from "~/t3work/t3work-types";

export function resolveTicketContextKey(ticket: Pick<ProjectTicket, "id" | "ref">): string {
  const displayId = ticket.ref.displayId.trim();
  if (displayId.length > 0) {
    return displayId;
  }
  const refId = ticket.ref.id.trim();
  if (refId.length > 0) {
    return refId;
  }
  return ticket.id;
}
