export const REMINDER_TIMEZONE = "Asia/Ho_Chi_Minh";

export function vietnamTime(now = Date.now()): string {
  return new Date(now + 7 * 60 * 60 * 1000).toISOString().replace("Z", "+07:00");
}

export function reminderContext(now = Date.now()): string {
  return `Current time in Vietnam: ${vietnamTime(now)} (${REMINDER_TIMEZONE}).
For this personal assistant, unqualified user times are Vietnam local time. Schedule one-shot cron jobs with a full date and explicit +07:00 offset, never Z or a timezone-less timestamp. Recurring cron schedules must use tz="${REMINDER_TIMEZONE}". Convert an explicitly requested foreign time to the equivalent +07:00 instant before scheduling.
If a request contains conflicting times, ask which time the user wants before calling cron. Check the current time; never schedule a past time or silently move it to tomorrow. Use isolated agentTurn jobs for reminders, with an exact-text-only prompt and explicit announce delivery channel/to. Do not use tools or resume unrelated tasks during reminder execution. Confirm a schedule only after the tool succeeds and its returned time matches the user's request.`;
}

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as ObjectValue : undefined;
}

/** Guard model-issued mutations only; reads, removals and operator CLI calls are untouched. */
export function guardCronCall(toolName: string, params: ObjectValue, now = Date.now()):
  { block: true; blockReason: string } | undefined {
  if (toolName !== "cron" || !["add", "update"].includes(String(params.action))) return;
  const job = object(params.action === "add" ? params.job : params.patch);
  if (!job) return; // Leave structural validation to OpenClaw.
  const deny = (reason: string) => ({
    block: true as const,
    blockReason: `${reason} Current Vietnam time: ${vietnamTime(now)}. Do not claim success. Correct the parameters or ask the user to clarify; never silently move the date.`,
  });
  const schedule = object(job.schedule);
  if (schedule?.kind === "at") {
    const at = schedule.at;
    if (typeof at !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?\+07:00$/.test(at)) {
      return deny("Use a full ISO timestamp with explicit +07:00, e.g. YYYY-MM-DDTHH:mm:ss+07:00. UTC Z, bare times, relative strings, and numeric timestamps are not accepted by this Vietnam scheduling guard. Convert the intended instant rather than merely relabeling its timezone.");
    }
    const time = Date.parse(at);
    // Date.parse normalizes impossible dates such as February 30; reject them too.
    if (!Number.isFinite(time) || vietnamTime(time).slice(0, 19) !== at.slice(0, 19)) {
      return deny("Invalid calendar date or time.");
    }
    if (time <= now) return deny("The requested reminder time has already passed. Ask for a new future time.");
  }
  if (schedule?.kind === "cron" && schedule.tz !== REMINDER_TIMEZONE) {
    return deny(`Recurring schedules must explicitly use tz="${REMINDER_TIMEZONE}". Convert any requested foreign schedule before calling cron.`);
  }
  return;
}
